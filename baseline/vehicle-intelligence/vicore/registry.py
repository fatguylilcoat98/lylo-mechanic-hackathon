"""Signal registry. Analysis code must request signals through this module."""

from __future__ import annotations

import json
from pathlib import Path

from vicore.registry_data import SIGNAL_DEFS, SOURCE_KINDS

REQUIRED_FIELDS = (
    "signal_id",
    "protocol",
    "service",
    "identifier",
    "official_name",
    "unit",
    "formula",
    "range",
    "support_detection",
    "source_kind",
    "dependencies",
    "nonindependent_signals",
    "minimum_rate",
    "transport_constraints",
    "misinterpretations",
    "source_reference",
)

JSON_PATH = Path(__file__).resolve().parent / "data" / "signals.json"


class UnknownSignal(KeyError):
    pass


class RegistryError(ValueError):
    pass


def validate_definition(item: dict) -> None:
    missing = [key for key in REQUIRED_FIELDS if key not in item]
    if missing:
        raise RegistryError(f"{item.get('signal_id')} missing {missing}")
    if item["source_kind"] not in SOURCE_KINDS:
        raise RegistryError(f"{item['signal_id']} bad source_kind {item['source_kind']}")
    rate = item["minimum_rate"]
    if not isinstance(rate, dict) or rate.get("unit") != "Hz":
        raise RegistryError(f"{item['signal_id']} minimum_rate must be {{value, unit: Hz}}")
    if not isinstance(item["formula"], dict) or "op" not in item["formula"]:
        raise RegistryError(f"{item['signal_id']} formula missing op")
    if not isinstance(item["dependencies"], list):
        raise RegistryError(f"{item['signal_id']} dependencies must be a list")
    if not isinstance(item["nonindependent_signals"], list):
        raise RegistryError(f"{item['signal_id']} nonindependent_signals must be a list")
    if not isinstance(item["misinterpretations"], list):
        raise RegistryError(f"{item['signal_id']} misinterpretations must be a list")


def load_registry(defs: list[dict] | None = None) -> dict[str, dict]:
    items = defs if defs is not None else SIGNAL_DEFS
    registry: dict[str, dict] = {}
    for item in items:
        validate_definition(item)
        sid = item["signal_id"]
        if sid in registry:
            raise RegistryError(f"duplicate signal {sid}")
        registry[sid] = item
    known = set(registry)
    for item in registry.values():
        for dep in item["dependencies"]:
            if dep.startswith("physical:"):
                continue
            if dep not in known:
                raise RegistryError(f"{item['signal_id']} dependency {dep} is not in the registry")
        for other in item["nonindependent_signals"]:
            if other not in known:
                raise RegistryError(
                    f"{item['signal_id']} nonindependent signal {other} is not in the registry"
                )
    return registry


def require_signal(registry: dict[str, dict], signal_id: str) -> dict:
    if signal_id not in registry:
        raise UnknownSignal(signal_id)
    return registry[signal_id]


def export_json(path: Path | None = None) -> Path:
    registry = load_registry()
    target = path or JSON_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = [registry[sid] for sid in sorted(registry)]
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return target


def pid_hex(signal: dict) -> int | None:
    if signal["support_detection"].get("type") != "mode01_bitmap":
        return None
    return int(signal["identifier"], 16)


def obd_command(signal: dict) -> str | None:
    """Return the request command, or None if this signal is not an OBD request."""
    if signal["protocol"] != "SAE_J1979":
        return None
    return f"{signal['service']}{signal['identifier']}"
