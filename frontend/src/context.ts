import type { GraphLink, GraphNode } from "./types";

/** What a node stands for, derived from the provenance of its links. */
export type NodeRole = "note" | "value" | "entity" | "chunk";

export const ROLE_LABELS: Record<NodeRole, string> = {
  note: "note",
  value: "attribute",
  entity: "LLM entity",
  chunk: "source chunk",
};

export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  outgoing: Map<string, GraphLink[]>;
  incoming: Map<string, GraphLink[]>;
  roles: Map<string, NodeRole>;
  /** Case-folded id, name and last path segment → node id. */
  byName: Map<string, string>;
}

const MAX_ROWS = 12;

export function endId(end: string | GraphNode): string {
  return typeof end === "string" ? end : end.id;
}

export function nodeTitle(node: GraphNode): string {
  return node.name ?? node.file_name ?? node.id;
}

function push(map: Map<string, GraphLink[]>, key: string, link: GraphLink) {
  const list = map.get(key);
  if (list) list.push(link);
  else map.set(key, [link]);
}

export function buildIndex(nodes: GraphNode[], links: GraphLink[]): GraphIndex {
  const index: GraphIndex = {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    outgoing: new Map(),
    incoming: new Map(),
    roles: new Map(),
    byName: new Map(),
  };
  const notes = new Set<string>();
  const values = new Set<string>();
  for (const link of links) {
    const source = endId(link.source);
    const target = endId(link.target);
    push(index.outgoing, source, link);
    push(index.incoming, target, link);
    if (link.origin) notes.add(source);
    if (link.origin === "wikilink") notes.add(target);
    if (link.origin === "frontmatter") values.add(target);
  }
  for (const node of nodes) {
    const role: NodeRole =
      node.type === "chunk"
        ? "chunk"
        : notes.has(node.id)
          ? "note"
          : values.has(node.id)
            ? "value"
            : "entity";
    index.roles.set(node.id, role);
  }
  // Exact ids win over names, names over last path segments.
  const keys: Array<(node: GraphNode) => string | null> = [
    (node) => node.id,
    (node) => node.name,
    (node) => node.id.split("/").pop() ?? null,
  ];
  for (const key of keys) {
    for (const node of nodes) {
      if (node.type !== "entity") continue;
      const value = key(node)?.toLocaleLowerCase();
      if (value && !index.byName.has(value)) index.byName.set(value, node.id);
    }
  }
  return index;
}

/** Node id for an Obsidian link target such as "People/Bob#Role|Bob". */
export function resolveLinkTarget(index: GraphIndex, raw: string): string | null {
  const target = raw.split("|")[0].split("#")[0].trim().toLocaleLowerCase();
  if (!target) return null;
  return (
    index.byName.get(target) ??
    index.byName.get(target.replace(/\.md$/, "")) ??
    index.byName.get(target.split("/").pop() ?? "") ??
    null
  );
}

/** The node plus every node one link away. */
export function neighborhood(index: GraphIndex, id: string): Set<string> {
  const ids = new Set([id]);
  for (const link of index.outgoing.get(id) ?? []) ids.add(endId(link.target));
  for (const link of index.incoming.get(id) ?? []) ids.add(endId(link.source));
  return ids;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/** Navigation anchor for the already escaped inside of a [[wikilink]]. */
export function wikilinkAnchor(inner: string): string {
  const display = inner.includes("|") ? inner.split("|").pop()! : inner;
  return `<a href="#" class="wikilink" data-link="${inner}">${display}</a>`;
}

/** Escaped text whose [[wikilinks]] become navigation anchors. */
export function linkify(text: string): string {
  return escapeHtml(text).replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) =>
    wikilinkAnchor(inner),
  );
}

function provenanceMeta(link: GraphLink): string {
  const parts = [link.field, link.line ? `line ${link.line}` : null].filter(Boolean);
  return parts.length ? `<span class="rel-meta">${escapeHtml(parts.join(" · "))}</span>` : "";
}

