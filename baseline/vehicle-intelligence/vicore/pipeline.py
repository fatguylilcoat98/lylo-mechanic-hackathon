"""Session pipeline shared by live capture, fixtures, and replay."""

from __future__ import annotations

import json
import uuid

from vicore import ANALYSIS_VERSION
from vicore.baseline import BaselineTracker
from vicore.benchmark import apply_benchmark, benchmark_from_observations
from vicore.db import Database, insert_observation, load_observations
from vicore.events import EventBuffer
from vicore.experiments import ExperimentEngine
from vicore.features import FEATURE_SPECS, query_feature
from vicore.models import FeatureCapability
from vicore.registry import load_registry
from vicore.state import StateConfig, StateDetector
from vicore.trust import TrustLedger


DERIVED_TABLES = (
    "sensor_trust",
    "vehicle_states",
    "transitions",
    "events",
    "experiment_results",
)


class AnalysisEngine:
    def __init__(self, db: Database, profile: dict, epoch: dict, state_config: StateConfig | None = None):
        self.db = db
        self.profile = profile
        self.registry = load_registry()
        self.vehicle_id = profile["vehicle_id"]
        self.session_id = profile["session_id"]
        self.epoch = epoch
        self.gates = {feature_id: query_feature(profile, feature_id) for feature_id in FEATURE_SPECS}
        self.state = StateDetector(state_config)
        self.trust = TrustLedger(self.registry)
        self.trust.epoch_id = epoch["epoch_id"]
        self.trust.epoch_reason = epoch.get("reason_started") or "initial_connection"
        self.trust.epoch_started_mono = None
        supported = [
            signal_id
            for signal_id, entry in (profile.get("signals") or {}).items()
            if entry.get("state") == "FULL"
        ]
        self.trust.seed(supported)
        self.events = EventBuffer()
        self.experiments = ExperimentEngine(self.registry, self.gates)
        self.baseline = BaselineTracker(db, self.vehicle_id)
        self.baseline.attach_open_epoch()
        self._last_obs = None
        self._seeded_trust = False

    def ingest(self, obs, *, manage_epochs: bool = True) -> None:
        self._last_obs = obs
        if self.trust.epoch_started_mono is None:
            self.trust.epoch_started_mono = obs.response_mono
            self._persist_trust_seed(obs.response_timestamp)
        if manage_epochs and self.baseline.epoch_id:
            rotated = self.baseline.observe(obs)
            if rotated:
                self.epoch = rotated
                self.trust.on_epoch(rotated, obs.response_mono)
                self._persist_all_trust(obs.response_timestamp)
        if self.gates["state_detector"].allows_run():
            self.state.update(obs)
        if obs.signal_id in self.registry:
            changed = self.trust.update(obs, self.state.committed)
            if changed is not None:
                self._persist_trust(changed, obs.response_timestamp)
        if self.gates["event_buffer"].allows_run():
            self.events.push(obs, self.state.committed, _trust_map(self.trust))
        self.experiments.observe(obs, self.state.committed, self.trust)

    def finish(self, *, manage_epochs: bool = True) -> dict:
        self.state.close()
        end_iso = self._last_obs.response_timestamp if self._last_obs else None
        end_mono = self._last_obs.response_mono if self._last_obs else None
        self.events.finish(end_iso, end_mono)
        self._persist_states()
        self._persist_events()
        results = self.experiments.finish(self.trust)
        for result in results:
            self._persist_result(result, end_iso or self.epoch["started_at"])
        self.db.commit()
        return {
            "session_id": self.session_id,
            "vehicle_id": self.vehicle_id,
            "epoch_id": self.epoch["epoch_id"],
            "state": self.state.committed,
            "state_blocked": None if self.gates["state_detector"].allows_run() else self.gates["state_detector"].reason,
            "experiment_results": results,
            "events": len(self.events.frozen),
        }

    def user_trigger(self, mono: float, iso: str) -> None:
        self.events.user_trigger(mono, iso)

    def _persist_trust_seed(self, now_iso: str) -> None:
        if self._seeded_trust:
            return
        self._seeded_trust = True
        for record in self.trust.records.values():
            self._persist_trust(record, now_iso)

    def _persist_all_trust(self, now_iso: str) -> None:
        for record in self.trust.records.values():
            self._persist_trust(record, now_iso)

    def _persist_trust(self, record, now_iso: str) -> None:
        payload = record.as_dict() if hasattr(record, "as_dict") else record
        self.db.execute(
            """
            INSERT INTO sensor_trust (
                vehicle_id, session_id, epoch_id, signal_id, state, anchor_result,
                stability_json, resolution_json, acquisition_quality_json,
                independent_witnesses_json, recent_reset, conflicts_json, reason,
                updated_at, analysis_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.vehicle_id,
                self.session_id,
                self.trust.epoch_id or self.epoch["epoch_id"],
                payload["signal_id"],
                payload["state"],
                payload["anchor_result"],
                json.dumps(payload["stability"]),
                json.dumps(payload["resolution"]),
                json.dumps(payload["acquisition_quality"]),
                json.dumps(payload["independent_witnesses"]),
                1 if payload["recent_reset"] else 0,
                json.dumps(payload["conflicts"]),
                payload["reason"],
                now_iso,
                ANALYSIS_VERSION,
            ),
        )

    def _persist_states(self) -> None:
        periods = list(self.state.periods)
        if self.state.current:
            periods.append(self.state.current)
        for period in periods:
            self.db.execute(
                """
                INSERT INTO vehicle_states (
                    vehicle_id, session_id, epoch_id, state, start_time, end_time,
                    confidence, signals_used_json, reason, analysis_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.vehicle_id,
                    self.session_id,
                    self.epoch["epoch_id"],
                    period["state"],
                    period["start_iso"],
                    period.get("end_iso"),
                    period["confidence"],
                    json.dumps(period["signals"]),
                    period["reason"],
                    ANALYSIS_VERSION,
                ),
            )
        for transition in self.state.transitions:
            self.db.execute(
                """
                INSERT INTO transitions (
                    vehicle_id, session_id, epoch_id, state_from, state_to,
                    start_time, end_time, confidence, signals_used_json, analysis_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.vehicle_id,
                    self.session_id,
                    self.epoch["epoch_id"],
                    transition["state_from"],
                    transition["state_to"],
                    transition["start_iso"],
                    transition["end_iso"],
                    transition["confidence"],
                    json.dumps(transition["signals"]),
                    ANALYSIS_VERSION,
                ),
            )

    def _persist_events(self) -> None:
        for event in self.events.frozen:
            sources = [item["source"] for item in event["triggers"]]
            self.db.execute(
                """
                INSERT INTO events (
                    event_id, vehicle_id, session_id, trigger_source, trigger_detail,
                    triggered_at, window_start, window_end, frozen, sequence_start,
                    sequence_end, order_status, overwritten, post_window_complete,
                    analysis_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?)
                """,
                (
                    event["event_id"],
                    self.vehicle_id,
                    self.session_id,
                    sources[0],
                    json.dumps(event["triggers"]),
                    event["trigger_iso"],
                    _iso_from_event_start(event),
                    event.get("window_end_iso"),
                    event.get("sequence_start"),
                    event.get("sequence_end"),
                    event["order_status"],
                    1 if event.get("post_window_complete") else 0,
                    ANALYSIS_VERSION,
                ),
            )

    def _persist_result(self, result: dict, now_iso: str) -> None:
        self.db.execute(
            """
            INSERT INTO experiment_results (
                experiment_id, vehicle_id, session_id, epoch_id, status, reason,
                result_json, analysis_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["experiment_id"],
                self.vehicle_id,
                self.session_id,
                self.epoch["epoch_id"],
                result["status"],
                result["reason"],
                json.dumps(result["result"]),
                ANALYSIS_VERSION,
                now_iso,
            ),
        )


