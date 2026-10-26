"""ELM327 / STN command session. Mode 04 (clear DTCs) is refused."""

from __future__ import annotations

from vicore.formula import FormulaError, decode
from vicore.models import Observation
from vicore.obdparse import (
    Frame,
    parse_response,
    select_analysis_frame,
)
from vicore.registry import obd_command
from vicore.timeutil import iso_from_epoch
from vicore.transport import AdapterTimeout, TransportError

FORBIDDEN_PREFIXES = ("04",)


class UnsafeCommand(RuntimeError):
    pass


def assert_safe_command(command: str) -> str:
    compact = command.strip().upper().replace(" ", "")
    if not compact:
        raise UnsafeCommand("empty command")
    if compact.startswith(FORBIDDEN_PREFIXES):
        raise UnsafeCommand("refusing to clear diagnostic trouble codes")
    allowed = compact.startswith(("AT", "ST", "01", "03", "06", "07", "09", "0A"))
    if not allowed:
        raise UnsafeCommand(f"command not on the read-only allow list: {command}")
    return compact


class ElmSession:
    def __init__(self, transport, clock, *, timeout: float = 2.0):
        self.transport = transport
        self.clock = clock
        self.timeout = timeout
        self.transcript: list[dict] = []
        self.protocol_name = ""
        self.protocol_number = ""

    def request(self, command: str, timeout: float | None = None) -> str:
        compact = assert_safe_command(command)
        limit = self.timeout if timeout is None else timeout
        started = self.clock.wall()
        try:
            body = self.transport.exchange(compact, limit)
        except AdapterTimeout:
            self.transcript.append(
                {
                    "t": iso_from_epoch(started),
                    "command": compact,
                    "response": "",
                    "quality": "TIMEOUT",
                }
            )
            raise
        except TransportError as exc:
            self.transcript.append(
                {
                    "t": iso_from_epoch(started),
                    "command": compact,
                    "response": "",
                    "quality": "TRANSPORT_LOST",
                    "error": str(exc),
                }
            )
            raise
        self.transcript.append(
            {
                "t": iso_from_epoch(self.clock.wall()),
                "command": compact,
                "response": body,
                "quality": "OK",
            }
        )
        return body

    def initialize(self) -> None:
        # ATZ resets the adapter, not the vehicle. Echo comes back on.
        self.request("ATZ", timeout=5.0)
        for command in ("ATE0", "ATL0", "ATS1", "ATH1", "ATAT1", "ATAL", "ATCAF1", "ATSP0"):
            self.request(command, timeout=2.0)

    def read_signal(
        self,
        signal: dict,
        *,
        vehicle_id: str,
        session_id: str,
        sequence_start: int,
        protocol: str,
    ) -> list[Observation]:
        """One request. One observation per ECU frame. Raw adapter text is kept."""
        if signal["signal_id"] == "adapter_voltage":
            return self._read_atrv(
                signal,
                vehicle_id=vehicle_id,
                session_id=session_id,
                sequence_start=sequence_start,
                protocol=protocol,
            )
        command = obd_command(signal)
        if command is None:
            raise UnsafeCommand(f"{signal['signal_id']} is not an OBD request")
        request_wall = self.clock.wall()
        request_mono = self.clock.mono()
        try:
            body = self.request(command, timeout=1.5)
        except AdapterTimeout:
            return [
                _obs(
                    signal,
                    vehicle_id,
                    session_id,
                    sequence_start,
                    protocol,
                    request_wall,
                    request_mono,
                    self.clock.wall(),
                    self.clock.mono(),
                    raw_value="",
                    decoded=None,
                    quality="TIMEOUT",
                    ecu=None,
                )
            ]
        except TransportError:
            return [
                _obs(
                    signal,
                    vehicle_id,
                    session_id,
                    sequence_start,
                    protocol,
                    request_wall,
                    request_mono,
                    self.clock.wall(),
                    self.clock.mono(),
                    raw_value="",
                    decoded=None,
                    quality="TRANSPORT_LOST",
                    ecu=None,
                )
            ]
        response_wall = self.clock.wall()
        response_mono = self.clock.mono()
        quality, frames = parse_response(body)
        if not frames:
            return [
                _obs(
                    signal,
                    vehicle_id,
                    session_id,
                    sequence_start,
                    protocol,
                    request_wall,
                    request_mono,
                    response_wall,
                    response_mono,
                    raw_value=body,
                    decoded=None,
                    quality=quality,
                    ecu=None,
                )
            ]
        chosen, chosen_quality = select_analysis_frame(frames)
        observations = []
        for index, frame in enumerate(frames):
            decoded, decoded_quality, text = _decode_frame(signal, frame)
            use_quality = decoded_quality
            if chosen is None:
                use_quality = chosen_quality if use_quality == "OK" else use_quality
            elif frame is not chosen and use_quality == "OK":
                # Stored, but not the analysis frame when another ECU also answered.
                pass
            observations.append(
                _obs(
                    signal,
                    vehicle_id,
                    session_id,
                    sequence_start + index,
                    protocol,
                    request_wall,
                    request_mono,
                    response_wall,
                    response_mono,
                    raw_value=frame.raw_line,
                    decoded=decoded,
                    quality=use_quality,
                    ecu=frame.header,
                    decoded_text=text,
                )
            )
        return observations