function nodeButton(index: GraphIndex, id: string): string {
  const node = index.nodes.get(id);
  const role = index.roles.get(id) ?? "entity";
  const label = node ? nodeTitle(node) : id;
  return `<button class="node-ref role-${role}" data-node="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function section(title: string, rows: string[]): string {
  if (rows.length === 0) return "";
  const shown = rows.slice(0, MAX_ROWS).join("");
  const more =
    rows.length > MAX_ROWS ? `<div class="ctx-more">+${rows.length - MAX_ROWS} more</div>` : "";
  return `<section class="ctx-section"><h4>${escapeHtml(title)}</h4>${shown}${more}</section>`;
}

export interface CardSource {
  /** Vault-relative path of the fetched source, to match link provenance. */
  filePath: string;
  lines: string[];
}

export function renderContextCard(
  node: GraphNode,
  index: GraphIndex,
  source: CardSource | null,
  sourceState: "loading" | "ready" | "unavailable",
): string {
  const id = node.id;
  const role = index.roles.get(id) ?? "entity";
  const outgoing = index.outgoing.get(id) ?? [];
  const incoming = index.incoming.get(id) ?? [];

  const relationRow = (link: GraphLink, otherId: string, arrow: "→" | "←") => `
    <div class="rel">
      <span class="rel-label">${arrow === "←" ? "← " : ""}${escapeHtml(link.label)}</span>
      ${nodeButton(index, otherId)}
      ${provenanceMeta(link)}
    </div>`;

  const snippet = (link: GraphLink): string => {
    if (!source || !link.line || link.file_path !== source.filePath) return "";
    const line = source.lines[link.line - 1];
    return line?.trim() ? `<blockquote class="snippet">${linkify(line.trim())}</blockquote>` : "";
  };

  const attributes = outgoing
    .filter((link) => link.origin === "frontmatter")
    .map((link) => relationRow(link, endId(link.target), "→"));
  const wikilinks = outgoing
    .filter((link) => link.origin === "wikilink")
    .map((link) => relationRow(link, endId(link.target), "→") + snippet(link));
  const citedBy = incoming
    .filter((link) => link.origin)
    .map((link) => relationRow(link, endId(link.source), "←"));
  const extracted = [
    ...outgoing
      .filter((link) => link.kind === "semantic" && !link.origin)
      .map((link) => relationRow(link, endId(link.target), "→")),
    ...incoming
      .filter((link) => link.kind === "semantic" && !link.origin)
      .map((link) => relationRow(link, endId(link.source), "←")),
  ];
  const chunks = incoming
    .filter((link) => link.kind === "provenance")
    .map((link) => endId(link.source));
  const mentions = outgoing
    .filter((link) => link.kind === "provenance")
    .map((link) => endId(link.target));

  const sourceLine =
    sourceState === "loading"
      ? `<span class="ctx-source">loading source…</span>`
      : sourceState === "unavailable"
        ? `<span class="ctx-source">no source document</span>`
        : `<span class="ctx-source">${escapeHtml(source?.filePath ?? "")}</span>`;

  const body = [
    section(role === "value" ? "Declared by" : "Attributes", role === "value" ? citedBy : attributes),
    section("Links", wikilinks),
    role === "value" ? "" : section("Cited by", citedBy),
    section("Extracted by the LLM", extracted),
    section(
      "Source chunks",
      chunks.map((chunkId) => `<div class="rel">${nodeButton(index, chunkId)}</div>`),
    ),
    section(
      "Entities in this chunk",
      mentions.map((entityId) => `<div class="rel">${nodeButton(index, entityId)}</div>`),
    ),
  ].join("");

  const actions =
    sourceState === "ready"
      ? `<button class="ctx-action" data-action="full">Open full ${role === "note" ? "note" : "source"}</button>`
      : "";

  return `
    <div class="ctx-head">
      <span class="role-badge role-${role}">${ROLE_LABELS[role]}</span>
      ${sourceLine}
    </div>
    ${body || `<div class="ctx-empty">No relations in the current view.</div>`}
    ${actions}
  `;
}
