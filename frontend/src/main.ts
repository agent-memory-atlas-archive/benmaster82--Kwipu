import RuntimeForceGraph3D, {
  type ConfigOptions,
  type ForceGraph3DInstance,
  type LinkObject,
  type NodeObject,
} from "3d-force-graph";
import {
  SCHEMA_VERSION,
  type ApiErrorResponse,
  type ExpandResponse,
  type GraphLink,
  type GraphNode,
  type HealthResponse,
  type QueryRequest,
  type QueryResponse,
  type SchemaVersion,
  type SnapshotResponse,
  type SnapshotStats,
} from "./types";
import {
  ROLE_LABELS,
  buildIndex,
  endId,
  escapeHtml,
  neighborhood,
  nodeTitle,
  renderContextCard,
  resolveLinkTarget,
  wikilinkAnchor,
  type CardSource,
  type GraphIndex,
  type NodeRole,
} from "./context";

type ForceGraph3DConstructor = {
  new <
    NodeType extends NodeObject = NodeObject,
    LinkType extends LinkObject<NodeType> = LinkObject<NodeType>,
  >(
    element: HTMLElement,
    configOptions?: ConfigOptions,
  ): ForceGraph3DInstance<NodeType, LinkType>;
};

// The installed package exposes the generic instance but erases the generic
// constructor parameters on its default export. Keep that correction at the
// library boundary so the graph and all callbacks remain strongly typed.
const ForceGraph3D = RuntimeForceGraph3D as ForceGraph3DConstructor;

const COLORS = {
  entity: "#ffffff",
  chunk: "rgba(255, 255, 255, 0.55)",
  linkSemantic: "rgba(255, 255, 255, 0.32)",
  linkProvenance: "rgba(255, 255, 255, 0.10)",
  highlight: "#ffffff",
  highlightLink: "rgba(255, 255, 255, 0.85)",
  dim: "rgba(255, 255, 255, 0.06)",
  dimLink: "rgba(255, 255, 255, 0.03)",
  particle: "#ffffff",
};

// Muted tints keep the monochrome look while telling node roles apart.
const ROLE_COLORS: Record<NodeRole, string> = {
  note: "#ffffff",
  value: "#e8c27a",
  entity: "#8fb8ff",
  chunk: "rgba(255, 255, 255, 0.45)",
};
const MAX_FOCUS_LABELS = 16;

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Elemento UI mancante: ${selector}`);
  return element;
}

function createApiBaseUrl(configuredValue: string | undefined): URL {
  const configured = configuredValue?.trim() || "/api";
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(configured);
  const source = hasScheme ? configured : `/${configured.replace(/^\/+/, "")}`;
  const url = new URL(source, window.location.origin);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`VITE_API_BASE non valido: protocollo ${url.protocol}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("VITE_API_BASE non può contenere credenziali, query o fragment");
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

const API_BASE_URL = createApiBaseUrl(import.meta.env.VITE_API_BASE);

function apiUrl(path: string, query?: URLSearchParams): string {
  const url = new URL(path.replace(/^\/+/, ""), API_BASE_URL);
  if (query) url.search = query.toString();
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return isRecord(value) && "detail" in value;
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!isRecord(item)) return String(item);
        const location = Array.isArray(item.loc) ? item.loc.join(".") : "";
        const message = typeof item.msg === "string" ? item.msg : JSON.stringify(item);
        return location ? `${location}: ${message}` : message;
      })
      .join("; ");
  }
  if (detail == null) return "";
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

async function createHttpError(response: Response): Promise<Error> {
  let detail = "";
  const body = await response.text();
  if (body) {
    try {
      const payload: unknown = JSON.parse(body);
      if (isApiErrorResponse(payload)) {
        detail = formatDetail(payload.detail);
      } else {
        detail = formatDetail(payload);
      }
    } catch {
      detail = body.trim();
    }
  }

  const status = `${response.status} ${response.statusText}`.trim();
  return new Error(detail ? `${status} · ${detail}` : status);
}

function assertSchemaVersion(
  payload: unknown,
  endpoint: string,
): asserts payload is { schema_version: SchemaVersion } {
  const received = isRecord(payload) ? payload.schema_version : undefined;
  if (received !== SCHEMA_VERSION) {
    const value = received == null ? "mancante" : JSON.stringify(received);
    throw new Error(
      `Schema API incompatibile per ${endpoint}: atteso ${SCHEMA_VERSION}, ricevuto ${value}`,
    );
  }
}

