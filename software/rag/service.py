"""Knowledge base facade: corpus -> chunks -> BM25 index, persisted as JSON.

Environment:
  SIPHER_REPO_DIR   repository root to index (default: two levels above this file)
  SIPHER_RAG_DIR    index + ingested docs (default: <repo>/.rag)
  SIPHER_LOG_FILE   telemetry log to include (default: /home/sipher/sipher.log)
  SIPHER_RAG_AUTOBUILD=1  build at import time instead of first request
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

from .chunk import chunk_text
from .corpus import extract_pdf_text, iter_files, read_source
from .index import Bm25Index

INDEX_VERSION = 1
MAX_INGEST_CHARS = 2_000_000

DEFAULT_ROOTS = [
    "README.md",
    "docs",
    "software",
    "dashboard/README.md",
    "dashboard/APPLICATION.md",
    "dashboard/src",
    "deploy",
]


def repo_root() -> Path:
    configured = os.environ.get("SIPHER_REPO_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def store_dir() -> Path:
    configured = os.environ.get("SIPHER_RAG_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return repo_root() / ".rag"


def telemetry_log() -> Path | None:
    candidates = [os.environ.get("SIPHER_LOG_FILE"), "/home/sipher/sipher.log"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    local = repo_root() / "sipher.log"
    return local if local.is_file() else None


class KnowledgeBase:
    def __init__(self, root: Path | str | None = None, store: Path | str | None = None) -> None:
        self.root = Path(root).resolve() if root else repo_root()
        self.store_dir = Path(store).resolve() if store else store_dir()
        self.ingest_dir = self.store_dir / "docs"
        self.index_file = self.store_dir / "index.json"
        self._lock = threading.RLock()
        self._engine: Bm25Index | None = None
        self._meta: dict = {}
        self._loaded = False

    # -- corpus ------------------------------------------------------------
    def _label(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.root).as_posix()
        except ValueError:
            return f"external/{path.name}"

    def sources(self) -> list[tuple[str, Path]]:
        """Return (display label, file) pairs, de-duplicated by real path."""
        found: list[tuple[str, Path]] = []
        seen: set[str] = set()

        def add(label: str, path: Path) -> None:
            key = os.path.normcase(str(path.resolve()))
            if key not in seen:
                seen.add(key)
                found.append((label, path))

        for rel in DEFAULT_ROOTS:
            target = self.root / rel
            if not target.exists():
                continue
            for file in iter_files([target]):
                add(self._label(file), file)

        log = telemetry_log()
        if log:
            add(f"log/{log.name}", log)

        if self.ingest_dir.is_dir():
            for file in sorted(self.ingest_dir.iterdir()):
                if file.is_file() and file.suffix.lower() in {".txt", ".md"}:
                    add(f"manual/{file.stem}", file)

        return found

    # -- build / load ------------------------------------------------------
    def build(self) -> dict:
        """Rebuild the index from disk. Safe to call repeatedly."""
        with self._lock:
            chunks = []
            files: dict[str, dict] = {}

            for label, path in self.sources():
                text = read_source(path)
                if not text.strip():
                    continue
                made = chunk_text(label, text)
                if not made:
                    continue
                chunks.extend(made)
                files[label] = {"chunks": len(made), "chars": len(text)}

            self._engine = Bm25Index.build(chunks)
            self._meta = {
                "version": INDEX_VERSION,
                "built_at": time.time(),
                "built_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "root": str(self.root),
                "files": files,
            }
            self._loaded = True
            self._save()
            return self.stats()

    def load(self) -> bool:
        try:
            data = json.loads(self.index_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        if data.get("version") != INDEX_VERSION:
            return False
        try:
            self._engine = Bm25Index.from_dict(data["index"])
        except (KeyError, TypeError, ValueError):
            return False
        self._meta = data.get("meta", {})
        self._loaded = True
        return True

    def ensure(self) -> None:
        with self._lock:
            if self._loaded:
                return
            if not self.load():
                self.build()

    def _save(self) -> None:
        if self._engine is None:
            return
        self.store_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": INDEX_VERSION,
            "meta": self._meta,
            "index": self._engine.to_dict(),
        }
        tmp = self.index_file.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        tmp.replace(self.index_file)

    # -- queries -----------------------------------------------------------
    def search(self, query: str, k: int = 5) -> list[dict]:
        query = (query or "").strip()
        if not query:
            return []
        self.ensure()
        assert self._engine is not None
        return [
            {
                "ref": hit.chunk.ref,
                "path": hit.chunk.path,
                "start": hit.chunk.start,
                "end": hit.chunk.end,
                "score": hit.score,
                "text": hit.chunk.text.strip(),
            }
            for hit in self._engine.search(query, k)
        ]

    def context(self, query: str, k: int = 5, max_chars: int = 6000) -> dict:
        """Retrieved passages formatted as an LLM-ready prompt block."""
        results = self.search(query, k)
        if not results:
            return {"query": query, "results": [], "prompt": ""}

        max_chars = max(400, min(int(max_chars), 20000))
        header = "Relevant excerpts from the Sipher knowledge base (cite file:line):\n"
        blocks: list[str] = [header]
        used = len(header)

        for item in results:
            block = f"### {item['ref']}\n{item['text']}\n"
            if used + len(block) > max_chars:
                remaining = max_chars - used
                if remaining > 200:
                    blocks.append(block[:remaining])
                break
            blocks.append(block)
            used += len(block)

        return {"query": query, "results": results, "prompt": "\n".join(blocks).strip()}

    # -- ingestion ---------------------------------------------------------
    @staticmethod
    def _slug(name: str) -> str:
        base = Path(str(name).replace("\\", "/")).name
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-._")
        if slug.lower().endswith(".txt"):
            slug = slug[:-4]
        return (slug or "document")[:80]

    def ingest_text(self, name: str, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            raise ValueError("empty document text")
        if len(text) > MAX_INGEST_CHARS:
            raise ValueError(f"document too large (limit {MAX_INGEST_CHARS} characters)")

        self.ingest_dir.mkdir(parents=True, exist_ok=True)
        target = self.ingest_dir / f"{self._slug(name)}.txt"
        target.write_text(text, encoding="utf-8")
        stats = self.build()
        return {
            "name": name,
            "stored": target.relative_to(self.store_dir).as_posix(),
            "chars": len(text),
            "index": stats,
        }

    def ingest_pdf(self, name: str, data: bytes) -> dict:
        text = extract_pdf_text(data)
        if not text.strip():
            raise ValueError(
                "no extractable text in this PDF (scanned or CID-encoded); "
                "send extracted text with {'name','text'} instead"
            )
        return self.ingest_text(name, text)

    # -- reporting ---------------------------------------------------------
    def stats(self) -> dict:
        # Load a persisted index so health/stats are accurate without paying
        # for a full rebuild.
        if not self._loaded and self.index_file.is_file():
            self.load()
        engine = self._engine
        return {
            "version": INDEX_VERSION,
            "built_at": self._meta.get("built_at"),
            "built_at_iso": self._meta.get("built_at_iso"),
            "root": str(self.root),
            "store": str(self.store_dir),
            "files": len(self._meta.get("files", {})),
            "chunks": len(engine.chunks) if engine else 0,
            "terms": len(engine.postings) if engine else 0,
            "index_bytes": self.index_file.stat().st_size if self.index_file.is_file() else 0,
            "loaded": self._loaded,
        }


_kb: KnowledgeBase | None = None
_kb_lock = threading.Lock()


def get_knowledge_base() -> KnowledgeBase:
    """Process-wide singleton used by the HTTP endpoints and CLI."""
    global _kb
    if _kb is None:
        with _kb_lock:
            if _kb is None:
                kb = KnowledgeBase()
                if os.environ.get("SIPHER_RAG_AUTOBUILD") == "1":
                    kb.ensure()
                _kb = kb
    return _kb
