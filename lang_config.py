"""
Multilingual configuration for Geode Graph.

Supported languages: Italian, English, French, German, Spanish, Portuguese.
Auto-detection based on stopwords and patterns.
"""

import re
import unicodedata
from collections import Counter

# ==========================================
# STOPWORDS BY LANGUAGE
# ==========================================
STOPWORDS = {
    "it": frozenset(
        "il lo la i gli le un uno una di del dello della dei degli delle "
        "a al allo alla ai agli alle da dal dallo dalla dai dagli dalle "
        "in nel nello nella nei negli nelle con su sul sullo sulla sui sugli sulle "
        "per tra fra e o ma che chi cui non ne se si come dove quando quanto "
        "anche ancora piu molto questo quello sono stato essere avere fare "
        "ha ho hanno era erano suo sua suoi sue loro tutto tutti tutta tutte "
        "altro altri altra altre stesso stessa stessi stesse ogni quale quali "
        "dopo prima durante senza verso fino sopra sotto dentro fuori "
        "poi gia qui la li ora mai sempre solo proprio cosi perche".split()
    ),
    "en": frozenset(
        "the a an and or but not is are was were be been being have has had "
        "do does did will would shall should can could may might must "
        "i me my we our you your he him his she her it its they them their "
        "this that these those what which who whom how where when why "
        "in on at to for from by with of about into through during before after "
        "above below between under over up down out off then than so if "
        "all each every both few more most other some such no nor too very "
        "just also back only own same here there again further once".split()
    ),
    "fr": frozenset(
        "le la les un une des de du au aux en dans par pour sur avec sans "
        "ce cette ces son sa ses leur leurs mon ma mes ton ta tes notre votre "
        "je tu il elle nous vous ils elles on ne pas plus que qui quoi dont ou "
        "et ou mais donc car ni si comme quand comment pourquoi "
        "est sont etait etaient etre avoir fait faire "
        "tout tous toute toutes autre autres meme aussi encore bien tres "
        "ici peu beaucoup trop assez".split()
    ),
    "de": frozenset(
        "der die das ein eine einer eines einem einen dem den des "
        "und oder aber nicht ist sind war waren sein haben hat hatte "
        "ich du er sie es wir ihr sie mein dein sein ihr unser euer "
        "in an auf aus bei mit nach von zu um durch fuer ueber unter "
        "was wer wie wo wann warum welch welche welcher welches "
        "auch noch schon nur sehr viel mehr als wenn dann also "
        "kein keine keiner keines diesem dieser dieses diese "
        "alle alles ander andere anderer anderes".split()
    ),
    "es": frozenset(
        "el la los las un una unos unas de del al en por para con sin sobre "
        "entre hasta desde durante ante bajo contra segun "
        "yo tu el ella nosotros vosotros ellos ellas usted ustedes "
        "mi tu su nuestro vuestro sus me te se nos os le les lo "
        "que quien cual cuyo donde cuando como cuanto porque "
        "y o pero sino ni mas menos tan tanto como si no "
        "es son era eran ser estar haber tener hacer "
        "todo todos toda todas otro otros otra otras mismo misma cada".split()
    ),
    "pt": frozenset(
        "o a os as um uma uns umas de do da dos das em no na nos nas "
        "por para com sem sobre entre ate desde durante "
        "eu tu ele ela nos vos eles elas voce voces "
        "meu minha seu sua nosso nossa seus suas me te se lhe "
        "que quem qual onde quando como quanto porque "
        "e ou mas nem se nao mais menos tao tanto como "
        "ser estar ter haver fazer ir poder dever "
        "todo todos toda todas outro outros outra outras mesmo mesma cada".split()
    ),
}

