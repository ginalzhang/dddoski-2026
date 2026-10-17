"""Deterministic English query planning and explainable lexical relevance.

No extra API, model credentials, or latency. Domain expansions are additive;
unknown topics keep their original concepts rather than being mapped to math.
"""
import re
from dataclasses import dataclass
from typing import Iterator, List, Tuple

STOP = set("a an the to of and or in on for with is are be me my please find show videos video shorts youtube learn learning teach about introduction intro explain explained covering understand i want need can you that this how what does do using into from at as it its".split())
DOMAINS = {
    "math": ("algebra", "geometry", "arithmetic", "probability"),
    "mathematics": ("algebra", "geometry", "arithmetic", "probability"),
    "discrete math": ("graph theory", "combinatorics", "logic", "sets"),
    "science": ("physics", "chemistry", "biology", "astronomy"),
    "physics": ("motion", "forces", "energy", "electricity"),
    "biology": ("cells", "genetics", "evolution", "ecology"),
    "history": ("ancient history", "world history", "civilizations", "historical events"),
    "computer science": ("algorithms", "data structures", "programming", "computing"),
    "calculus": ("limits", "derivatives", "integrals", "chain rule", "fundamental theorem of calculus",
                 "differentiation", "integration", "Taylor series", "derivative applications", "integral applications"),
}
ALIASES = {
    "simplification": "simplify", "simplifying": "simplify", "simplified": "simplify",
    "algebraic": "algebra", "mathematics": "math", "maths": "math",
    "vertices": "vertex", "edges": "edge", "applications": "application",
    "expressions": "expression", "terms": "term", "equations": "equation",
    "graphs": "graph", "eighth": "8", "8th": "8",
    "derivatives": "derivative", "integrals": "integral", "limits": "limit",
}


def tokens(text: str) -> List[str]:
    return [ALIASES.get(t, t) for t in re.findall(r"[^\W_]+", text.lower()) if t not in STOP]


@dataclass(frozen=True)
class Plan:
    topic: str
    concepts: Tuple[str, ...]
    level: str
    subtopics: Tuple[str, ...]
    queries: Tuple[str, ...]
    expansions: Tuple[str, ...]
    broad: bool


def make_plan(prompt: str) -> Plan:
    prompt = " ".join(prompt.split())
    if not prompt or len(prompt) > 4000:
        raise ValueError("prompt must contain 1–4000 characters")
    level_match = re.search(r"\b(?:(?:\d{1,2}(?:st|nd|rd|th)?|eighth)\s*grade|grade\s*\d{1,2}|middle school|high school|elementary|college|university|beginner|advanced)\b", prompt, re.I)
    level = level_match.group(0).lower() if level_match else ""
    raw = tokens(prompt)
    if not raw:
        raise ValueError("prompt must contain a topic")
    # Keep a paragraph's key terms and level without sending an overlong search.
    concepts = tuple(dict.fromkeys(t for t in raw if t not in tokens(level) and t != "grade"))
    if not concepts:
        raise ValueError("prompt must contain a topic beyond its educational level")
    topic = " ".join(concepts)[:180].strip()
    domain = " ".join(c for c in concepts if c not in {"concept", "concepts", "review", "overview", "basics", "fundamentals"})
    broad = domain in DOMAINS
    subtopics = DOMAINS.get(domain, ()) if broad else ()
    if broad:
        concepts = tuple(tokens(domain))
        topic = domain
    targeted = []
    concept_set = set(concepts)
    if "simplify" in concept_set and concept_set & {"algebra", "expression"}:
        targeted = ["combining like terms", "distributive property", "simplifying algebraic expressions"]
    elif {"graph", "theory"} <= concept_set:
        targeted = ["graph theory vertices edges", "graph theory applications", "graph theory basics"]
    base = f"{level} {topic}".strip()
    if broad:
        queries = [f"{level} {topic} {s} shorts lesson".strip() for s in subtopics[:4]]
    elif targeted:
        queries = [f"{base} shorts"] + [f"{base} {s} shorts" for s in targeted]
    else:
        queries = [f"{base} shorts", f"{base} quick lesson", f"{base} explained #shorts", f"{base} examples shorts"]
    # Preserve specificity when expanding: never fall back to generic math.
    extra_subtopics = [f"{base} {subtopic} shorts" for subtopic in subtopics[4:]]
    expansions = tuple(extra_subtopics + [f"{base} {suffix}" for suffix in
                       ("tutorial short", "worked example #shorts", "concept explained in 60 seconds", "educational short video")])
    return Plan(topic, concepts, level, tuple(subtopics), tuple(dict.fromkeys(queries)), expansions, broad)


def relevance(plan: Plan, video: dict) -> float:
    snippet = video.get("snippet", {})
    title = set(tokens(snippet.get("title", "")))
    body = set(tokens(snippet.get("description", "")[:3000] + " " + " ".join(snippet.get("tags", []))))
    concepts = set(plan.concepts)
    present = title | body
    if {"like", "term"} <= present or {"distributive", "property"} <= present:
        present |= {"simplify", "algebra", "expression"}
    if plan.broad:
        domain_terms = set(tokens(" ".join(plan.subtopics)))
        if "calculus" in concepts:
            domain_terms = {"derivative", "integral", "limit", "differentiation", "integration", "antiderivative", "taylor"}
        if present & domain_terms:
            present |= concepts
    overlap = concepts & present
    # No lexical evidence is not relevant, even if YouTube returned it.
    if not overlap:
        return 0.0
    if plan.broad:
        domain_terms = set(tokens(" ".join(plan.subtopics)))
        if not (present & (concepts | domain_terms)):
            return 0.0
    elif len(concepts) >= 3 and len(overlap) / len(concepts) < 0.4:
        return 0.0
    score = (2 * len(concepts & title) + len(overlap)) / max(1, len(concepts))
    if "simplify" in concepts:
        related = {"like", "term", "distributive", "simplify", "expression"}
        # Generic algebra or grade tags alone are insufficient for this request.
        if not present & related:
            return 0.0
        score += 0.3 * len(present & related)
    if {"graph", "theory"} <= concepts and not {"graph", "theory"} <= present:
        return 0.0
    if plan.level:
        score += 0.5 if set(tokens(plan.level)) <= present else 0
        desired = re.search(r"\d+", " ".join(tokens(plan.level)))
        actual = re.search(r"\b(?:grade\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)?\s*grade)\b", snippet.get("title", ""), re.I)
        if desired and actual and desired.group() not in actual.groups():
            score -= 0.7
    return max(0.0, score)


def rank(plan: Plan, videos: List[dict]) -> Iterator[dict]:
    scored = [(relevance(plan, v), v) for v in videos]
    scored = [(s, v) for s, v in scored if s > 0]
    if not plan.broad:
        yield from (v for _, v in sorted(scored, key=lambda pair: pair[0], reverse=True))
        return
    # Keep each title's largest similarity incrementally: quadratic rather than
    # recomputing all previous comparisons for every selection of a large pool.
    pool = [[s, v, set(tokens(v.get("snippet", {}).get("title", ""))), 0.0] for s, v in scored]
    while pool:
        best = max(range(len(pool)), key=lambda i: pool[i][0] - 0.6 * pool[i][3])
        _, video, title, _ = pool.pop(best)
        for entry in pool:
            entry[3] = max(entry[3], len(title & entry[2]) / max(1, len(title | entry[2])))
        yield video
