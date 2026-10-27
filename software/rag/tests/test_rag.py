"""Unit tests for the Sipher retrieval layer (stdlib unittest).

Run from the repository root:

    python -m unittest discover -s software/rag/tests -t software
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rag.chunk import chunk_text
from rag.corpus import extract_pdf_text, iter_files
from rag.index import Bm25Index, tokenize
from rag.service import KnowledgeBase

MINIMAL_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj\n<< /Type /Catalog >>\nendobj\n"
    b"2 0 obj\n<< /Length 60 >>\nstream\n"
    b"BT /F1 12 Tf 72 720 Td (Sipher servo torque manual) Tj ET\n"
    b"endstream\nendobj\n"
    b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"
)


class TokenizerTests(unittest.TestCase):
    def test_part_numbers_are_kept(self) -> None:
        tokens = tokenize("MPU6050 on I2C0, pin GP17")
        self.assertIn("mpu6050", tokens)
        self.assertIn("mpu", tokens)
        self.assertIn("i2c0", tokens)
        self.assertIn("gp17", tokens)

    def test_stopwords_and_single_chars_dropped(self) -> None:
        tokens = tokenize("the a of x servo")
        self.assertEqual(tokens, ["servo"])


class ChunkTests(unittest.TestCase):
    def test_line_ranges_and_overlap(self) -> None:
        text = "\n".join(f"line {i} about servos and i2c" for i in range(1, 121))
        chunks = chunk_text("docs/x.md", text, max_lines=20, overlap=5)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0].start, 1)
        for chunk in chunks:
            self.assertLessEqual(chunk.start, chunk.end)
            self.assertTrue(chunk.text.strip())
        for previous, following in zip(chunks, chunks[1:]):
            self.assertLessEqual(following.start, previous.end)

    def test_empty_text(self) -> None:
        self.assertEqual(chunk_text("x.md", "   \n\n"), [])


class PdfTests(unittest.TestCase):
    def test_extracts_plain_text(self) -> None:
        text = extract_pdf_text(MINIMAL_PDF)
        self.assertIn("Sipher servo torque manual", text)

    def test_rejects_non_pdf(self) -> None:
        self.assertEqual(extract_pdf_text(b"not a pdf"), "")


class CorpusTests(unittest.TestCase):
    def test_skips_noise_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "docs" / "a.md").write_text("servo", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "b.js").write_text("servo", encoding="utf-8")
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            found = {path.name for path in iter_files([root])}
            self.assertEqual(found, {"a.md"})


class IndexTests(unittest.TestCase):
    def test_ranking_prefers_matching_document(self) -> None:
        chunks = chunk_text("a.md", "PCA9685 servo driver over I2C bus") + chunk_text(
            "b.md", "NEO-6M GPS sentence parsing over UART"
        )
        index = Bm25Index.build(chunks)
        hits = index.search("servo i2c", 2)
        self.assertTrue(hits)
        self.assertEqual(hits[0].chunk.path, "a.md")

    def test_roundtrip_preserves_scores(self) -> None:
        chunks = chunk_text("a.md", "watchdog heartbeat pico") + chunk_text(
            "b.md", "dashboard react vite"
        )
        index = Bm25Index.build(chunks)
        restored = Bm25Index.from_dict(json.loads(json.dumps(index.to_dict())))
        first = [(hit.chunk.ref, hit.score) for hit in index.search("pico watchdog")]
        second = [(hit.chunk.ref, hit.score) for hit in restored.search("pico watchdog")]
        self.assertEqual(first, second)


class KnowledgeBaseTests(unittest.TestCase):
    def _root(self, tmp: str) -> Path:
        root = Path(tmp)
        (root / "docs").mkdir()
        (root / "software").mkdir()
        (root / "docs" / "hardware.md").write_text(
            "The PCA9685 drives twelve servos over I2C at address 0x40.", encoding="utf-8"
        )
        (root / "software" / "bridge.py").write_text(
            "def read_serial():\n    '''Owns /dev/ttyACM0 and emits JSON telemetry.'''\n",
            encoding="utf-8",
        )
        return root

    def test_build_search_and_persist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(tmp)
            store = root / ".rag"
            kb = KnowledgeBase(root=root, store=store)
            stats = kb.build()
            self.assertEqual(stats["files"], 2)
            self.assertGreater(stats["chunks"], 0)
            self.assertTrue((store / "index.json").is_file())

            hits = kb.search("servo i2c", 3)
            self.assertEqual(hits[0]["path"], "docs/hardware.md")

            reloaded = KnowledgeBase(root=root, store=store)
            self.assertTrue(reloaded.load())
            self.assertEqual(
                [hit["ref"] for hit in reloaded.search("serial telemetry", 3)],
                [hit["ref"] for hit in kb.search("serial telemetry", 3)],
            )

    def test_ingest_adds_searchable_manual(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(tmp)
            kb = KnowledgeBase(root=root, store=root / ".rag")
            kb.build()
            result = kb.ingest_text("hips.pdf", "Hip servo torque spec is 15 kg-cm at 6V.")
            self.assertIn("stored", result)
            hits = kb.search("torque spec", 3)
            self.assertEqual(hits[0]["path"], "manual/hips.pdf")

    def test_ingest_sanitises_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(tmp)
            kb = KnowledgeBase(root=root, store=root / ".rag")
            result = kb.ingest_text("../../evil name.txt", "GPS NMEA parsing")
            self.assertTrue(result["stored"].startswith("docs/"))
            self.assertNotIn("..", result["stored"])

    def test_context_contains_citation_and_budget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = self._root(tmp)
            kb = KnowledgeBase(root=root, store=root / ".rag")
            payload = kb.context("servo address", 2, max_chars=800)
            self.assertIn("docs/hardware.md:1-", payload["prompt"])
            self.assertLessEqual(len(payload["prompt"]), 800)


if __name__ == "__main__":
    unittest.main()
