"""Shared never-lower safety helpers (hackathon build)."""
from . import ledger as L


def higher(a, b):
    """The more severe of two levels; unknown levels never win over known ones."""
    if a not in L.SAFETY_ORDER:
        return b if b in L.SAFETY_ORDER else a
    if b not in L.SAFETY_ORDER:
        return a
    return a if L.SAFETY_ORDER.index(a) >= L.SAFETY_ORDER.index(b) else b


def apply_floor(result, floor, reason, source):
    """Raise result['safety']['level'] to at least `floor`. Never lowers. Returns action."""
    if floor not in L.SAFETY_ORDER:
        return "no_floor"
    s = result.setdefault("safety", {})
    cur = s.get("level")
    new = higher(cur, floor)
    det = result.get("detective")
    if new == cur:
        return "kept_level"
    s.setdefault("rule_level", cur)
    s["level"] = new
    s.setdefault("triggering_conditions", []).append(f"{source} raised the level: {reason}"[:240])
    if isinstance(det, dict):
        det["final_safety_level"] = higher(det.get("final_safety_level"), new)
    return f"raised_by_{source}"
