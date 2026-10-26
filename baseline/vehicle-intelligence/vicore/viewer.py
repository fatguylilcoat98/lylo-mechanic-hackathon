"""Local evidence viewer. Ugly on purpose."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from vicore.db import Database
from vicore.status import build_status, render_html


class Viewer:
    def __init__(self, db_path: str, port: int = 8765, trigger_queue=None):
        self.db_path = db_path
        self.port = port
        self.trigger_queue = trigger_queue
        self.httpd = None

    def serve_forever(self) -> None:
        handler = self._handler()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.httpd.serve_forever()

    def start_thread(self):
        import threading

        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), self._handler())
        thread = threading.Thread(target=self.httpd.serve_forever, name="vicore-viewer", daemon=True)
        thread.start()
        return self.httpd

    def _handler(self):
        db_path = self.db_path
        trigger_queue = self.trigger_queue

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                db = Database(db_path)
                try:
                    status = build_status(db)
                    if self.path.startswith("/api/status"):
                        body = json.dumps(status).encode("utf-8")
                        self._send(200, "application/json", body)
                    else:
                        self._send(200, "text/html; charset=utf-8", render_html(status).encode("utf-8"))
                finally:
                    db.close()

            def do_POST(self):  # noqa: N802
                if self.path.split("?", 1)[0] != "/api/it-just-did-it":
                    self._send(404, "text/plain", b"not found")
                    return
                if trigger_queue is None:
                    self._send(409, "text/plain", b"no live session")
                    return
                trigger_queue.put("IT_JUST_DID_IT")
                self._send(202, "text/plain", b"queued")

            def log_message(self, fmt, *args):
                return

            def _send(self, code: int, content_type: str, body: bytes) -> None:
                self.send_response(code)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        return Handler
