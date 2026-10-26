"""ELM/STN response parsing. Raw text is kept by the caller."""

from __future__ import annotations

import re

HEX_TOKEN = re.compile(r"^[0-9A-Fa-f]{2}$")
HEADER_TOKEN = re.compile(r"^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{8}$")

NOISE_LINES = {
    "SEARCHING...",
    "SEARCHING",
    "BUS INIT: OK",
    "BUS INIT: ERROR",
    "BUS INIT...",
}

STOP_LINES = {
    "NO DATA": "NO_DATA",
    "UNABLE TO CONNECT": "NO_DATA",
    "STOPPED": "TIMEOUT",
    "CAN ERROR": "NO_DATA",
    "?": "NO_DATA",
    "BUFFER FULL": "NO_DATA",
}


class Frame:
    def __init__(self, header: str | None, payload: bytes, raw_line: str):
        self.header = header.upper() if header else None
        self.payload = payload
        self.raw_line = raw_line

    @property
    def service(self) -> int | None:
        if not self.payload:
            return None
        return self.payload[0]

    def is_negative(self) -> bool:
        return bool(self.payload) and self.payload[0] == 0x7F

    def negative_code(self) -> int | None:
        if self.is_negative() and len(self.payload) >= 3:
            return self.payload[2]
        return None


def parse_response(text: str) -> tuple[str, list[Frame]]:
    """Return (quality, frames).

    quality is OK when at least one data frame exists.
    NEGATIVE_RESPONSE, NO_DATA, TIMEOUT, or DECODE_ERROR otherwise.
    """
    if text is None:
        return "NO_DATA", []
    lines = [line.strip() for line in text.replace("\r", "\n").split("\n")]
    lines = [line for line in lines if line and line.upper() not in NOISE_LINES and line != ">"]
    if not lines:
        return "NO_DATA", []
    upper = [line.upper() for line in lines]
    for line in upper:
        if line in STOP_LINES and len(lines) == 1:
            return STOP_LINES[line], []
    frames: list[Frame] = []
    for line in lines:
        if line.upper() in STOP_LINES or line.upper() in NOISE_LINES:
            continue
        frame = parse_line(line)
        if frame is not None:
            frames.append(frame)
    if not frames:
        if any(line.upper() in STOP_LINES for line in lines):
            token = next(line.upper() for line in lines if line.upper() in STOP_LINES)
            return STOP_LINES[token], []
        return "DECODE_ERROR", []
    if all(frame.is_negative() for frame in frames):
        return "NEGATIVE_RESPONSE", frames
    return "OK", frames


def parse_line(line: str) -> Frame | None:
    tokens = line.replace("-", " ").split()
    if not tokens:
        return None
    header = None
    data_tokens = tokens
    if HEADER_TOKEN.match(tokens[0]) and not HEX_TOKEN.match(tokens[0]):
        header = tokens[0]
        data_tokens = tokens[1:]
    if not data_tokens or not all(HEX_TOKEN.match(tok) for tok in data_tokens):
        return None
    raw = bytes(int(tok, 16) for tok in data_tokens)
    payload = _strip_pci(raw)
    if payload is None:
        return None
    return Frame(header, payload, line.strip())


def _strip_pci(raw: bytes) -> bytes | None:
    if not raw:
        return None
    # ISO-TP single frame: length nibble in the first byte, then payload.
    if raw[0] <= 0x0F and len(raw) >= 2 and _looks_like_service(raw[1]):
        length = raw[0]
        return raw[1 : 1 + length] if length else raw[1:]
    if _looks_like_service(raw[0]):
        return raw
    for index, byte in enumerate(raw):
        if _looks_like_service(byte):
            return raw[index:]
    return raw


def _looks_like_service(byte: int) -> bool:
    if byte == 0x7F:
        return True
    return byte in (0x41, 0x43, 0x46, 0x47, 0x49, 0x4A)


def encode_bitmap(group_base: int, pids: set[int]) -> bytes:
    """4-byte SAE support bitmap for PIDs group_base+1 .. group_base+0x20."""
    value = 0
    for pid in pids:
        if not (group_base < pid <= group_base + 0x20):
            continue
        shift = 31 - (pid - group_base - 1)
        value |= 1 << shift
    return value.to_bytes(4, "big")


def decode_bitmap(group_base: int, raw: bytes) -> set[int]:
    if len(raw) < 4:
        raise ValueError("bitmap needs 4 bytes")
    value = int.from_bytes(raw[:4], "big")
    found = set()
    for offset in range(32):
        shift = 31 - offset
        if value & (1 << shift):
            found.add(group_base + 1 + offset)
    return found


