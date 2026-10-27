"""BM25 ranking over chunks, with JSON (de)serialisation."""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from .chunk import Chunk

TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
IDENT_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is",
    "are", "be", "was", "were", "this", "that", "it", "as", "at", "by", "from",
    "we", "you", "i", "not", "but", "if", "then", "than", "so", "do", "does",
    "can", "will", "would", "should", "could", "has", "have", "had", "into",
}


def tokenize(text: str) -> list[str]:
    """Lowercase identifier-aware tokens (``MPU6050`` -> ``mpu6050``, ``mpu``, ``6050``)."""
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(text):
        lower = raw.lower()
        # Keep part numbers / pin names (MPU6050, I2C0, GP17) as a single token.
        if len(lower) >= 2 and any(ch.isdigit() for ch in lower):
            tokens.append(lower)
        for part in IDENT_RE.findall(raw):
            part = part.lower()
            if len(part) < 2 or part in STOPWORDS:
                continue
            tokens.append(part)
    return tokens


@dataclass(frozen=True)
class Hit:
    chunk: Chunk
    score: float


class Bm25Index:
    """Inverted index with Okapi BM25 scoring."""

    k1 = 1.5
    b = 0.75

    def __init__(
        self,
        chunks: list[Chunk],
        postings: dict[str, dict[int, int]] | None = None,
        doc_len: list[int] | None = None,
    ) -> None:
        self.chunks = chunks
        self.postings = postings if postings is not None else {}
        self.doc_len = doc_len if doc_len is not None else []
        self.avgdl = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0

    @classmethod
    def build(cls, chunks: list[Chunk]) -> "Bm25Index":
        postings: dict[str, dict[int, int]] = {}
        doc_len: list[int] = []

        for idx, chunk in enumerate(chunks):
            terms = tokenize(chunk.text)
            doc_len.append(len(terms))
            for term, tf in Counter(terms).items():
                postings.setdefault(term, {})[idx] = tf

        return cls(chunks, postings, doc_len)

    def search(self, query: str, k: int = 5) -> list[Hit]:
        k = max(1, min(int(k), 50))
        terms = [t for t in tokenize(query)]
        if not terms or not self.chunks:
            return []

        n = len(self.chunks)
        avgdl = self.avgdl or 1.0
        scores: dict[int, float] = {}

        for term in set(terms):
            posting = self.postings.get(term)
            if not posting:
                continue
            df = len(posting)
            idf = math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            for idx, tf in posting.items():
                dl = self.doc_len[idx] or 1
                denom = tf + self.k1 * (1.0 - self.b + self.b * dl / avgdl)
                scores[idx] = scores.get(idx, 0.0) + idf * (tf * (self.k1 + 1.0)) / denom

        ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:k]
        return [Hit(self.chunks[idx], round(score, 4)) for idx, score in ranked]

    def to_dict(self) -> dict:
        return {
            "k1": self.k1,
            "b": self.b,
            "chunks": [
                {"p": c.path, "s": c.start, "e": c.end, "t": c.text} for c in self.chunks
            ],
            "postings": self.postings,
            "doc_len": self.doc_len,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Bm25Index":
        chunks = [
            Chunk(str(item["p"]), int(item["s"]), int(item["e"]), str(item["t"]))
            for item in data.get("chunks", [])
        ]
        postings = {
            str(term): {int(idx): int(tf) for idx, tf in posting.items()}
            for term, posting in data.get("postings", {}).items()
        }
        doc_len = [int(value) for value in data.get("doc_len", [])]
        return cls(chunks, postings, doc_len)
