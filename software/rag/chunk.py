"""Split documents into overlapping, line-anchored chunks.

Chunks keep the source path and the 1-based line range so retrieved passages
can be cited as ``docs/ARCHITECTURE.md:136-160``.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_MAX_LINES = 40
DEFAULT_OVERLAP = 8
DEFAULT_MAX_CHARS = 1600


@dataclass(frozen=True)
class Chunk:
    """One retrievable passage."""

    path: str
    start: int
    end: int
    text: str

    @property
    def ref(self) -> str:
        return f"{self.path}:{self.start}-{self.end}"


def _trim(lines: list[str]) -> list[str]:
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def chunk_text(
    path: str,
    text: str,
    max_lines: int = DEFAULT_MAX_LINES,
    overlap: int = DEFAULT_OVERLAP,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[Chunk]:
    """Return overlapping chunks for ``text``.

    Splits on blank lines where possible, then by line window, and finally by
    character window for very long single blocks (minified files).
    """
    if not text or not text.strip():
        return []

    max_lines = max(2, max_lines)
    overlap = max(0, min(overlap, max_lines - 1))
    max_chars = max(200, max_chars)
    step = max(1, max_lines - overlap)

    lines = _trim(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    chunks: list[Chunk] = []
    i = 0
    n = len(lines)

    while i < n:
        end = min(n, i + max_lines)

        # Prefer to stop on a blank line so a chunk does not end mid-block.
        if end < n:
            floor = i + max(1, max_lines // 3)
            for j in range(end, floor, -1):
                if not lines[j - 1].strip():
                    end = j
                    break

        block = "\n".join(lines[i:end])
        if len(block) <= max_chars:
            if block.strip():
                chunks.append(Chunk(path, i + 1, end, block))
        else:
            for off in range(0, len(block), max_chars):
                piece = block[off : off + max_chars]
                if piece.strip():
                    chunks.append(Chunk(path, i + 1, end, piece))

        if end >= n:
            break
        i = max(i + 1, end - overlap)

    return chunks
