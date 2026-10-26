"""Append-only raw observations. Updates to raw rows are not provided."""

from __future__ import annotations

from vicore.db import Database, insert_observation


class Recorder:
    def __init__(self, db: Database, session_id: str):
        self.db = db
        self.session_id = session_id
        row = db.execute(
            "SELECT COALESCE(MAX(sequence_number), 0) AS n FROM observations WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        self._next = int(row["n"]) + 1

    def next_sequence(self) -> int:
        value = self._next
        self._next += 1
        return value

    def persist(self, obs) -> None:
        if obs.session_id != self.session_id:
            raise RuntimeError("recorder session mismatch")
        if obs.quality in ("TIMEOUT", "TRANSPORT_LOST") and obs.raw_value is None:
            obs.raw_value = ""
        insert_observation(self.db, obs)

    def commit(self) -> None:
        self.db.commit()
