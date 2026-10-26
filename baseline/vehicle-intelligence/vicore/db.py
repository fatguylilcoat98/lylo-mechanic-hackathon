"""SQLite evidence store. Raw observations are never updated."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from vicore import ANALYSIS_VERSION
from vicore.timeutil import iso_from_epoch, sample_window

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id TEXT PRIMARY KEY,
    vin TEXT,
    vin_status TEXT NOT NULL,
    fingerprint TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adapters (
    adapter_id TEXT PRIMARY KEY,
    identity_raw TEXT NOT NULL,
    firmware TEXT,
    serial_number TEXT,
    vendor_hint TEXT,
    device_path TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    adapter_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    source TEXT NOT NULL,
    source_detail TEXT,
    protocol TEXT,
    hardware_tested INTEGER NOT NULL DEFAULT 0,
    analysis_version TEXT NOT NULL,
    phone_device TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
);

CREATE TABLE IF NOT EXISTS capability_profiles (
    profile_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    analysis_version TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS signals (
    signal_id TEXT PRIMARY KEY,
    definition_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    request_timestamp TEXT NOT NULL,
    response_timestamp TEXT NOT NULL,
    request_mono_ns INTEGER NOT NULL,
    response_mono_ns INTEGER NOT NULL,
    estimated_sample_window_json TEXT NOT NULL,
    raw_value TEXT NOT NULL,
    decoded_value REAL,
    decoded_text TEXT,
    unit TEXT,
    quality TEXT NOT NULL,
    protocol TEXT,
    ecu TEXT,
    sequence_number INTEGER NOT NULL,
    UNIQUE (session_id, sequence_number),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE TABLE IF NOT EXISTS sensor_trust (
    trust_id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    epoch_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    state TEXT NOT NULL,
    anchor_result TEXT NOT NULL,
    stability_json TEXT,
    resolution_json TEXT,
    acquisition_quality_json TEXT,
    independent_witnesses_json TEXT,
    recent_reset INTEGER NOT NULL,
    conflicts_json TEXT,
    reason TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    analysis_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_epochs (
    epoch_id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    reason_started TEXT NOT NULL,
    invalidation_reason TEXT,
    calibration_id TEXT,
    supersedes_epoch_id TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
);

CREATE TABLE IF NOT EXISTS vehicle_states (
    state_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    epoch_id TEXT,
    state TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    confidence REAL NOT NULL,
    signals_used_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    analysis_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transitions (
    transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    epoch_id TEXT,
    state_from TEXT NOT NULL,
    state_to TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    confidence REAL NOT NULL,
    signals_used_json TEXT NOT NULL,
    analysis_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    trigger_detail TEXT NOT NULL,
    triggered_at TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_end TEXT,
    frozen INTEGER NOT NULL,
    sequence_start INTEGER,
    sequence_end INTEGER,
    order_status TEXT NOT NULL,
    overwritten INTEGER NOT NULL DEFAULT 0,
    post_window_complete INTEGER NOT NULL,
    analysis_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_results (
    result_id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    epoch_id TEXT,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    result_json TEXT NOT NULL,
    analysis_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repairs (
    repair_id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    epoch_id TEXT,
    recorded_at TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    invalidates_epoch INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dead_ideas (
    idea_id TEXT PRIMARY KEY,
    vehicle_id TEXT,
    recorded_at TEXT NOT NULL,
    statement TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    reason_retired TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_versions (
    version TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    components_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obs_session_time
    ON observations (session_id, response_timestamp);
CREATE INDEX IF NOT EXISTS idx_obs_session_signal
    ON observations (session_id, signal_id);
"""

