"""Safe PID formula interpreter. No eval."""

from __future__ import annotations


class FormulaError(ValueError):
    pass


def _need(data: bytes, n: int) -> None:
    if len(data) < n:
        raise FormulaError(f"need {n} data bytes, got {len(data)}")


def decode(formula: dict, data: bytes) -> float | None:
    op = formula.get("op")
    if op == "u8_add":
        _need(data, 1)
        return float(data[0] + formula["add"])
    if op == "u16_div":
        _need(data, 2)
        return ((data[0] << 8) | data[1]) / float(formula["divisor"])
    if op == "percent_255":
        _need(data, 1)
        return data[0] * 100.0 / 255.0
    if op == "percent_128":
        _need(data, 1)
        return (data[0] - 128) * 100.0 / 128.0
    if op == "bitfield":
        _need(data, 1)
        return float(data[0])
    if op == "half_minus_64":
        _need(data, 1)
        return data[0] / 2.0 - 64.0
    if op == "atrv":
        text = data.decode("ascii", errors="replace").strip().upper().rstrip("V").strip()
        if not text:
            raise FormulaError("empty ATRV")
        return float(text)
    if op == "decimal_text":
        text = data.decode("ascii", errors="replace").strip()
        if not text:
            raise FormulaError("empty decimal")
        return float(text)
    if op == "link_flag":
        _need(data, 1)
        return float(data[0])
    raise FormulaError(f"unknown formula op {op!r}")


def encode(formula: dict, value: float) -> bytes:
    """Inverse used by fixtures so raw bytes and decoded values agree."""
    op = formula.get("op")
    if op == "u8_add":
        raw = int(round(value - formula["add"]))
        if not 0 <= raw <= 255:
            raise FormulaError("u8 out of range")
        return bytes([raw])
    if op == "u16_div":
        raw = int(round(value * float(formula["divisor"])))
        if not 0 <= raw <= 65535:
            raise FormulaError("u16 out of range")
        return bytes([(raw >> 8) & 0xFF, raw & 0xFF])
    if op == "percent_255":
        raw = int(round(value / 100.0 * 255.0))
        raw = max(0, min(255, raw))
        return bytes([raw])
    if op == "percent_128":
        raw = int(round(value / 100.0 * 128.0 + 128.0))
        raw = max(0, min(255, raw))
        return bytes([raw])
    if op == "bitfield":
        raw = int(round(value))
        if not 0 <= raw <= 255:
            raise FormulaError("bitfield out of range")
        return bytes([raw])
    if op == "half_minus_64":
        raw = int(round((value + 64.0) * 2.0))
        raw = max(0, min(255, raw))
        return bytes([raw])
    if op == "atrv":
        return f"{value:.2f}V".encode("ascii")
    if op == "decimal_text":
        return f"{value:.3f}".encode("ascii")
    if op == "link_flag":
        return bytes([1 if value else 0])
    raise FormulaError(f"unknown formula op {op!r}")