def _trust_map(trust: TrustLedger) -> dict:
    return {signal_id: record.state for signal_id, record in trust.records.items()}


def _iso_from_event_start(event: dict) -> str:
    samples = event.get("samples") or ()
    if samples:
        return samples[0].response_timestamp
    return event["trigger_iso"]


def save_profile(db: Database, profile: dict, kind: str) -> str:
    profile_id = uuid.uuid4().hex
    db.execute(
        """
        INSERT INTO capability_profiles (
            profile_id, session_id, vehicle_id, created_at, kind, analysis_version, profile_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            profile_id,
            profile["session_id"],
            profile["vehicle_id"],
            profile["created_at"],
            kind,
            ANALYSIS_VERSION,
            json.dumps(profile),
        ),
    )
    return profile_id


def ensure_vehicle(db: Database, vehicle_id: str, vin: str | None, vin_status: str, fingerprint: str, now_iso: str) -> None:
    db.execute(
        """
        INSERT INTO vehicles (vehicle_id, vin, vin_status, fingerprint, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(vehicle_id) DO UPDATE SET
            last_seen = excluded.last_seen,
            vin = COALESCE(vehicles.vin, excluded.vin),
            vin_status = excluded.vin_status
        """,
        (vehicle_id, vin, vin_status, fingerprint, now_iso, now_iso),
    )


def ensure_adapter(db: Database, adapter: dict, device_path: str, now_iso: str) -> str:
    adapter_id = adapter.get("adapter_id") or uuid.uuid4().hex
    adapter["adapter_id"] = adapter_id
    db.execute(
        """
        INSERT INTO adapters (
            adapter_id, identity_raw, firmware, serial_number, vendor_hint, device_path, first_seen, last_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(adapter_id) DO UPDATE SET last_seen = excluded.last_seen
        """,
        (
            adapter_id,
            adapter.get("identity_raw") or "UNKNOWN_ADAPTER",
            adapter.get("firmware"),
            adapter.get("serial_number"),
            adapter.get("vendor_hint"),
            device_path,
            now_iso,
            now_iso,
        ),
    )
    return adapter_id


def ensure_session(db: Database, profile: dict, *, source: str, source_detail: str, adapter_id: str | None) -> None:
    db.execute(
        """
        INSERT INTO sessions (
            session_id, vehicle_id, adapter_id, started_at, ended_at, source, source_detail,
            protocol, hardware_tested, analysis_version, phone_device
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO NOTHING
        """,
        (
            profile["session_id"],
            profile["vehicle_id"],
            adapter_id,
            profile["created_at"],
            source,
            source_detail,
            (profile.get("protocol") or {}).get("name"),
            1 if profile.get("hardware_tested") else 0,
            ANALYSIS_VERSION,
            (profile.get("phone_sensors") or {}).get("device"),
        ),
    )


def end_session(db: Database, session_id: str, ended_at: str) -> None:
    db.execute("UPDATE sessions SET ended_at = ? WHERE session_id = ?", (ended_at, session_id))


def latest_profile(db: Database, session_id: str, kinds: tuple[str, ...]) -> dict | None:
    placeholders = ",".join("?" for _ in kinds)
    row = db.execute(
        f"""
        SELECT profile_json FROM capability_profiles
        WHERE session_id = ? AND kind IN ({placeholders})
        ORDER BY created_at DESC LIMIT 1
        """,
        (session_id, *kinds),
    ).fetchone()
    if row is None:
        return None
    return json.loads(row["profile_json"])


def clear_derived(db: Database, session_id: str) -> None:
    for table in DERIVED_TABLES:
        db.execute(f"DELETE FROM {table} WHERE session_id = ?", (session_id,))
    db.execute(
        "DELETE FROM capability_profiles WHERE session_id = ? AND kind = 'replay_gate'",
        (session_id,),
    )


def analyze_observations(db: Database, profile: dict, observations: list, *, manage_epochs: bool, state_config=None) -> dict:
    tracker = BaselineTracker(db, profile["vehicle_id"])
    calibration = (profile.get("mode09") or {}).get("calibration_raw")
    epoch = tracker.ensure(profile["created_at"], calibration, "initial_connection")
    engine = AnalysisEngine(db, profile, epoch, state_config=state_config)
    for obs in observations:
        engine.ingest(obs, manage_epochs=manage_epochs)
    return engine.finish(manage_epochs=manage_epochs)


def replay_session(db: Database, session_id: str, state_config: StateConfig | None = None) -> dict:
    original = latest_profile(db, session_id, ("handshake", "fixture_capability"))
    if original is None:
        raise RuntimeError(f"session {session_id} has no capability profile")
    observations = load_observations(db, session_id)
    before = [(obs.sequence_number, obs.raw_value, obs.decoded_value) for obs in observations]
    benchmark = benchmark_from_observations(observations, original)
    gated = apply_benchmark(original, benchmark)
    gated["hardware_tested"] = False
    clear_derived(db, session_id)
    save_profile(db, gated, "replay_gate")
    summary = analyze_observations(
        db, gated, observations, manage_epochs=False, state_config=state_config
    )
    after = load_observations(db, session_id)
    after_key = [(obs.sequence_number, obs.raw_value, obs.decoded_value) for obs in after]
    if before != after_key:
        raise RuntimeError("replay changed raw observations")
    summary["observations"] = len(after)
    db.commit()
    return summary


def persist_new_observations(db: Database, observations: list) -> None:
    for obs in observations:
        insert_observation(db, obs)