# ==========================================
# MONTH NAMES BY LANGUAGE
# ==========================================
MONTH_NAMES = {
    "it": {
        "gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04",
        "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08",
        "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12",
    },
    "en": {
        "january": "01", "february": "02", "march": "03", "april": "04",
        "may": "05", "june": "06", "july": "07", "august": "08",
        "september": "09", "october": "10", "november": "11", "december": "12",
    },
    "fr": {
        "janvier": "01", "fevrier": "02", "mars": "03", "avril": "04",
        "mai": "05", "juin": "06", "juillet": "07", "aout": "08",
        "septembre": "09", "octobre": "10", "novembre": "11", "decembre": "12",
    },
    "de": {
        "januar": "01", "februar": "02", "maerz": "03", "april": "04",
        "mai": "05", "juni": "06", "juli": "07", "august": "08",
        "september": "09", "oktober": "10", "november": "11", "dezember": "12",
    },
    "es": {
        "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
        "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
        "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
    },
    "pt": {
        "janeiro": "01", "fevereiro": "02", "marco": "03", "abril": "04",
        "maio": "05", "junho": "06", "julho": "07", "agosto": "08",
        "setembro": "09", "outubro": "10", "novembro": "11", "dezembro": "12",
    },
}

# Mappa inversa: nome mese -> lingua (per detection)
_ALL_MONTHS = {}
for lang, months in MONTH_NAMES.items():
    for month_name in months:
        _ALL_MONTHS[month_name] = lang

# ==========================================
# TEMPORAL KEYWORDS BY LANGUAGE
# ==========================================
TEMPORAL_KEYWORDS = {
    "it": {
        "riunione", "riunioni", "meeting", "kickoff", "review",
        "semestrale", "decisione", "decisioni", "risultato", "risultati",
        "milestone", "avviato", "avviata", "completato", "completata",
        "progresso", "scadenza", "consegna", "approvato", "approvata",
    },
    "en": {
        "meeting", "meetings", "kickoff", "review", "sprint",
        "decision", "decisions", "result", "results", "outcome",
        "milestone", "started", "completed", "finished", "delivered",
        "progress", "deadline", "delivery", "approved", "launched",
    },
    "fr": {
        "reunion", "reunions", "revue", "bilan", "lancement",
        "decision", "decisions", "resultat", "resultats",
        "jalon", "demarre", "termine", "livre", "approuve",
        "progres", "echeance", "livraison",
    },
    "de": {
        "besprechung", "sitzung", "treffen", "review", "kickoff",
        "entscheidung", "entscheidungen", "ergebnis", "ergebnisse",
        "meilenstein", "gestartet", "abgeschlossen", "geliefert",
        "fortschritt", "frist", "lieferung", "genehmigt",
    },
    "es": {
        "reunion", "reuniones", "revision", "lanzamiento",
        "decision", "decisiones", "resultado", "resultados",
        "hito", "iniciado", "completado", "entregado", "aprobado",
        "progreso", "plazo", "entrega",
    },
    "pt": {
        "reuniao", "reunioes", "revisao", "lancamento",
        "decisao", "decisoes", "resultado", "resultados",
        "marco", "iniciado", "concluido", "entregue", "aprovado",
        "progresso", "prazo", "entrega",
    },
}

# Set unificato di tutte le keyword temporali (per matching cross-lingua)
ALL_TEMPORAL_KEYWORDS = set()
for kws in TEMPORAL_KEYWORDS.values():
    ALL_TEMPORAL_KEYWORDS.update(kws)