def _decode_frame(signal: dict, frame: Frame) -> tuple[float | None, str, str | None]:
    if frame.is_negative():
        code = frame.negative_code()
        return None, "NEGATIVE_RESPONSE", f"7F {code}" if code is not None else "7F"
    payload = frame.payload
    if len(payload) < 2 or payload[0] != 0x41:
        return None, "DECODE_ERROR", None
    pid = int(signal["identifier"], 16)
    if payload[1] != pid:
        return None, "DECODE_ERROR", None
    data = payload[2:]
    try:
        value = decode(signal["formula"], data)
    except (FormulaError, ValueError):
        return None, "DECODE_ERROR", None
    return value, "OK", None


def _read_atrv_builder():
    return None


def _obs(
    signal,
    vehicle_id,
    session_id,
    sequence,
    protocol,
    request_wall,
    request_mono,
    response_wall,
    response_mono,
    raw_value,
    decoded,
    quality,
    ecu,
    decoded_text=None,
) -> Observation:
    return Observation(
        vehicle_id=vehicle_id,
        session_id=session_id,
        signal_id=signal["signal_id"],
        request_timestamp=iso_from_epoch(request_wall),
        response_timestamp=iso_from_epoch(response_wall),
        request_mono=request_mono,
        response_mono=response_mono,
        raw_value=raw_value,
        decoded_value=decoded,
        unit=signal.get("unit"),
        quality=quality,
        protocol=protocol,
        ecu=ecu,
        sequence_number=sequence,
        decoded_text=decoded_text,
    )


def _atrv_on_session(session: ElmSession, signal, vehicle_id, session_id, sequence, protocol):
    request_wall = session.clock.wall()
    request_mono = session.clock.mono()
    try:
        body = session.request("ATRV", timeout=1.5)
    except AdapterTimeout:
        return [
            _obs(
                signal, vehicle_id, session_id, sequence, protocol,
                request_wall, request_mono, session.clock.wall(), session.clock.mono(),
                "", None, "TIMEOUT", None,
            )
        ]
    except TransportError:
        return [
            _obs(
                signal, vehicle_id, session_id, sequence, protocol,
                request_wall, request_mono, session.clock.wall(), session.clock.mono(),
                "", None, "TRANSPORT_LOST", None,
            )
        ]
    try:
        value = decode(signal["formula"], body.encode("ascii"))
        quality = "OK"
    except (FormulaError, ValueError):
        value = None
        quality = "DECODE_ERROR"
    return [
        _obs(
            signal, vehicle_id, session_id, sequence, protocol,
            request_wall, request_mono, session.clock.wall(), session.clock.mono(),
            body, value, quality, "ADAPTER",
        )
    ]


ElmSession._read_atrv = lambda self, signal, vehicle_id, session_id, sequence_start, protocol: _atrv_on_session(
    self, signal, vehicle_id, session_id, sequence_start, protocol
)
