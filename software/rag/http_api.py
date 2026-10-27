"""HTTP surface for the knowledge base.

Mounted by ``control.command_endpoint`` on the Pi (so the dashboard reaches it
through the existing ``/api`` proxy) and by ``rag.server`` for local use:

  GET  /api/rag/health
  GET  /api/rag/stats
  GET  /api/rag/files
  GET  /api/rag/search?q=...&k=5
  GET  /api/rag/context?q=...&k=5&max_chars=6000
  POST /api/rag/reindex
  POST /api/rag/ingest      JSON {"name","text"} | raw PDF | raw text?name=...
"""

from __future__ import annotations

import json
import urllib.parse

from .service import KnowledgeBase

MAX_BODY_BYTES = 8_000_000


def _one(query: dict[str, list[str]], name: str, default: str | None = None) -> str | None:
    values = query.get(name)
    return values[0] if values else default


def _int(value: str | None, default: int, low: int, high: int) -> int:
    try:
        number = int(value) if value is not None else default
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def dispatch(
    kb: KnowledgeBase,
    method: str,
    target: str,
    body: bytes = b"",
    content_type: str = "",
) -> tuple[int, dict]:
    """Route one request; never raises for client errors."""
    try:
        return _route(kb, method.upper(), target, body, content_type)
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - endpoints must always answer JSON
        return 500, {"error": f"rag failure: {exc}"}


def _route(
    kb: KnowledgeBase,
    method: str,
    target: str,
    body: bytes,
    content_type: str,
) -> tuple[int, dict]:
    split = urllib.parse.urlsplit(target)
    path = split.path.rstrip("/") or "/"
    query = urllib.parse.parse_qs(split.query)

    if path == "/api/rag":
        return 200, {
            "service": "sipher-rag",
            "routes": [
                "GET /api/rag/health",
                "GET /api/rag/stats",
                "GET /api/rag/files",
                "GET /api/rag/search?q=&k=",
                "GET /api/rag/context?q=&k=&max_chars=",
                "POST /api/rag/reindex",
                "POST /api/rag/ingest",
            ],
        }

    if path in ("/api/rag/health", "/api/rag/stats", "/api/rag/files"):
        if method != "GET":
            return 405, {"error": "use GET"}
        if path == "/api/rag/health":
            return 200, {"status": "ok", "rag": kb.stats()}
        if path == "/api/rag/stats":
            return 200, kb.stats()
        return 200, {"files": sorted(kb._meta.get("files", {}))}  # noqa: SLF001

    if path == "/api/rag/search":
        if method != "GET":
            return 405, {"error": "use GET"}
        q = (_one(query, "q") or "").strip()
        if not q:
            raise ValueError("missing q parameter")
        k = _int(_one(query, "k"), 5, 1, 20)
        results = kb.search(q, k)
        return 200, {"query": q, "k": k, "count": len(results), "results": results}

    if path == "/api/rag/context":
        if method != "GET":
            return 405, {"error": "use GET"}
        q = (_one(query, "q") or "").strip()
        if not q:
            raise ValueError("missing q parameter")
        k = _int(_one(query, "k"), 5, 1, 20)
        max_chars = _int(_one(query, "max_chars"), 6000, 400, 20000)
        payload = kb.context(q, k, max_chars)
        return 200, {
            "query": q,
            "count": len(payload["results"]),
            "prompt": payload["prompt"],
            "results": payload["results"],
        }

    if path == "/api/rag/reindex":
        if method != "POST":
            return 405, {"error": "use POST"}
        return 200, {"ok": True, "index": kb.build()}

    if path == "/api/rag/ingest":
        if method != "POST":
            return 405, {"error": "use POST"}
        if not body:
            raise ValueError("empty body")
        if len(body) > MAX_BODY_BYTES:
            raise ValueError("body too large")

        mime = (content_type or "").split(";", 1)[0].strip().lower()
        name = (_one(query, "name") or "document").strip() or "document"

        if mime == "application/json":
            try:
                payload = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid json: {exc}") from exc
            if not isinstance(payload, dict):
                raise ValueError("json body must be an object")
            name = str(payload.get("name") or name)
            text = payload.get("text")
            if not isinstance(text, str):
                raise ValueError("missing text field")
            return 200, kb.ingest_text(name, text)

        if mime == "application/pdf" or body[:5] == b"%PDF-":
            return 200, kb.ingest_pdf(name, body)

        return 200, kb.ingest_text(name, body.decode("utf-8", errors="replace"))

    return 404, {"error": "not found"}
