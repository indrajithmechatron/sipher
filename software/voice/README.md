# Voice Layer

**Layer 1** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `always_on.py` | Always-listening loop: `arecord` capture, faster-whisper (or Groq) transcription, espeak/piper replies, intent trigger for "rotate" / "stop". |

## Run

```bash
python3 always_on.py                    # local mic + faster-whisper tiny (CPU, int8)
GROQ_API_KEY=... python3 always_on.py   # Groq whisper-large-v3 transcription
```

Audio device: `plughw:CARD=Device,DEV=0` (USB PCM2902). Requires `alsa-utils`,
`faster-whisper` (or network access for Groq) and `espeak`.

## Rules

- May only emit structured requests to the Robot Runtime (`software/robot/`).
- Must not open the serial port, write servo PWM, or bypass the control layer.
- `always_on.py` still actuates directly; fixing that is Phase 4 in
  `docs/ARCHITECTURE.md`.

## Retrieval

Voice answers that need project knowledge should read cited excerpts from the
retrieval layer rather than guessing:

```bash
curl "http://127.0.0.1:8888/api/rag/context?q=how%20does%20deploy%20restart&k=3"
```

Wiring that into `always_on.py` (retrieve → prompt → reply) is not implemented
yet; the service side is ready in `software/rag/`.