# ==========================================
# RELATION PATTERNS BY LANGUAGE (wikilink inference)
# ==========================================
RELATION_PATTERNS = {
    "it": [
        (r"responsabile\s+(di|del|della|dello|degli|delle)", "E' responsabile di"),
        (r"coordinat[oa]\s+(da|di|del)", "E' coordinato da"),
        (r"sviluppat[oa]\s+(da|di)", "E' sviluppato da"),
        (r"gestit[oa]\s+(da|di)", "E' gestito da"),
        (r"lavora\s+(per|a|al|alla|con|presso|in)", "Lavora presso"),
        (r"collabora\s+(con|strettamente)", "Collabora con"),
        (r"co-?autore", "E' co-autore con"),
        (r"pubblicazion[ei]", "Ha pubblicazione"),
        (r"brevetto", "Ha brevetto con"),
        (r"finanzia(mento|to)", "E' finanziato da"),
        (r"partner", "E' partner di"),
        (r"membro\s+(del|di)", "E' membro di"),
        (r"supervisio?n[ae]", "Supervisiona"),
        (r"accesso", "Ha accesso a"),
        (r"utilizz[ao]", "Utilizza"),
        (r"basat[oa]\s+su", "E' basato su"),
        (r"addestrat[oa]\s+su", "E' addestrato su"),
        (r"ospita", "Ospita"),
        (r"nell'ambito\s+(del|di)", "Fa parte di"),
        (r"avviat[oa]", "E' avviato da"),
        (r"test\s+(su|con|del)", "Testa con"),
    ],
    "en": [
        (r"responsible\s+for", "Is responsible for"),
        (r"coordinated\s+by", "Is coordinated by"),
        (r"developed\s+by", "Is developed by"),
        (r"managed\s+by", "Is managed by"),
        (r"works\s+(for|at|with|in)", "Works at"),
        (r"collaborates?\s+with", "Collaborates with"),
        (r"co-?author", "Is co-author with"),
        (r"publication", "Has publication"),
        (r"patent", "Has patent with"),
        (r"fund(ed|ing)", "Is funded by"),
        (r"partner", "Is partner of"),
        (r"member\s+of", "Is member of"),
        (r"supervis(es|ed|ing)", "Supervises"),
        (r"access\s+to", "Has access to"),
        (r"uses?\b", "Uses"),
        (r"based\s+on", "Is based on"),
        (r"trained\s+on", "Is trained on"),
        (r"hosts?\b", "Hosts"),
        (r"part\s+of", "Is part of"),
        (r"launched", "Is launched by"),
        (r"tests?\s+(on|with)", "Tests with"),
    ],
    "fr": [
        (r"responsable\s+(de|du|des)", "Est responsable de"),
        (r"coordonne\s+par", "Est coordonne par"),
        (r"developpe\s+par", "Est developpe par"),
        (r"gere\s+par", "Est gere par"),
        (r"travaille\s+(pour|a|avec|chez)", "Travaille pour"),
        (r"collabore\s+avec", "Collabore avec"),
        (r"co-?auteur", "Est co-auteur avec"),
        (r"publication", "A une publication"),
        (r"brevet", "A un brevet avec"),
        (r"financ(e|ement)", "Est finance par"),
        (r"partenaire", "Est partenaire de"),
        (r"membre\s+(de|du)", "Est membre de"),
        (r"supervis(e|ion)", "Supervise"),
        (r"acces", "A acces a"),
        (r"utilis(e|ation)", "Utilise"),
        (r"base\s+sur", "Est base sur"),
        (r"entraine\s+sur", "Est entraine sur"),
        (r"heberge", "Heberge"),
        (r"dans\s+le\s+cadre\s+(de|du)", "Fait partie de"),
        (r"lance", "Est lance par"),
        (r"test(e|s)\s+(sur|avec)", "Teste avec"),
    ],
    "de": [
        (r"verantwortlich\s+fuer", "Ist verantwortlich fuer"),
        (r"koordiniert\s+von", "Wird koordiniert von"),
        (r"entwickelt\s+von", "Wird entwickelt von"),
        (r"verwaltet\s+von", "Wird verwaltet von"),
        (r"arbeitet\s+(fuer|bei|mit|in)", "Arbeitet bei"),
        (r"zusammenarbeit\s+mit", "Arbeitet zusammen mit"),
        (r"co-?autor", "Ist Co-Autor mit"),
        (r"publikation", "Hat Publikation"),
        (r"patent", "Hat Patent mit"),
        (r"finanzier(t|ung)", "Wird finanziert von"),
        (r"partner", "Ist Partner von"),
        (r"mitglied", "Ist Mitglied von"),
        (r"betreu(t|ung)", "Betreut"),
        (r"zugang", "Hat Zugang zu"),
        (r"verwend(et|ung)", "Verwendet"),
        (r"basiert\s+auf", "Basiert auf"),
        (r"trainiert\s+auf", "Trainiert auf"),
        (r"beherbergt", "Beherbergt"),
        (r"im\s+rahmen\s+(von|des)", "Ist Teil von"),
        (r"gestartet", "Wird gestartet von"),
        (r"test(et|s)\s+(auf|mit)", "Testet mit"),
    ],
    "es": [
        (r"responsable\s+(de|del)", "Es responsable de"),
        (r"coordinado\s+por", "Es coordinado por"),
        (r"desarrollado\s+por", "Es desarrollado por"),
        (r"gestionado\s+por", "Es gestionado por"),
        (r"trabaja\s+(para|en|con)", "Trabaja en"),
        (r"colabora\s+con", "Colabora con"),
        (r"co-?autor", "Es co-autor con"),
        (r"publicacion", "Tiene publicacion"),
        (r"patente", "Tiene patente con"),
        (r"financiad[oa]", "Es financiado por"),
        (r"socio", "Es socio de"),
        (r"miembro\s+(de|del)", "Es miembro de"),
        (r"supervis(a|ion)", "Supervisa"),
        (r"acceso", "Tiene acceso a"),
        (r"utiliza", "Utiliza"),
        (r"basado\s+en", "Esta basado en"),
        (r"entrenado\s+en", "Esta entrenado en"),
        (r"aloja", "Aloja"),
        (r"en\s+el\s+marco\s+de", "Forma parte de"),
        (r"lanzado", "Es lanzado por"),
        (r"prueba\s+(en|con)", "Prueba con"),
    ],
    "pt": [
        (r"responsavel\s+(por|pelo|pela)", "E responsavel por"),
        (r"coordenado\s+por", "E coordenado por"),
        (r"desenvolvido\s+por", "E desenvolvido por"),
        (r"gerenciado\s+por", "E gerenciado por"),
        (r"trabalha\s+(para|em|com)", "Trabalha em"),
        (r"colabora\s+com", "Colabora com"),
        (r"co-?autor", "E co-autor com"),
        (r"publicacao", "Tem publicacao"),
        (r"patente", "Tem patente com"),
        (r"financiad[oa]", "E financiado por"),
        (r"parceiro", "E parceiro de"),
        (r"membro\s+(de|do|da)", "E membro de"),
        (r"supervis(a|ao)", "Supervisiona"),
        (r"acesso", "Tem acesso a"),
        (r"utiliza", "Utiliza"),
        (r"baseado\s+em", "E baseado em"),
        (r"treinado\s+em", "E treinado em"),
        (r"hospeda", "Hospeda"),
        (r"no\s+ambito\s+(de|do|da)", "Faz parte de"),
        (r"lancado", "E lancado por"),
        (r"testa\s+(em|com)", "Testa com"),
    ],
}

