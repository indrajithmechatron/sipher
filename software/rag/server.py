"""Standalone RAG HTTP server (development / laptop use).

On the Pi the routes are mounted inside ``control.command_endpoint`` on :8888;
this server is for running the knowledge base on its own port.
"""

from __future__ import annotations

import argparse
import http.server
import json

from .http_api import MAX_BODY_BYTES, dispatch
from .service import get_knowledge_base


class RagHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SipherRAG/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib signature
        print(f"[rag] {args[0]}", flush=True)

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method: str) -> None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            self._reply(413, {"error": "body too large"})
            return
        body = self.rfile.read(length) if length > 0 else b""
        status, payload = dispatch(
            get_knowledge_base(), method, self.path, body, self.headers.get("Content-Type", "")
        )
        self._reply(status, payload)

    def do_GET(self) -> None:  # noqa: N802 - stdlib hook
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802 - stdlib hook
        self._handle("POST")

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib hook
        self._reply(204, {})


def serve(host: str = "127.0.0.1", port: int = 8899) -> None:
    httpd = http.server.ThreadingHTTPServer((host, port), RagHandler)
    print(f"[rag] listening on {host}:{port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[rag] shutting down", flush=True)
        httpd.shutdown()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m rag.server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8899)
    args = parser.parse_args(argv)
    serve(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
