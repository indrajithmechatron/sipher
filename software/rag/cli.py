"""Command line for the Sipher retrieval layer.

Run from ``software/`` (or with ``PYTHONPATH=software``):

    python -m rag.cli index
    python -m rag.cli search "pico serial watchdog"
    python -m rag.cli context "where is the deploy log" --max-chars 4000
    python -m rag.cli stats
    python -m rag.cli ingest docs/hardware/manual.pdf
    python -m rag.cli serve --port 8899
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .service import KnowledgeBase
from .server import serve


def _kb(args: argparse.Namespace) -> KnowledgeBase:
    return KnowledgeBase(root=args.root, store=args.store)


def _print(payload: object) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", help="repository root (default: auto-detected)")
    parser.add_argument("--store", help="index directory (default: <repo>/.rag)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m rag.cli",
        description="Sipher BM25 retrieval over docs, code, reports, logs and manuals.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_index = sub.add_parser("index", help="(re)build the index")
    _add_common(p_index)

    p_search = sub.add_parser("search", help="search the index")
    p_search.add_argument("query")
    p_search.add_argument("-k", "--top", type=int, default=5)
    p_search.add_argument("--json", action="store_true", help="raw JSON output")
    _add_common(p_search)

    p_context = sub.add_parser("context", help="retrieved passages as an LLM prompt block")
    p_context.add_argument("query")
    p_context.add_argument("-k", "--top", type=int, default=5)
    p_context.add_argument("--max-chars", type=int, default=6000)
    _add_common(p_context)

    p_stats = sub.add_parser("stats", help="index statistics")
    _add_common(p_stats)

    p_ingest = sub.add_parser("ingest", help="add a text/PDF manual to the index")
    p_ingest.add_argument("path")
    p_ingest.add_argument("--name", help="override the displayed document name")
    _add_common(p_ingest)

    p_serve = sub.add_parser("serve", help="run the standalone HTTP server")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8899)
    _add_common(p_serve)

    args = parser.parse_args(argv)

    if args.command == "serve":
        if args.root:
            os.environ["SIPHER_REPO_DIR"] = str(Path(args.root).expanduser().resolve())
        if args.store:
            os.environ["SIPHER_RAG_DIR"] = str(Path(args.store).expanduser().resolve())
        serve(args.host, args.port)
        return 0

    kb = _kb(args)

    if args.command == "index":
        _print(kb.build())
        return 0

    if args.command == "stats":
        kb.ensure()
        _print(kb.stats())
        return 0

    if args.command == "search":
        results = kb.search(args.query, args.top)
        if args.json:
            _print({"query": args.query, "count": len(results), "results": results})
            return 0
        if not results:
            print("no matches")
            return 1
        for item in results:
            first = item["text"].strip().splitlines()[0][:100]
            print(f"{item['score']:8.3f}  {item['ref']}")
            print(f"          {first}")
        return 0

    if args.command == "context":
        payload = kb.context(args.query, args.top, args.max_chars)
        print(payload["prompt"] or "no matches")
        return 0

    if args.command == "ingest":
        path = Path(args.path).expanduser()
        if not path.is_file():
            print(f"not a file: {path}", file=sys.stderr)
            return 2
        name = args.name or path.name
        if path.suffix.lower() == ".pdf":
            result = kb.ingest_pdf(name, path.read_bytes())
        else:
            result = kb.ingest_text(name, path.read_text(encoding="utf-8", errors="ignore"))
        _print(result)
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