# Fallback relation per lingua
FALLBACK_RELATION = {
    "it": "E' collegato a",
    "en": "Is related to",
    "fr": "Est lie a",
    "de": "Ist verbunden mit",
    "es": "Esta relacionado con",
    "pt": "Esta relacionado com",
}

# ==========================================
# TOKENIZATION
# ==========================================
_TOKEN_RE = re.compile(r"[a-zA-Z\u00C0-\u024F0-9]+")


def _normalize_token(token: str) -> str:
    """Normalize a token: lowercase, remove accents."""
    token = token.lower()
    nfkd = unicodedata.normalize("NFKD", token)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _get_all_stopwords() -> frozenset:
    """Return the union of all stopwords across all languages."""
    all_sw = set()
    for sw_set in STOPWORDS.values():
        all_sw.update(sw_set)
    return frozenset(all_sw)


_ALL_STOPWORDS = _get_all_stopwords()


def tokenize(text: str, lang: str | None = None) -> list[str]:
    """Tokenize text, remove stopwords and normalize.

    If lang is None, uses the union of all stopwords (safe for multilingual content).
    """
    sw = STOPWORDS.get(lang, _ALL_STOPWORDS) if lang else _ALL_STOPWORDS
    raw_tokens = _TOKEN_RE.findall(text)
    return [
        _normalize_token(t)
        for t in raw_tokens
        if len(t) > 2 and _normalize_token(t) not in sw
    ]