def bitmap_hex(raw: bytes) -> str:
    return raw[:4].hex().upper()


def mode01_payload(pid: int, data: bytes) -> str:
    """Build a headerless ELM line: 41 PID DATA."""
    body = bytes([0x41, pid]) + data
    return " ".join(f"{byte:02X}" for byte in body)


def can_line(header: str, payload: bytes) -> str:
    """ISO-TP single frame with PCI length."""
    pci = len(payload)
    raw = bytes([pci]) + payload
    hexes = " ".join(f"{byte:02X}" for byte in raw)
    return f"{header} {hexes}"


PREFERRED_ECUS = ("7E8", "18DAF110")


def select_analysis_frame(frames: list[Frame]) -> tuple[Frame | None, str]:
    """Pick the frame analysis may use. Ambiguous multi-ECU responses are not guessed."""
    usable = [frame for frame in frames if not frame.is_negative()]
    if not usable:
        return None, "NEGATIVE_RESPONSE"
    preferred = [frame for frame in usable if frame.header in PREFERRED_ECUS]
    if preferred:
        return preferred[0], "OK"
    headers = {frame.header for frame in usable}
    if len(usable) == 1:
        return usable[0], "OK"
    if headers == {None} and len(usable) == 1:
        return usable[0], "OK"
    if len(headers) > 1:
        return None, "AMBIGUOUS_ECU"
    return usable[0], "OK"


def decode_vin(payload: bytes) -> tuple[str | None, str]:
    """Mode 09 PID 02 payload starting at 49 02, or the data after that."""
    data = payload
    if len(data) >= 2 and data[0] == 0x49 and data[1] == 0x02:
        data = data[2:]
    if data and data[0] in (0x01, 0x02, 0x03, 0x04, 0x05) and len(data) > 17:
        # Message count byte used by mode 09.
        data = data[1:]
    # Drop leading frame-index bytes that are below 0x30 when more than 17 remain.
    chars = []
    for byte in data:
        if 48 <= byte <= 57 or 65 <= byte <= 90:
            chars.append(chr(byte))
        elif byte in (0x00, 0x01, 0x02, 0x03, 0x04, 0x05) and len(chars) == 0:
            continue
        elif byte == 0x00:
            continue
        else:
            # Non VIN byte. Keep scanning only if we have not started.
            if chars:
                break
    vin = "".join(chars)
    if len(vin) < 17:
        return None, "short"
    vin = vin[:17]
    if not _vin_charset(vin):
        return None, "invalid_charset"
    return vin, "ok"


def _vin_charset(vin: str) -> bool:
    allowed = set("ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
    return len(vin) == 17 and all(ch in allowed for ch in vin)


def decode_dtcs(payload: bytes, protocol_number: str | None) -> dict:
    """Identifier translation only. claim is always NONE."""
    result = {
        "raw_hex": payload.hex().upper(),
        "codes": [],
        "dtc_count": None,
        "parse_status": "INSUFFICIENT_EVIDENCE",
        "claim": "NONE",
    }
    if not payload:
        result["parse_status"] = "NO_DATA"
        result["dtc_count"] = 0
        return result
    service = payload[0]
    if service == 0x7F:
        result["parse_status"] = "NEGATIVE_RESPONSE"
        return result
    body = payload[1:]
    can = protocol_number in {"6", "7", "8", "9", "A", "B", "C"}
    if can:
        if len(body) % 2 == 1:
            result["parse_status"] = "ORDER_INDETERMINATE"
            result["dtc_count"] = None
            return result
        codes = []
        for index in range(0, len(body), 2):
            pair = body[index : index + 2]
            if pair == b"\x00\x00":
                continue
            codes.append(_format_dtc(pair))
        result["codes"] = codes
        result["dtc_count"] = len(codes)
        result["parse_status"] = "OK"
        return result
    # Non-CAN formats are not guessed. Store raw.
    result["parse_status"] = "UNTESTED"
    result["reason"] = "DTC pair layout is only applied to ISO 15765 protocol numbers"
    return result


def _format_dtc(pair: bytes) -> str:
    first = pair[0]
    kind = "PCBU"[first >> 6]
    digit1 = (first >> 4) & 0x03
    rest = f"{first & 0x0F:X}{pair[1]:02X}"
    return f"{kind}{digit1}{rest}"
