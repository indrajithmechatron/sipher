# Retrieval Layer (RAG)

Layer 1 support service. Offline **BM25 retrieval** over the repository, with
no model downloads, no vector database, and **no third-party dependencies** —
it runs on the Pi 4 with the Python standard library only.

RAG here means *retrieval*: the service returns the most relevant passages with
`file:line` citations. Generation stays with the LLM (the dashboard's opencode
chat or any client) — feed it `/api/rag/context` and it answers from real
excerpts instead of guessing.

**Status:** active. Mounted inside `control.command_endpoint` on the Pi
(`:8888`); the dashboard reaches it through the existing `/api` proxy. Tests:
`software/rag/tests/`.

## What gets indexed

| Source | Detail |
|---|---|
| Repo docs + code | `README.md`, `docs/`, `software/`, `dashboard/src/`, `dashboard/README.md`, `dashboard/APPLICATION.md`, `deploy/` |
| Reports + telemetry | everything under `docs/reports/`, plus `SIPHER_LOG_FILE` (default `/home/sipher/sipher.log`, last 512 KB) |
| Ingested manuals | `POST /api/rag/ingest` → stored as `<rag>/docs/<name>.txt` and indexed |

Skipped: `node_modules`, `.git`, `dist`, `.rag`, `backup`, `__pycache__`,
lockfiles, minified bundles, binaries. Files over 2 MB are truncated, PDFs over
25 MB are skipped.

## How it works

1. `corpus.py` walks the roots and extracts text (PDFs via a small pure-Python
   content-stream parser).
2. `chunk.py` splits each file into ~40-line overlapping passages that keep
   their line range, e.g. `docs/ARCHITECTURE.md:136-160`.
3. `index.py` builds an inverted index and scores with Okapi BM25
   (`k1=1.5`, `b=0.75`), with identifier-aware tokens (`MPU6050` → `mpu6050`,
   `mpu`, `6050`).
4. `service.py` persists `index.json` under `.rag/` and rebuilds on demand.

## HTTP API

Mounted on the Pi inside `control.command_endpoint` (`:8888`), so the dashboard
reaches it through the existing `/api` proxy — no dashboard changes required.

| Route | Purpose |
|---|---|
| `GET /api/rag/health` | liveness + index summary |
| `GET /api/rag/stats` | files, chunks, terms, index size |
| `GET /api/rag/files` | indexed file labels |
| `GET /api/rag/search?q=&k=` | ranked passages (`k` 1–20, default 5) |
| `GET /api/rag/context?q=&k=&max_chars=` | cited excerpts as a ready-to-use prompt block |
| `POST /api/rag/reindex` | rebuild from disk |
| `POST /api/rag/ingest` | add a manual (JSON `{name,text}`, raw PDF, or raw text) |

```bash
# from a laptop, through the Pi
curl "http://192.168.1.35:8888/api/rag/search?q=watchdog%20timeout&k=3"
curl "http://192.168.1.35:8888/api/rag/context?q=how%20does%20deploy%20restart&k=3"

# add a datasheet whose text was already extracted (e.g. by the dashboard)
curl -X POST "http://192.168.1.35:8888/api/rag/ingest" \
     -H "Content-Type: application/json" \
     -d '{"name":"hip-servo.pdf","text":"Stall torque 15 kg-cm at 6 V ..."}'

# or send a PDF and let the Pi extract it
curl -X POST "http://192.168.1.35:8888/api/rag/ingest?name=manual.pdf" \
     -H "Content-Type: application/pdf" --data-binary @manual.pdf
```

Search response:

```json
{
  "query": "watchdog timeout",
  "k": 2,
  "count": 2,
  "results": [
    {
      "ref": "docs/ARCHITECTURE.md:145-179",
      "path": "docs/ARCHITECTURE.md",
      "start": 145,
      "end": 179,
      "score": 9.51,
      "text": "..."
    }
  ]
}
```

## CLI

Run from `software/` (or set `PYTHONPATH=software`):

```bash
python -m rag.cli index                     # (re)build .rag/index.json
python -m rag.cli search "pico serial" -k 3
python -m rag.cli context "deploy restart" --max-chars 4000
python -m rag.cli stats
python -m rag.cli ingest docs/hardware/manual.pdf
python -m rag.cli serve --port 8899         # standalone server (laptop/dev)
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SIPHER_REPO_DIR` | two levels above this file | repository root to index |
| `SIPHER_RAG_DIR` | `<repo>/.rag` | index + ingested docs |
| `SIPHER_LOG_FILE` | `/home/sipher/sipher.log` | telemetry log included in the corpus |
| `SIPHER_RAG_AUTOBUILD` | unset | `1` builds at server start instead of first request |

## Pi deployment

Nothing to install: the module is pure standard library and `command_endpoint`
already runs with `PYTHONPATH=/home/sipher/sipher/software`.

- First retrieval request loads `.rag/index.json`; if missing it builds one
  (~3 s for this repo, more on a Pi 4).
- After large doc changes: `curl -X POST http://127.0.0.1:8888/api/rag/reindex`.
- The index is disposable — delete `.rag/` to force a clean rebuild.

## Limits & safety

- Ingest caps: 2,000,000 characters of text, 8 MB request body.
- Ingested names are sanitised; files always land in `.rag/docs/`.
- Read-only over the repo: the service never writes outside `.rag/`.
- No shell, no serial, no network calls — it cannot actuate the robot.

## Tests

```bash
python -m unittest discover -s software/rag/tests -t software
```
