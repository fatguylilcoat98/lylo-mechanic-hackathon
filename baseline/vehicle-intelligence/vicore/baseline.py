"""Baseline epochs. Incompatible epochs are never compared silently."""

from __future__ import annotations

import uuid

from vicore.db import Database
from vicore.models import EPOCH_REASONS, IncompatibleEpochError

VOLTAGE_SIGNALS = ("adapter_voltage", "control_module_voltage")
INVALIDATING_REPAIR = {
    "code_clear",
    "battery_disconnect",
    "ecu_reset",
    "software_update",
    "throttle_relearn",
    "sensor_replacement",
    "major_repair",
    "major_modification",
    "unknown_discontinuity",
}


def assert_same_epoch(epoch_a: str, epoch_b: str) -> None:
    if epoch_a != epoch_b:
        raise IncompatibleEpochError(
            f"refusing to compare epoch {epoch_a} with epoch {epoch_b}"
        )


class BaselineTracker:
    def __init__(self, db: Database, vehicle_id: str):
        self.db = db
        self.vehicle_id = vehicle_id
        self.epoch_id: str | None = None
        self.reason: str | None = None
        self.started_at: str | None = None
        self.last_runtime: float | None = None
        self.low_voltage_run = 0
        self.collapse_marked = False
        self.calibration_raw: str | None = None

    def attach_open_epoch(self) -> dict | None:
        row = self.db.execute(
            """
            SELECT * FROM baseline_epochs
            WHERE vehicle_id = ? AND status = 'OPEN'
            ORDER BY started_at DESC LIMIT 1
            """,
            (self.vehicle_id,),
        ).fetchone()
        if row is None:
            return None
        self.epoch_id = row["epoch_id"]
        self.reason = row["reason_started"]
        self.started_at = row["started_at"]
        self.calibration_raw = row["calibration_id"]
        return dict(row)

    def ensure(self, now_iso: str, calibration_raw: str | None, reason: str = "initial_connection") -> dict:
        if reason not in EPOCH_REASONS:
            raise ValueError(f"unknown epoch reason {reason}")
        current = self.attach_open_epoch()
        if current is None:
            return self._open(now_iso, reason, calibration_raw, supersedes=None)
        if (
            calibration_raw
            and current.get("calibration_id")
            and calibration_raw != current["calibration_id"]
        ):
            return self.rotate(now_iso, "software_update", calibration_raw)
        self.calibration_raw = current.get("calibration_id") or calibration_raw
        return current

    def observe(self, obs) -> dict | None:
        """Return the new epoch when this sample invalidates the current one."""
        if obs.quality != "OK" or obs.decoded_value is None:
            return None
        if obs.signal_id == "runtime_since_start":
            previous = self.last_runtime
            self.last_runtime = obs.decoded_value
            if previous is not None and obs.decoded_value + 5 < previous:
                return self.rotate(obs.response_timestamp, "ecu_reset", self.calibration_raw)
            return None
        if obs.signal_id in VOLTAGE_SIGNALS:
            if obs.decoded_value < 6:
                self.low_voltage_run += 1
                if self.low_voltage_run >= 2 and not self.collapse_marked:
                    self.collapse_marked = True
                    return self.rotate(obs.response_timestamp, "battery_disconnect", self.calibration_raw)
            else:
                self.low_voltage_run = 0
                self.collapse_marked = False
        return None

    def invalidate(self, now_iso: str, reason: str) -> dict:
        if reason not in INVALIDATING_REPAIR and reason not in EPOCH_REASONS:
            raise ValueError(reason)
        return self.rotate(now_iso, reason, self.calibration_raw)

    def rotate(self, now_iso: str, reason: str, calibration_raw: str | None) -> dict:
        if reason not in EPOCH_REASONS:
            raise ValueError(reason)
        supersedes = self.epoch_id
        if supersedes:
            self.db.execute(
                """
                UPDATE baseline_epochs
                SET status = 'CLOSED', ended_at = ?, invalidation_reason = ?
                WHERE epoch_id = ?
                """,
                (now_iso, reason, supersedes),
            )
        self.last_runtime = None
        self.low_voltage_run = 0
        opened = self._open(now_iso, reason, calibration_raw, supersedes)
        return opened

    def _open(self, now_iso: str, reason: str, calibration_raw: str | None, supersedes: str | None) -> dict:
        epoch_id = uuid.uuid4().hex
        self.db.execute(
            """
            INSERT INTO baseline_epochs (
                epoch_id, vehicle_id, started_at, ended_at, status, reason_started,
                invalidation_reason, calibration_id, supersedes_epoch_id
            ) VALUES (?, ?, ?, NULL, 'OPEN', ?, NULL, ?, ?)
            """,
            (epoch_id, self.vehicle_id, now_iso, reason, calibration_raw, supersedes),
        )
        self.epoch_id = epoch_id
        self.reason = reason
        self.started_at = now_iso
        self.calibration_raw = calibration_raw
        return {
            "epoch_id": epoch_id,
            "vehicle_id": self.vehicle_id,
            "started_at": now_iso,
            "status": "OPEN",
            "reason_started": reason,
            "calibration_id": calibration_raw,
            "supersedes_epoch_id": supersedes,
        }


def record_repair(db: Database, *, vehicle_id: str, epoch_id: str | None, recorded_at: str, category: str, description: str) -> dict:
    repair_id = uuid.uuid4().hex
    invalidates = 1 if category in INVALIDATING_REPAIR else 0
    db.execute(
        """
        INSERT INTO repairs (
            repair_id, vehicle_id, epoch_id, recorded_at, category, description, invalidates_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (repair_id, vehicle_id, epoch_id, recorded_at, category, description, invalidates),
    )
    rotated = None
    if invalidates and epoch_id:
        tracker = BaselineTracker(db, vehicle_id)
        tracker.attach_open_epoch()
        rotated = tracker.invalidate(recorded_at, category)
    return {"repair_id": repair_id, "invalidates_epoch": bool(invalidates), "epoch": rotated}
