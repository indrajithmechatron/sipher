"""Corpus discovery and text extraction (standard library only).

Text files are read directly. PDFs get a best-effort pure-Python extraction
for plaintext/FlateDecode content streams — enough for most datasheets, while
the dashboard can also send already-extracted text to ``/api/rag/ingest``.
"""

from __future__ import annotations

import os
import re
import zlib
from pathlib import Path
from typing import Iterator

TEXT_SUFFIXES = {
    ".md",
    ".txt",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".sh",
    ".ps1",
    ".cmd",
    ".bat",
    ".service",
    ".timer",
    ".rules",
    ".html",
    ".css",
    ".log",
    ".csv",
    ".xml",
    ".pdf",
}

SPECIAL_NAMES = {"dockerfile", "makefile", "procfile"}

SKIP_DIR_NAMES = {
    ".git",
    ".rag",
    ".venv",
    ".vite",
    ".idea",
    ".vscode",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "backup",
    "venv",
}

SKIP_FILE_NAMES = {"package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"}
SKIP_FILE_SUFFIXES = {".map", ".min.js", ".min.css"}

MAX_TEXT_BYTES = 2_000_000
MAX_PDF_BYTES = 25_000_000
LOG_TAIL_BYTES = 512_000


def is_indexable(path: Path) -> bool:
    name = path.name.lower()
    if name in SKIP_FILE_NAMES or any(name.endswith(s) for s in SKIP_FILE_SUFFIXES):
        return False
    if path.suffix.lower() not in TEXT_SUFFIXES and name not in SPECIAL_NAMES:
        return False
    try:
        if path.stat().st_size == 0:
            return False
    except OSError:
        return False
    return True


def iter_files(roots: list[Path]) -> Iterator[Path]:
    """Yield indexable files below ``roots`` in a stable order."""
    seen: set[str] = set()
    for root in roots:
        root = Path(root)
        if root.is_file():
            candidates: Iterator[Path] = iter([root])
        elif root.is_dir():
            def walk() -> Iterator[Path]:
                for dirpath, dirnames, filenames in os.walk(root):
                    dirnames[:] = sorted(
                        d for d in dirnames if d not in SKIP_DIR_NAMES and not d.startswith(".")
                    )
                    for name in sorted(filenames):
                        yield Path(dirpath) / name

            candidates = walk()
        else:
            continue

        for file in candidates:
            if not is_indexable(file):
                continue
            key = os.path.normcase(str(file.resolve()))
            if key in seen:
                continue
            seen.add(key)
            yield file


def read_text(path: Path) -> str:
    """Read a UTF-8 text file (logs are tailed, oversized files truncated)."""
    data = path.read_bytes()
    suffix = path.suffix.lower()

    if suffix == ".log":
        if len(data) > LOG_TAIL_BYTES:
            data = data[-LOG_TAIL_BYTES:]
    elif len(data) > MAX_TEXT_BYTES:
        data = data[:MAX_TEXT_BYTES]

    return data.decode("utf-8", errors="ignore")


_PDF_STREAM = re.compile(rb"stream\r?\n", re.S)
_PDF_TEXT_OP = re.compile(
    rb"\[((?:\\.|[^\]\\])*)\]\s*TJ"
    rb"|\(((?:\\.|[^\\()])*)\)\s*Tj"
    rb"|(T\*|Td|TD|ET)",
    re.S,
)
_PDF_STRING = re.compile(r"\(((?:\\.|[^\\()])*)\)", re.S)


def _pdf_unescape(value: str) -> str:
    def repl(match: re.Match[str]) -> str:
        esc = match.group(1)
        if esc in {"n", "r", "t", "b", "f"}:
            return {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f"}[esc]
        if esc[:1].isdigit():
            try:
                return chr(int(esc, 8))
            except ValueError:
                return esc
        return esc

    return re.sub(r"\\([0-7]{1,3}|.)", repl, value)


def _pdf_content_text(raw: bytes) -> str:
    text = raw.decode("latin-1", errors="ignore")
    pieces: list[str] = []
    for match in _PDF_TEXT_OP.finditer(text.encode("latin-1", errors="ignore")):
        array, single, op = match.group(1), match.group(2), match.group(3)
        if op:
            if op in {b"T*", b"Td", b"TD", b"ET"}:
                pieces.append("\n")
            continue
        if single is not None:
            pieces.append(_pdf_unescape(single.decode("latin-1")))
            continue
        for item in _PDF_STRING.finditer(array.decode("latin-1")):
            pieces.append(_pdf_unescape(item.group(1)))

    out = "".join(pieces)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def extract_pdf_text(data: bytes) -> str:
    """Best-effort text extraction from PDF content streams.

    Returns "" when the document uses encodings this parser cannot decode
    (e.g. CID fonts with custom cmaps). Callers should treat that as
    "not indexable" rather than failing the whole build.
    """
    if not data.lstrip().startswith(b"%PDF"):
        return ""

    parts: list[str] = []
    for match in _PDF_STREAM.finditer(data):
        start = match.end()
        end = data.find(b"endstream", start)
        if end < 0:
            continue
        stream = data[start:end].rstrip(b"\r\n")
        try:
            stream = zlib.decompress(stream)
        except zlib.error:
            pass
        text = _pdf_content_text(stream)
        if text:
            parts.append(text)

    return "\n\n".join(parts)


def read_source(path: Path) -> str:
    """Extract indexable text for a file, or "" when not readable."""
    try:
        if path.suffix.lower() == ".pdf":
            if path.stat().st_size > MAX_PDF_BYTES:
                return ""
            return extract_pdf_text(path.read_bytes())
        return read_text(path)
    except OSError:
        return ""