async function fetchVersioned<ResponseType extends { schema_version: SchemaVersion }>(
  endpoint: string,
  init?: RequestInit,
  query?: URLSearchParams,
): Promise<ResponseType> {
  const response = await fetch(apiUrl(endpoint, query), init);
  if (!response.ok) throw await createHttpError(response);

  const payload: unknown = await response.json();
  assertSchemaVersion(payload, endpoint);
  return payload as ResponseType;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let highlightedIds = new Set<string>();
let visibleNodeIds = new Set<string>();
let activeModel = "";
let sceneCounts: { nodes: number; links: number } | null = null;
let healthState:
  | { status: "loading" }
  | { status: HealthResponse["status"] }
  | { status: "error"; message: string } = { status: "loading" };
let lastQueryVisibility: {
  citedNodeIds: string[];
  highlightNodeIds: string[];
} | null = null;
let graphRequestGeneration = 0;
let graphAbortController: AbortController | null = null;
let queryRequestGeneration = 0;
let queryAbortController: AbortController | null = null;
let previewRequestGeneration = 0;
let previewAbortController: AbortController | null = null;
let graphIndex: GraphIndex = buildIndex([], []);
let focusedId: string | null = null;
let focusIds = new Set<string>();
let previewState: {
  node: GraphNode;
  source: CardSource | null;
  sourceState: "loading" | "ready" | "unavailable";
  markdown: string | null;
  showFull: boolean;
} | null = null;

const elGraph = requireElement<HTMLElement>("#graph");
const elStats = requireElement<HTMLElement>("#stats");
const elHover = requireElement<HTMLElement>("#hover");
const elSceneMeta = requireElement<HTMLElement>("#scene-meta");
const elChunks = requireElement<HTMLInputElement>("#opt-chunks");
const elNoisy = requireElement<HTMLInputElement>("#opt-noisy");
const elMinDeg = requireElement<HTMLInputElement>("#opt-mindeg");
const elMinDegVal = requireElement<HTMLElement>("#opt-mindeg-val");
const elReload = requireElement<HTMLButtonElement>("#reload");
const elQ = requireElement<HTMLTextAreaElement>("#q");
const elAsk = requireElement<HTMLButtonElement>("#ask");
const elAskStatus = requireElement<HTMLElement>("#ask-status");
const elAnswerBox = requireElement<HTMLElement>("#answer-box");
const elAnswer = requireElement<HTMLElement>("#answer");
const elCited = requireElement<HTMLElement>("#cited");
const elClearHighlight = requireElement<HTMLButtonElement>("#clear-highlight");
const elPreview = requireElement<HTMLElement>("#preview");
const elPreviewTitle = requireElement<HTMLElement>("#preview-title");
const elPreviewBody = requireElement<HTMLElement>("#preview-body");
const elPreviewClose = requireElement<HTMLButtonElement>("#preview-close");

const Graph = new ForceGraph3D<GraphNode, GraphLink>(elGraph)
  .backgroundColor("#000000")
  .nodeRelSize(4)
  .nodeLabel(
    (node) =>
      `<span style="font-family: inherit; font-size: 12px; color: #fff; background: rgba(0,0,0,0.85); padding: 4px 8px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;">${escapeHtml(
        node.name ?? node.file_name ?? node.id,
      )}</span>`,
  )
  .nodeColor((node) => {
    const roleColor = ROLE_COLORS[graphIndex.roles.get(node.id) ?? "entity"];
    if (focusedId) return focusIds.has(node.id) ? roleColor : COLORS.dim;
    if (highlightedIds.size > 0) {
      return highlightedIds.has(node.id) ? COLORS.highlight : COLORS.dim;
    }
    return roleColor;
  })
  .nodeOpacity(0.95)
  .nodeVal((node) => {
    if (node.type === "chunk") return 2;
    return Math.max(1.5, Math.min(10, (node.degree ?? 1) * 1.1));
  })
  .linkColor((link) => {
    if (focusedId) return isFocusLink(link) ? COLORS.highlightLink : COLORS.dimLink;
    if (highlightedIds.size > 0) {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      const highlighted = highlightedIds.has(sourceId) || highlightedIds.has(targetId);
      return highlighted ? COLORS.highlightLink : COLORS.dimLink;
    }
    return link.kind === "provenance" ? COLORS.linkProvenance : COLORS.linkSemantic;
  })
  .linkWidth((link) => (link.kind === "provenance" ? 0.4 : 0.8))
  .linkLabel(
    (link) =>
      `<span style="font-family: inherit; font-size: 11px; color: #fff; background: rgba(0,0,0,0.85); padding: 3px 7px; border-radius: 4px;">${escapeHtml(
        link.label,
      )}</span>`,
  )
  // Particles only flow along the focused node's links: motion where the
  // user is looking, no animation cost everywhere else.
  .linkDirectionalParticles((link) => (isFocusLink(link) ? 2 : 0))
  .linkDirectionalParticleSpeed(0.006)
  .linkDirectionalParticleWidth(1.6)
  .linkDirectionalParticleColor(() => COLORS.particle)
  .onNodeHover((node) => showHover(node))
  .onNodeClick((node) => openPreview(node))
  .onBackgroundClick(() => closePreview());

function isFocusLink(link: GraphLink): boolean {
  return (
    focusedId !== null &&
    (endId(link.source) === focusedId || endId(link.target) === focusedId)
  );
}

function refreshGraphStyles() {
  Graph.nodeColor(Graph.nodeColor())
    .linkColor(Graph.linkColor())
    .linkDirectionalParticles(Graph.linkDirectionalParticles());
}

// HTML labels for the focused neighborhood only: a handful of DOM nodes
// instead of one text sprite per graph node.
const elLabels = document.createElement("div");
elLabels.className = "focus-labels";
elGraph.appendChild(elLabels);
let focusLabelNodes: GraphNode[] = [];

function renderFocusLabels() {
  const ids = [...focusIds];
  focusLabelNodes = ids
    .map((id) => graphIndex.nodes.get(id))
    .filter((node): node is GraphNode => node !== undefined && node.type === "entity")
    .sort((a, b) => (a.id === focusedId ? -1 : b.id === focusedId ? 1 : (b.degree ?? 0) - (a.degree ?? 0)))
    .slice(0, MAX_FOCUS_LABELS);
  elLabels.innerHTML = focusLabelNodes
    .map(
      (node) =>
        `<span class="${node.id === focusedId ? "focus" : ""}">${escapeHtml(nodeTitle(node))}</span>`,
    )
    .join("");
}

function updateFocusLabels() {
  if (focusLabelNodes.length === 0) return;
  const spans = elLabels.children;
  focusLabelNodes.forEach((node, position) => {
    const span = spans[position] as HTMLElement | undefined;
    if (!span || node.x == null || node.y == null || node.z == null) return;
    const { x, y } = Graph.graph2ScreenCoords(node.x, node.y, node.z);
    span.style.transform = `translate(${x}px, ${y}px)`;
  });
}

// Idle rotation — gentle, breathing constellation.
let userInteracting = false;
let lastInteractionAt = 0;
let theta: number | null = null;
const IDLE_AFTER_MS = 2200;
const ROT_SPEED = 0.0012;

elGraph.addEventListener("pointerdown", () => {
  userInteracting = true;
  lastInteractionAt = Date.now();
});
window.addEventListener("pointerup", () => {
  userInteracting = false;
  lastInteractionAt = Date.now();
});
elGraph.addEventListener(
  "wheel",
  () => {
    lastInteractionAt = Date.now();
  },
  { passive: true },
);

function tickIdle() {
  requestAnimationFrame(tickIdle);
  updateFocusLabels();
  if (userInteracting) return;
  if (highlightedIds.size > 0 || focusedId) return;
  if (Date.now() - lastInteractionAt < IDLE_AFTER_MS) return;
  const position = Graph.cameraPosition();
  const distance = Math.hypot(position.x, position.z);
  if (distance < 1) return;
  if (theta === null) theta = Math.atan2(position.x, position.z);
  theta += ROT_SPEED;
  Graph.cameraPosition(
    {
      x: Math.sin(theta) * distance,
      y: position.y,
      z: Math.cos(theta) * distance,
    },
    undefined,
    0,
  );
}
requestAnimationFrame(tickIdle);

function renderSceneMeta() {
  const counts = sceneCounts
    ? `${sceneCounts.nodes} nodes · ${sceneCounts.links} links`
    : "graph loading…";
  const health =
    healthState.status === "error"
      ? `health error · ${healthState.message}`
      : healthState.status === "loading"
        ? "health loading…"
        : `health ${healthState.status}`;
  const model = activeModel || "model unavailable";

  elSceneMeta.innerHTML = `
    <div>${escapeHtml(counts)}</div>
    <div>kwipu · ${escapeHtml(health)} · ${escapeHtml(model)}</div>
  `;
}

async function loadHealth() {
  try {
    const health = await fetchVersioned<HealthResponse>("health");
    activeModel = health.llm_model;
    healthState = { status: health.status };
  } catch (error) {
    activeModel = "";
    healthState = { status: "error", message: errorMessage(error) };
  }
  renderSceneMeta();
  if (lastQueryVisibility) refreshQueryVisibility();
}

async function loadGraph() {
  const requestGeneration = ++graphRequestGeneration;
  graphAbortController?.abort();
  const controller = new AbortController();
  graphAbortController = controller;
  const params = new URLSearchParams({
    include_chunks: String(elChunks.checked),
    drop_noisy: String(elNoisy.checked),
    min_degree: elMinDeg.value,
  });
  elStats.innerHTML = `<span class="key">loading…</span>`;
  try {
    const snapshot = await fetchVersioned<SnapshotResponse>(
      "graph/snapshot",
      { signal: controller.signal },
      params,
    );
    if (requestGeneration !== graphRequestGeneration) return;
    graphIndex = buildIndex(snapshot.nodes, snapshot.links);
    Graph.graphData({ nodes: snapshot.nodes, links: snapshot.links });
    visibleNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    if (focusedId) {
      const node = graphIndex.nodes.get(focusedId);
      if (node) void openPreview(node, { moveCamera: false });
      else closePreview();
    }
    sceneCounts = { nodes: snapshot.nodes.length, links: snapshot.links.length };
    elStats.innerHTML = formatStats(snapshot.stats);
    renderSceneMeta();
    if (lastQueryVisibility) refreshQueryVisibility();
  } catch (error) {
    if (requestGeneration !== graphRequestGeneration) return;
    elStats.innerHTML = `<span class="key">error: ${escapeHtml(errorMessage(error))}</span>`;
  } finally {
    if (graphAbortController === controller) graphAbortController = null;
  }
}

function formatStats(stats: SnapshotStats): string {
  const row = (key: string, value: string | number) =>
    `<span class="key">${key.padEnd(14, " ")}</span><span class="val">${value}</span>\n`;
  return [
    row("raw nodes", stats.total_nodes_raw),
    row("raw relations", stats.total_relations_raw),
    row("kept nodes", stats.kept_nodes),
    row("kept links", stats.kept_links),
    row("skipped noisy", stats.skipped_noisy),
  ].join("");
}

function showHover(node: GraphNode | null) {
  if (!node) {
    elHover.innerHTML = `<div class="empty">hover a node…</div>`;
    return;
  }
  const frontmatterRows = Object.entries(node.fm)
    .map(
      ([key, value]) =>
        `<div><span class="k">${escapeHtml(key)}</span> · ${escapeHtml(String(value))}</div>`,
    )
    .join("");
  const role = graphIndex.roles.get(node.id) ?? "entity";
  elHover.innerHTML = `
    <span class="name">${escapeHtml(nodeTitle(node))}</span>
    <div class="meta">
      <div><span class="k">type</span> · ${ROLE_LABELS[role]}${
        node.degree != null ? ` · degree ${node.degree}` : ""
      }</div>
      ${
        node.file_name
          ? `<div><span class="k">file</span> · ${escapeHtml(node.file_name)}</div>`
          : ""
      }
      ${frontmatterRows}
    </div>
  `;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function refreshQueryVisibility() {
  if (!lastQueryVisibility) return;

  const visibleSources = lastQueryVisibility.citedNodeIds.filter((id) => visibleNodeIds.has(id));
  const visibleHighlights = lastQueryVisibility.highlightNodeIds.filter((id) =>
    visibleNodeIds.has(id),
  );
  highlightNodes(visibleHighlights);

  const modelLabel = activeModel ? ` · ${activeModel}` : "";
  elAskStatus.textContent =
    `${visibleSources.length}/${lastQueryVisibility.citedNodeIds.length} source(s) visible · ` +
    `${visibleHighlights.length}/${lastQueryVisibility.highlightNodeIds.length} highlight(s) visible` +
    modelLabel;
}

async function askQuestion() {
  const question = elQ.value.trim();
  if (!question) return;
  const requestGeneration = ++queryRequestGeneration;
  queryAbortController?.abort();
  const controller = new AbortController();
  queryAbortController = controller;

  closePreview();
  elAsk.disabled = true;
  elAskStatus.classList.add("thinking");
  elAskStatus.textContent = "thinking";
  lastQueryVisibility = null;
  highlightNodes([]);
  elAnswerBox.hidden = true;
  try {
    const request: QueryRequest = { q: question };
    const data = await fetchVersioned<QueryResponse>("query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (requestGeneration !== queryRequestGeneration) return;
    elAnswer.innerHTML = renderMarkdown(data.answer || "(no answer)");
    elCited.innerHTML = data.cited_files
      .map((fileName) => `<span class="chip">${escapeHtml(fileName)}</span>`)
      .join("");
    elAnswerBox.hidden = false;
    elAskStatus.classList.remove("thinking");

    const citedNodeIds = uniqueIds(data.cited_node_ids);
    const requestedHighlights = uniqueIds(data.highlight_node_ids);
    lastQueryVisibility = {
      citedNodeIds,
      highlightNodeIds: requestedHighlights.length > 0 ? requestedHighlights : citedNodeIds,
    };
    refreshQueryVisibility();
  } catch (error) {
    if (requestGeneration !== queryRequestGeneration) return;
    elAskStatus.classList.remove("thinking");
    elAskStatus.textContent = `error · ${errorMessage(error)}`;
  } finally {
    if (queryAbortController === controller) {
      queryAbortController = null;
      elAsk.disabled = false;
    }
  }
}

// Lightweight markdown: **bold** only — keeps the panel clean.
function renderMarkdown(source: string): string {
  return escapeHtml(source).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function highlightNodes(ids: string[]) {
  highlightedIds = new Set(ids);
  refreshGraphStyles();
}

function clearHighlight() {
  queryRequestGeneration += 1;
  queryAbortController?.abort();
  queryAbortController = null;
  elAsk.disabled = false;
  elAskStatus.classList.remove("thinking");
  lastQueryVisibility = null;
  highlightNodes([]);
  elAnswerBox.hidden = true;
  elAskStatus.textContent = "";
}

elAsk.addEventListener("click", askQuestion);
elQ.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    askQuestion();
  }
});
elClearHighlight.addEventListener("click", clearHighlight);
elPreviewClose.addEventListener("click", closePreview);

function setFocus(id: string | null) {
  focusedId = id;
  focusIds = id ? neighborhood(graphIndex, id) : new Set();
  renderFocusLabels();
  refreshGraphStyles();
}

/**
 * Fly the camera so the node and its neighbors fit the view, with the node
 * centered in the area left uncovered by the preview card.
 */
function frameFocus(node: GraphNode) {
  if (node.x == null || node.y == null || node.z == null) return;
  const center = { x: node.x, y: node.y, z: node.z };
  let radius = 20;
  for (const id of focusIds) {
    const other = graphIndex.nodes.get(id);
    if (other?.x == null || other.y == null || other.z == null) continue;
    radius = Math.max(
      radius,
      Math.hypot(other.x - center.x, other.y - center.y, other.z - center.z),
    );
  }
  const camera = Graph.camera() as { fov?: number; aspect?: number };
  const halfFov = (((camera.fov ?? 40) * Math.PI) / 180) / 2;
  const aspect = camera.aspect ?? elGraph.clientWidth / Math.max(1, elGraph.clientHeight);
  const distance = Math.min(900, Math.max(80, radius / (Math.tan(halfFov) * 0.85)));

  // View from the side of the node facing away from the graph's origin.
  const length = Math.max(1, Math.hypot(center.x, center.y, center.z));
  const dir = { x: center.x / length, y: center.y / length, z: center.z / length };
  // right = forward × up, with forward = -dir and up = +y.
  let right = { x: dir.z, y: 0, z: -dir.x };
  const rightLength = Math.hypot(right.x, right.z);
  right = rightLength > 1e-6
    ? { x: right.x / rightLength, y: 0, z: right.z / rightLength }
    : { x: 1, y: 0, z: 0 };
  const covered = elPreview.hidden ? 0 : elPreview.offsetWidth / Math.max(1, elGraph.clientWidth);
  const shift = distance * Math.tan(halfFov) * aspect * covered;

  Graph.cameraPosition(
    {
      x: center.x + dir.x * distance + right.x * shift,
      y: center.y + dir.y * distance,
      z: center.z + dir.z * distance + right.z * shift,
    },
    { x: center.x + right.x * shift, y: center.y, z: center.z + right.z * shift },
    800,
  );
}

function renderPreview() {
  if (!previewState) return;
  const { node, source, sourceState, markdown, showFull } = previewState;
  if (showFull && markdown !== null) {
    elPreviewBody.innerHTML = `
      <button class="ctx-action ctx-back" data-action="context">← Context</button>
      ${renderMarkdownBlock(markdown)}
      <div class="preview-meta">${escapeHtml(source?.filePath ?? "")}</div>
    `;
    return;
  }
  elPreviewBody.innerHTML = renderContextCard(node, graphIndex, source, sourceState);
}

async function openPreview(node: GraphNode, options: { moveCamera?: boolean } = {}) {
  const requestGeneration = ++previewRequestGeneration;
  previewAbortController?.abort();
  const controller = new AbortController();
  previewAbortController = controller;

  setFocus(node.id);
  previewState = { node, source: null, sourceState: "loading", markdown: null, showFull: false };
  elPreviewTitle.textContent = nodeTitle(node);
  elPreview.hidden = false;
  renderPreview();

  if (options.moveCamera !== false) frameFocus(node);
  try {
    const params = new URLSearchParams({ node_id: node.id });
    const data = await fetchVersioned<ExpandResponse>(
      "expand",
      { signal: controller.signal },
      params,
    );
    if (requestGeneration !== previewRequestGeneration || !previewState) return;
    previewState.source = { filePath: data.file_path, lines: data.markdown.split(/\r?\n/) };
    previewState.markdown = data.markdown;
    previewState.sourceState = "ready";
  } catch (error) {
    if (requestGeneration !== previewRequestGeneration || !previewState) return;
    if (controller.signal.aborted) return;
    previewState.sourceState = "unavailable";
  } finally {
    if (previewAbortController === controller) previewAbortController = null;
  }
  renderPreview();
}

function closePreview() {
  previewRequestGeneration += 1;
  previewAbortController?.abort();
  previewAbortController = null;
  previewState = null;
  elPreview.hidden = true;
  if (focusedId) setFocus(null);
}

function focusNodeById(id: string | null) {
  const node = id ? graphIndex.nodes.get(id) : undefined;
  if (node) void openPreview(node);
}

elPreviewBody.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const nodeRef = target.closest<HTMLElement>("[data-node]");
  if (nodeRef) {
    focusNodeById(nodeRef.dataset.node ?? null);
    return;
  }
  const wikilink = target.closest<HTMLElement>("[data-link]");
  if (wikilink) {
    event.preventDefault();
    const id = resolveLinkTarget(graphIndex, wikilink.dataset.link ?? "");
    if (id) focusNodeById(id);
    else wikilink.classList.add("unresolved");
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action && previewState) {
    previewState.showFull = action === "full";
    renderPreview();
    elPreviewBody.scrollTop = 0;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elPreview.hidden) closePreview();
});

