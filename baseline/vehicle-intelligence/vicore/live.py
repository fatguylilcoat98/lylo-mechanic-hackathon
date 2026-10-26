"""Live MX+ session. This module does not invent a car when the port is closed."""

from __future__ import annotations

import queue
import time
import uuid

from vicore.benchmark import apply_benchmark, run_benchmark, supported_poll_signals
from vicore.clock import SystemClock
from vicore.db import Database, load_observations
from vicore.elm import ElmSession
from vicore.features import sustained_for_count
from vicore.handshake import run_handshake
from vicore.phone import probe_phone_sensors
from vicore.pipeline import (
    AnalysisEngine,
    BaselineTracker,
    end_session,
    ensure_adapter,
    ensure_session,
    ensure_vehicle,
    save_profile,
)
from vicore.recorder import Recorder
from vicore.registry import load_registry
from vicore.timeutil import iso_from_epoch
from vicore.transport import SerialTransport


def run_live(device: str, db_path: str, *, serve_port: int | None = None, max_seconds: float | None = None) -> dict:
    clock = SystemClock()
    transport = SerialTransport(device)
    transport.open()
    db = Database(db_path)
    trigger_queue: queue.Queue = queue.Queue()
    server = None
    try:
        if serve_port:
            from vicore.viewer import Viewer

            server = Viewer(db_path, serve_port, trigger_queue)
            server.start_thread()
        phone = probe_phone_sensors()
        elm = ElmSession(transport, clock, timeout=2.0)
        session_id = uuid.uuid4().hex
        profile = run_handshake(
            elm,
            vehicle_id=None,
            session_id=session_id,
            phone=phone,
            transport_meta={
                "kind": "serial",
                "path": device,
                "baud": transport.baud,
                "hardware_tested": True,
            },
        )
        ensure_vehicle(
            db,
            profile["vehicle_id"],
            (profile.get("vin") or {}).get("value"),
            (profile.get("vin") or {}).get("status") or "UNTESTED",
            profile.get("fingerprint") or "",
            profile["created_at"],
        )
        adapter_id = ensure_adapter(db, profile["adapter"], device, profile["created_at"])
        ensure_session(db, profile, source="live", source_detail=device, adapter_id=adapter_id)
        save_profile(db, profile, "handshake")
        db.commit()
        recorder = Recorder(db, session_id)
        benchmark = run_benchmark(elm, profile, recorder=recorder, duration_s=4.0)
        recorder.commit()
        profile = apply_benchmark(profile, benchmark)
        save_profile(db, profile, "benchmarked")
        tracker = BaselineTracker(db, profile["vehicle_id"])
        calibration = (profile.get("mode09") or {}).get("calibration_raw")
        epoch = tracker.ensure(profile["created_at"], calibration, "initial_connection")
        engine = AnalysisEngine(db, profile, epoch)
        for obs in load_observations(db, session_id):
            engine.ingest(obs, manage_epochs=True)
        registry = load_registry()
        pollable = supported_poll_signals(profile)
        width = _poll_width(profile, len(pollable))
        poll_ids = pollable[:width]
        started = time.monotonic()
        while True:
            if max_seconds is not None and time.monotonic() - started >= max_seconds:
                break
            _drain_triggers(trigger_queue, engine, clock)
            if not poll_ids:
                clock.sleep(0.2)
                continue
            for signal_id in poll_ids:
                signal = registry[signal_id]
                start = recorder.next_sequence()
                observations = elm.read_signal(
                    signal,
                    vehicle_id=profile["vehicle_id"],
                    session_id=session_id,
                    sequence_start=start,
                    protocol=(profile.get("protocol") or {}).get("name") or "",
                )
                for index, obs in enumerate(observations):
                    if index:
                        obs.sequence_number = recorder.next_sequence()
                for obs in observations:
                    recorder.persist(obs)
                    engine.ingest(obs, manage_epochs=True)
            recorder.commit()
        summary = engine.finish()
        end_session(db, session_id, iso_from_epoch(clock.wall()))
        db.commit()
        summary["hardware_tested"] = True
        summary["device"] = device
        summary["serve_port"] = serve_port
        return summary
    finally:
        if server and server.httpd:
            server.httpd.shutdown()
        transport.close()
        db.close()


def _poll_width(profile: dict, available: int) -> int:
    if available <= 0:
        return 0
    benchmark = profile.get("acquisition_benchmark") or {}
    for n in (8, 4, 2, 1):
        if n > available:
            continue
        rate = sustained_for_count(benchmark, n)
        if rate is not None and rate >= 2.0:
            return n
    return 1


def _drain_triggers(trigger_queue: queue.Queue, engine: AnalysisEngine, clock) -> None:
    while True:
        try:
            trigger_queue.get_nowait()
        except queue.Empty:
            return
        engine.user_trigger(clock.mono(), iso_from_epoch(clock.wall()))
