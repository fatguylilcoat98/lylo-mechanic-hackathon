"""Engineering status. Numbers come from the database."""

from __future__ import annotations

import json

from vicore.db import Database
from vicore.features import FEATURE_SPECS
from vicore.pipeline import latest_profile
from vicore.trust import virtual_status


def latest_session_id(db: Database) -> str | None:
    row = db.execute(
        "SELECT session_id FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    return row["session_id"]


def build_status(db: Database, session_id: str | None = None) -> dict:
    session_id = session_id or latest_session_id(db)
    if session_id is None:
        return {
            "session_id": None,
            "hardware_tested": False,
            "connected_vehicle": None,
            "protocol": None,
            "supported_signals": [],
            "acquisition_rate": None,
            "current_state": None,
            "sensor_trust": {},
            "live_values": {},
            "recorded_events": [],
            "baseline_epoch": None,
            "experiment_results": [],
            "capability_warnings": ["no session recorded"],
            "mode06_o2_trend": {"state": "UNTESTED", "o2_trend_computed": False},
            "virtual_sensors": {},
        }
    session = db.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    vehicle = db.execute(
        "SELECT * FROM vehicles WHERE vehicle_id = ?", (session["vehicle_id"],)
    ).fetchone()
    profile = latest_profile(
        db, session_id, ("replay_gate", "benchmarked", "handshake", "fixture_capability")
    ) or {}
    trust_rows = db.execute(
        """
        SELECT signal_id, state, anchor_result, reason, updated_at
        FROM sensor_trust
        WHERE session_id = ?
        ORDER BY trust_id ASC
        """,
        (session_id,),
    ).fetchall()
    trust = {}
    for row in trust_rows:
        trust[row["signal_id"]] = {
            "state": row["state"],
            "anchor_result": row["anchor_result"],
            "reason": row["reason"],
        }
    state_row = db.execute(
        """
        SELECT state, start_time, end_time, confidence, reason
        FROM vehicle_states
        WHERE session_id = ?
        ORDER BY state_row_id DESC LIMIT 1
        """,
        (session_id,),
    ).fetchone()
    events = db.execute(
        """
        SELECT event_id, trigger_source, trigger_detail, triggered_at, window_start,
               window_end, frozen, order_status, overwritten, post_window_complete
        FROM events WHERE session_id = ? ORDER BY triggered_at
        """,
        (session_id,),
    ).fetchall()
    experiments = db.execute(
        """
        SELECT experiment_id, status, reason, result_json, created_at
        FROM experiment_results
        WHERE session_id = ?
        ORDER BY result_id ASC
        """,
        (session_id,),
    ).fetchall()
    # Last row per experiment wins.
    experiment_map = {}
    for row in experiments:
        experiment_map[row["experiment_id"]] = {
            "status": row["status"],
            "reason": row["reason"],
            "result": json.loads(row["result_json"]),
        }
    live = {}
    value_rows = db.execute(
        """
        SELECT signal_id, decoded_value, unit, quality, response_timestamp
        FROM observations
        WHERE session_id = ? AND quality = 'OK' AND decoded_value IS NOT NULL
        ORDER BY sequence_number ASC
        """,
        (session_id,),
    ).fetchall()
    for row in value_rows:
        live[row["signal_id"]] = {
            "value": row["decoded_value"],
            "unit": row["unit"],
            "at": row["response_timestamp"],
        }
    epoch = db.execute(
        """
        SELECT * FROM baseline_epochs
        WHERE vehicle_id = ?
        ORDER BY started_at DESC LIMIT 1
        """,
        (session["vehicle_id"],),
    ).fetchone()
    warnings = []
    for feature_id, feature in (profile.get("features") or {}).items():
        if feature.get("state") != "FULL":
            label = feature.get("label") or FEATURE_SPECS.get(feature_id, {}).get("label") or feature_id
            warnings.append(f"{label}: {feature.get('state')} — {feature.get('reason')}")
    mode06 = (profile.get("diagnostic") or {}).get("mode06") or profile.get("mode06") or {}
    mode06_state = mode06.get("state", "UNTESTED")
    if mode06_state == "FULL":
        mode06_state = "SUPPORTED"
    supported = sorted(
        signal_id
        for signal_id, entry in (profile.get("signals") or {}).items()
        if entry.get("state") == "FULL"
    )
    gate = (profile.get("features") or {}).get("state_detector") or {}
    current = None
    if state_row is not None:
        current = {
            "state": state_row["state"],
            "start_time": state_row["start_time"],
            "end_time": state_row["end_time"],
            "confidence": state_row["confidence"],
            "reason": state_row["reason"],
        }
    elif gate and not _allows(gate.get("state")):
        current = {"state": None, "reason": gate.get("reason"), "blocked": True}
    return {
        "session_id": session_id,
        "source": session["source"],
        "hardware_tested": bool(session["hardware_tested"]),
        "connected_vehicle": {
            "vehicle_id": vehicle["vehicle_id"],
            "vin": vehicle["vin"],
            "vin_status": vehicle["vin_status"],
        },
        "protocol": profile.get("protocol"),
        "supported_signals": supported,
        "acquisition_rate": {
            "sustained_feature_rate_hz": profile.get("sustained_feature_rate_hz"),
            "definition": profile.get("sustained_feature_rate_definition"),
            "tiers": (profile.get("acquisition_benchmark") or {}).get("tiers"),
        },
        "current_state": current,
        "sensor_trust": trust,
        "live_values": live,
        "recorded_events": [
            {
                "event_id": row["event_id"],
                "trigger_source": row["trigger_source"],
                "trigger_detail": json.loads(row["trigger_detail"]),
                "triggered_at": row["triggered_at"],
                "window_start": row["window_start"],
                "window_end": row["window_end"],
                "frozen": bool(row["frozen"]),
                "overwritten": bool(row["overwritten"]),
                "order_status": row["order_status"],
                "post_window_complete": bool(row["post_window_complete"]),
            }
            for row in events
        ],
        "baseline_epoch": None
        if epoch is None
        else {
            "epoch_id": epoch["epoch_id"],
            "status": epoch["status"],
            "reason_started": epoch["reason_started"],
            "started_at": epoch["started_at"],
            "invalidation_reason": epoch["invalidation_reason"],
        },
        "experiment_results": experiment_map,
        "capability_warnings": warnings,
        "mode06_o2_trend": {
            "state": mode06_state,
            "o2_trend_computed": bool(mode06.get("o2_trend_computed", False)),
        },
        "virtual_sensors": virtual_status({sid: item["state"] for sid, item in trust.items()}),
        "phone_sensors": profile.get("phone_sensors"),
    }


def _allows(state: str | None) -> bool:
    return state in ("FULL", "REDUCED")


def render_text(status: dict) -> str:
    lines = []
    vehicle = status.get("connected_vehicle") or {}
    lines.append(f"CONNECTED VEHICLE: {vehicle.get('vehicle_id')} vin_status={vehicle.get('vin_status')}")
    protocol = status.get("protocol") or {}
    lines.append(f"PROTOCOL: {protocol.get('name')} ({protocol.get('number')})")
    lines.append("SUPPORTED SIGNALS: " + ", ".join(status.get("supported_signals") or []))
    rate = (status.get("acquisition_rate") or {}).get("sustained_feature_rate_hz")
    lines.append(f"CURRENT ACQUISITION RATE: {rate}")
    current = status.get("current_state") or {}
    lines.append(f"CURRENT STATE: {current.get('state')} {current.get('reason') or ''}")
    lines.append("SENSOR TRUST:")
    for signal_id, item in sorted((status.get("sensor_trust") or {}).items()):
        lines.append(f"  {signal_id}: {item['state']}")
    lines.append("LIVE VALUES:")
    for signal_id, item in sorted((status.get("live_values") or {}).items()):
        lines.append(f"  {signal_id}: {item['value']} {item.get('unit') or ''}")
    lines.append(f"RECORDED EVENTS: {len(status.get('recorded_events') or [])}")
    for event in status.get("recorded_events") or []:
        lines.append(
            f"  {event['trigger_source']} frozen={event['frozen']} order={event['order_status']} overwritten={event['overwritten']}"
        )
    epoch = status.get("baseline_epoch") or {}
    lines.append(f"BASELINE EPOCH: {epoch.get('epoch_id')} {epoch.get('reason_started')} {epoch.get('status')}")
    lines.append("EXPERIMENT RESULTS:")
    for experiment_id, item in sorted((status.get("experiment_results") or {}).items()):
        lines.append(f"  {experiment_id}: {item['status']} {item['reason']}")
    lines.append("CAPABILITY WARNINGS:")
    for warning in status.get("capability_warnings") or []:
        lines.append(f"  {warning}")
    mode06 = status.get("mode06_o2_trend") or {}
    lines.append(f"Mode $06 O2 Trend: {mode06.get('state')}")
    lines.append(f"HARDWARE TESTED: {status.get('hardware_tested')}")
    return "\n".join(lines)


def render_html(status: dict) -> str:
    import html

    def esc(value) -> str:
        return html.escape("" if value is None else str(value))

    vehicle = status.get("connected_vehicle") or {}
    protocol = status.get("protocol") or {}
    rate = (status.get("acquisition_rate") or {}).get("sustained_feature_rate_hz")
    current = status.get("current_state") or {}
    epoch = status.get("baseline_epoch") or {}
    mode06 = status.get("mode06_o2_trend") or {}
    parts = [
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>vicore evidence</title>",
        "<style>body{background:#111;color:#ddd;font:14px monospace;margin:16px}",
        "h1,h2{color:#9f9;font-size:16px} table{border-collapse:collapse;margin:8px 0 16px}",
        "td,th{border:1px solid #444;padding:4px 8px;text-align:left}",
        ".bad{color:#f88}.warn{color:#fc6}</style></head><body>",
        "<h1>VEHICLE EVIDENCE</h1>",
        f"<p>hardware_tested={esc(status.get('hardware_tested'))} session={esc(status.get('session_id'))}</p>",
        "<h2>CONNECTED VEHICLE</h2>",
        f"<p>{esc(vehicle.get('vehicle_id'))} vin_status={esc(vehicle.get('vin_status'))}</p>",
        "<h2>PROTOCOL</h2>",
        f"<p>{esc(protocol.get('name'))} number={esc(protocol.get('number'))}</p>",
        "<h2>SUPPORTED SIGNALS</h2><p>",
        esc(", ".join(status.get("supported_signals") or [])),
        "</p>",
        "<h2>CURRENT ACQUISITION RATE</h2>",
        f"<p>{esc(rate)}</p>",
        "<h2>CURRENT STATE</h2>",
        f"<p>{esc(current.get('state'))} {esc(current.get('reason'))}</p>",
        "<h2>SENSOR TRUST</h2><table><tr><th>signal</th><th>state</th></tr>",
    ]
    for signal_id, item in sorted((status.get("sensor_trust") or {}).items()):
        parts.append(f"<tr><td>{esc(signal_id)}</td><td>{esc(item['state'])}</td></tr>")
    parts.append("</table><h2>LIVE VALUES</h2><table><tr><th>signal</th><th>value</th><th>unit</th></tr>")
    for signal_id, item in sorted((status.get("live_values") or {}).items()):
        parts.append(
            f"<tr><td>{esc(signal_id)}</td><td>{esc(item['value'])}</td><td>{esc(item.get('unit'))}</td></tr>"
        )
    parts.append("</table><h2>RECORDED EVENTS</h2><table><tr><th>trigger</th><th>frozen</th><th>order</th><th>overwritten</th></tr>")
    for event in status.get("recorded_events") or []:
        parts.append(
            "<tr><td>{src}</td><td>{frozen}</td><td>{order}</td><td>{over}</td></tr>".format(
                src=esc(event["trigger_source"]),
                frozen=esc(event["frozen"]),
                order=esc(event["order_status"]),
                over=esc(event["overwritten"]),
            )
        )
    parts.append("</table><h2>BASELINE EPOCH</h2>")
    parts.append(
        f"<p>{esc(epoch.get('epoch_id'))} {esc(epoch.get('status'))} {esc(epoch.get('reason_started'))}</p>"
    )
    parts.append("<h2>EXPERIMENT RESULTS</h2><table><tr><th>experiment</th><th>status</th><th>reason</th></tr>")
    for experiment_id, item in sorted((status.get("experiment_results") or {}).items()):
        parts.append(
            f"<tr><td>{esc(experiment_id)}</td><td>{esc(item['status'])}</td><td>{esc(item['reason'])}</td></tr>"
        )
    parts.append("</table><h2>CAPABILITY WARNINGS</h2><ul>")
    for warning in status.get("capability_warnings") or []:
        parts.append(f"<li class='warn'>{esc(warning)}</li>")
    parts.append("</ul>")
    parts.append(f"<p>Mode $06 O2 Trend: {esc(mode06.get('state'))}</p>")
    parts.append("<form method='post' action='/api/it-just-did-it'><button type='submit'>IT JUST DID IT</button></form>")
    parts.append("</body></html>")
    return "".join(parts)