# ==========================================
# LANGUAGE AUTO-DETECTION
# ==========================================
def detect_language(text: str) -> str:
    """Detect text language based on stopword frequency.

    Returns language code (it, en, fr, de, es, pt). Default: 'en'.
    """
    text_lower = text.lower()
    raw_tokens = _TOKEN_RE.findall(text_lower)
    normalized = [_normalize_token(t) for t in raw_tokens]
    token_set = set(normalized)

    scores = {}
    for lang, sw in STOPWORDS.items():
        overlap = token_set.intersection(sw)
        scores[lang] = len(overlap)

    if not scores or max(scores.values()) == 0:
        return "en"

    return max(scores, key=scores.get)


# ==========================================
# MULTILINGUAL DATE EXTRACTION
# ==========================================
def _build_date_regex() -> re.Pattern:
    """Build a regex that matches dates in all supported languages."""
    all_month_names = []
    for months in MONTH_NAMES.values():
        all_month_names.extend(months.keys())
    months_pattern = "|".join(sorted(all_month_names, key=len, reverse=True))

    pattern = (
        rf"(?:(?:{months_pattern})\s+\d{{4}})|"
        rf"(?:\d{{4}}[-/]\d{{2}}(?:[-/]\d{{2}})?)|"
        rf"(?:\d{{1,2}}\s+(?:{months_pattern})\s+\d{{4}})|"
        r"(?:Q[1-4]\s+\d{4})"
    )
    return re.compile(pattern, re.IGNORECASE)


_DATE_RE = _build_date_regex()


def extract_date_tokens(text: str) -> list[str]:
    """Extract normalized temporal tokens from text in any supported language."""
    tokens = []
    for match in _DATE_RE.finditer(text):
        date_str = match.group(0).lower()
        tokens.append(_normalize_token(date_str))
        # Extract individual components
        for month_name in _ALL_MONTHS:
            if month_name in date_str:
                tokens.append(month_name)
        year_match = re.search(r"\d{4}", date_str)
        if year_match:
            tokens.append(year_match.group(0))
    return tokens


# ==========================================
# MULTILINGUAL RELATION INFERENCE
# ==========================================
# Patterns are anchored at a word start so stems never match inside other
# words (e.g. "uses?" inside "because").
_COMPILED_RELATION_PATTERNS = {
    lang: [(re.compile(rf"\b(?:{pattern})"), relation) for pattern, relation in patterns]
    for lang, patterns in RELATION_PATTERNS.items()
}


def match_relation(text: str, lang: str | None = None) -> str | None:
    """Return the first relation pattern matching text, or None.

    Patterns of ``lang`` are tried first, then the remaining languages.
    """
    normalized = _normalize_token(text)
    langs = list(_COMPILED_RELATION_PATTERNS)
    if lang in _COMPILED_RELATION_PATTERNS:
        langs.remove(lang)
        langs.insert(0, lang)
    for candidate in langs:
        for pattern, relation in _COMPILED_RELATION_PATTERNS[candidate]:
            if pattern.search(normalized):
                return relation
    return None


def fallback_relation(lang: str) -> str:
    return FALLBACK_RELATION.get(lang, "Is related to")


def infer_relation(line: str, subject: str, target: str) -> str:
    """Infer relation from line context, preferring the line's language."""
    lang = detect_language(line)
    return match_relation(line, lang) or fallback_relation(lang)
