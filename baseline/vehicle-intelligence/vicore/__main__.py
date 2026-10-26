"""Operator commands for the vehicle intelligence core."""

from __future__ import annotations

import argparse
import sys

from vicore.db import Database
from vicore.fixtures import BUILDERS, load_fixture, write_fixtures
from vicore.hardware import hardware_instructions, hardware_status
from vicore.pipeline import replay_session
from vicore.status import build_status, render_text
from vicore.timeutil import iso_from_epoch


def main(argv: list[str] | None = None) -> int:
    db_args = argparse.ArgumentParser(add_help=False)
    db_args.add_argument("--db", default="/home/chris/vehicle-intelligence/data/vicore.sqlite")
    parser = argparse.ArgumentParser(prog="vicore")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("hardware-check", parents=[db_args])
    live = sub.add_parser("live", parents=[db_args])
    live.add_argument("--device", required=True)
    live.add_argument("--serve-port", type=int, default=8765)
    live.add_argument("--max-seconds", type=float, default=None)

    load = sub.add_parser("load-fixture", parents=[db_args])
    load.add_argument("name")
    sub.add_parser("load-all-fixtures", parents=[db_args])
    sub.add_parser("write-fixtures", parents=[db_args])

    replay = sub.add_parser("replay", parents=[db_args])
    replay.add_argument("--session", required=True)

    sub.add_parser("status", parents=[db_args])
    serve = sub.add_parser("serve", parents=[db_args])
    serve.add_argument("--port", type=int, default=8765)

    invalidate = sub.add_parser("invalidate-epoch", parents=[db_args])
    invalidate.add_argument("--vehicle", required=True)
    invalidate.add_argument("--reason", required=True)

    args = parser.parse_args(argv)
    if args.command == "hardware-check":
        status = hardware_status()
        print(status)
        if not status["adapter_connected"]:
            print(hardware_instructions(args.db))
            return 2
        print(f"A serial node exists. Next: python3 -m vicore live --device {status['device_nodes'][0]} --db {args.db} --serve-port 8765")
        return 0
    if args.command == "write-fixtures":
        paths = write_fixtures()
        for path in paths:
            print(path)
        return 0
    if args.command == "load-fixture":
        db = Database(args.db)
        summary = load_fixture(db, args.name)
        db.close()
        print(summary["fixture"], summary["session_id"], summary.get("state"), summary.get("state_blocked"))
        return 0
    if args.command == "load-all-fixtures":
        db = Database(args.db)
        for name in BUILDERS:
            summary = load_fixture(db, name)
            print(name, summary["session_id"], summary.get("state"), summary.get("state_blocked"))
        db.close()
        return 0
    if args.command == "replay":
        db = Database(args.db)
        summary = replay_session(db, args.session)
        db.close()
        print(summary)
        return 0
    if args.command == "status":
        db = Database(args.db)
        print(render_text(build_status(db)))
        db.close()
        return 0
    if args.command == "serve":
        from vicore.viewer import Viewer

        viewer = Viewer(args.db, args.port)
        print(f"http://127.0.0.1:{args.port}")
        viewer.serve_forever()
        return 0
    if args.command == "invalidate-epoch":
        import time

        from vicore.baseline import BaselineTracker

        db = Database(args.db)
        tracker = BaselineTracker(db, args.vehicle)
        if tracker.attach_open_epoch() is None:
            print("no open epoch")
            db.close()
            return 2
        opened = tracker.invalidate(iso_from_epoch(time.time()), args.reason)
        db.commit()
        db.close()
        print(opened["epoch_id"], opened["reason_started"])
        return 0
    if args.command == "live":
        from vicore.live import run_live
        from vicore.transport import TransportError

        try:
            summary = run_live(
                args.device,
                args.db,
                serve_port=args.serve_port,
                max_seconds=args.max_seconds,
            )
        except TransportError as exc:
            print(str(exc))
            print(hardware_instructions(args.db))
            return 2
        print(summary)
        return 0
    print("unknown command", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
