# Voice Layer

**Layer 1** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `agent.py` | Conversational voice agent: wake words **"sipher"** / **"buddy"**, energy VAD capture, Groq `whisper-large-v3-turbo` STT, Groq `llama-3.1-8b-instant` answers, piper/espeak TTS. |
| `always_on.py` | Earlier always-listening loop for "rotate"/"stop" commands (faster-whisper tiny or Groq STT, espeak, direct actuation). |

## agent.py — wake-word assistant

Full pipeline, cloud-side so the Pi 4 CPU stays free:

```
USB mic → arecord pipe → adaptive energy VAD → WAV
        → Groq whisper-large-v3-turbo (STT)
        → "sipher"/"buddy" wake check
        → Groq llama-3.1-8b-instant (answer, short spoken style, 8-turn history)
        → piper (if installed) or espeak (TTS)
```

- A bare wake word opens a **session**: Sipher says "Yes?" and listens for
  follow-ups for `SIPHER_ACTIVE_SECONDS` (default 25) without the wake word.
- "sipher, what is my battery voltage?" is answered immediately.
- The mic is ignored while Sipher is speaking, so it does not answer itself.

### Setup on the Pi

```bash
pip install --break-system-packages groq
sudo apt install -y espeak          # TTS fallback (piper optional, better voice)

mkdir -p ~/.config/sipher && chmod 700 ~/.config/sipher
cat > ~/.config/sipher/voice.env <<'EOF'   # key never enters the repo
GROQ_API_KEY=gsk_...
EOF
chmod 600 ~/.config/sipher/voice.env

python3 software/voice/agent.py     # try it manually first
```

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `GROQ_API_KEY` | — | required; read from env or `~/.config/sipher/voice.env` |
| `SIPHER_MIC` | `plughw:CARD=Device,DEV=0` | ALSA capture device |
| `SIPHER_ACTIVE_SECONDS` | `25` | follow-up window after the wake word |
| `SIPHER_AGENT_MODEL` | `llama-3.1-8b-instant` | Groq chat model |

### Run as a service

```bash
sudo cp deploy/systemd/sipher-voice.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sipher-voice
journalctl -u sipher-voice -f       # watch what it hears / replies
```

## always_on.py (legacy command trigger)

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
  `docs/ARCHITECTURE.md`. `agent.py` is Q&A only and never actuates.
- Secrets stay outside the tree (`~/.config/sipher/`), per Security rule 6.

## Retrieval

Voice answers that need project knowledge should read cited excerpts from the
retrieval layer rather than guessing:

```bash
curl "http://127.0.0.1:8888/api/rag/context?q=how%20does%20deploy%20restart&k=3"
```

Wiring that into `agent.py` (retrieve → prompt → reply) is not implemented yet;
the service side is ready in `software/rag/`.
