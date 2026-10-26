"""Wiring before parts: rule-based hint for sensor/circuit-type trouble codes."""
import re

WIRING_TEXT = ("Often it's the wire or plug, not the sensor. Check the connector and wiring "
               "(corrosion, loose plug, chafed wire) before replacing the sensor.")
# SAE generic sensor / circuit code ranges (hex-free P0 codes), inclusive.
_RANGES = [(30, 64), (100, 125), (130, 167), (190, 199), (220, 229), (325, 349), (500, 503),
           (705, 723), (1100, 1199)]
_TITLE = re.compile(r"circuit|heater|range/performance|low input|high input|sensor .*(low|high)", re.I)


def is_circuit_code(code, title=None):
    c = str(code or "").upper()
    if title and _TITLE.search(str(title)):
        return True
    m = re.fullmatch(r"P0(\d{3})", c)
    return bool(m) and any(a <= int(m.group(1)) <= b for a, b in _RANGES)


def hint_item(items):
    codes = sorted({i.get("code") for i in items if i.get("type") == "dtc" and is_circuit_code(i.get("code"))})
    if not codes:
        return None
    return {"id": "rule:wiring_first", "type": "rule_hint", "source": "rules", "codes": codes, "text": WIRING_TEXT}