function renderMarkdownBlock(source: string): string {
  // Lightweight markdown — enough for personal notes.
  let html = escapeHtml(source);
  html = html.replace(/^---\n([\s\S]*?)\n---\n?/, (_, yaml: string) => {
    const rows = yaml
      .split("\n")
      .filter(Boolean)
      .map((line) => `<div>${line}</div>`)
      .join("");
    return `<div class="preview-meta" style="margin: 0 0 14px; border-top:none; padding-top:0">${rows}</div>`;
  });
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/```([\s\S]*?)```/g, (_, code: string) => `<pre>${code}</pre>`);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => wikilinkAnchor(inner));
  html = html.replace(/\n\n/g, "</p><p>");
  return `<p>${html}</p>`;
}

elReload.addEventListener("click", loadGraph);
elChunks.addEventListener("change", loadGraph);
elNoisy.addEventListener("change", loadGraph);
elMinDeg.addEventListener("input", () => {
  elMinDegVal.textContent = elMinDeg.value;
});
elMinDeg.addEventListener("change", loadGraph);

window.addEventListener("resize", () => {
  Graph.width(elGraph.clientWidth).height(elGraph.clientHeight);
});

renderSceneMeta();
void (async () => {
  await loadHealth();
  await loadGraph();
})();

// Expose a few hooks for end-to-end tests / debugging.
Object.assign(window, {
  __kwipu: {
    Graph,
    openPreview,
    askQuestion,
    clearHighlight,
  },
});