EXPERIMENTS = (
    (
        "experiment_a_koeo_map",
        "KOEO MAP / barometer anchor",
        {
            "goal": "measure repeatability of MAP versus independent ambient pressure",
            "diagnoses": False,
            "minimum_rate_hz": 1.0,
        },
    ),
    (
        "experiment_b_fuel_trim",
        "Fuel trim operating map",
        {
            "goal": "measure repeatability of this vehicle's trim surface",
            "diagnoses": False,
            "minimum_rate_hz": 2.0,
        },
    ),
    (
        "experiment_c_hot_idle_throttle",
        "Hot-idle throttle requirement",
        {
            "goal": "measure repeatability of required throttle at matched hot idle",
            "diagnoses": False,
            "minimum_rate_hz": 2.0,
        },
    ),
)


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._seed()
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def _seed(self) -> None:
        from vicore.registry import load_registry

        now = _now_iso()
        self.conn.execute(
            """
            INSERT INTO analysis_versions (version, created_at, components_json)
            VALUES (?, ?, ?)
            ON CONFLICT(version) DO NOTHING
            """,
            (
                ANALYSIS_VERSION,
                now,
                json.dumps(
                    {
                        "handshake": ANALYSIS_VERSION,
                        "benchmark": ANALYSIS_VERSION,
                        "trust": ANALYSIS_VERSION,
                        "state": ANALYSIS_VERSION,
                        "events": ANALYSIS_VERSION,
                        "experiments": ANALYSIS_VERSION,
                    }
                ),
            ),
        )
        for signal_id, definition in load_registry().items():
            self.conn.execute(
                """
                INSERT INTO signals (signal_id, definition_json) VALUES (?, ?)
                ON CONFLICT(signal_id) DO UPDATE SET definition_json = excluded.definition_json
                """,
                (signal_id, json.dumps(definition)),
            )
        for experiment_id, name, definition in EXPERIMENTS:
            self.conn.execute(
                """
                INSERT INTO experiments (experiment_id, name, definition_json) VALUES (?, ?, ?)
                ON CONFLICT(experiment_id) DO UPDATE SET
                    name = excluded.name,
                    definition_json = excluded.definition_json
                """,
                (experiment_id, name, json.dumps(definition)),
            )

    def execute(self, sql: str, params: tuple = ()):
        return self.conn.execute(sql, params)

    def commit(self) -> None:
        self.conn.commit()


def _now_iso() -> str:
    import time

    return iso_from_epoch(time.time())


def mono_ns(seconds: float) -> int:
    return int(round(seconds * 1_000_000_000))


def insert_observation(db: Database, obs) -> None:
    db.execute(
        """
        INSERT INTO observations (
            vehicle_id, session_id, signal_id, request_timestamp, response_timestamp,
            request_mono_ns, response_mono_ns, estimated_sample_window_json,
            raw_value, decoded_value, decoded_text, unit, quality, protocol, ecu,
            sequence_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            obs.vehicle_id,
            obs.session_id,
            obs.signal_id,
            obs.request_timestamp,
            obs.response_timestamp,
            mono_ns(obs.request_mono),
            mono_ns(obs.response_mono),
            json.dumps(sample_window(obs.request_timestamp, obs.response_timestamp)),
            obs.raw_value,
            obs.decoded_value,
            obs.decoded_text,
            obs.unit,
            obs.quality,
            obs.protocol,
            obs.ecu,
            obs.sequence_number,
        ),
    )


def load_observations(db: Database, session_id: str) -> list:
    from vicore.models import Observation

    rows = db.execute(
        """
        SELECT * FROM observations
        WHERE session_id = ?
        ORDER BY sequence_number ASC
        """,
        (session_id,),
    ).fetchall()
    found = []
    for row in rows:
        found.append(
            Observation(
                vehicle_id=row["vehicle_id"],
                session_id=row["session_id"],
                signal_id=row["signal_id"],
                request_timestamp=row["request_timestamp"],
                response_timestamp=row["response_timestamp"],
                request_mono=row["request_mono_ns"] / 1_000_000_000,
                response_mono=row["response_mono_ns"] / 1_000_000_000,
                raw_value=row["raw_value"],
                decoded_value=row["decoded_value"],
                unit=row["unit"],
                quality=row["quality"],
                protocol=row["protocol"] or "",
                ecu=row["ecu"],
                sequence_number=row["sequence_number"],
                decoded_text=row["decoded_text"],
            )
        )
    return found
