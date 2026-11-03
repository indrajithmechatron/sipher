#!/usr/bin/env python3
# agent.py — Sipher voice agent: wake word "sipher" / "buddy" → Groq STT → Groq LLM → TTS
#
# Pipeline (all speech handling is cloud-side, light on the Pi 4 CPU):
#   1. arecord streams 16 kHz mono frames from the USB mic
#   2. Adaptive energy VAD detects an utterance and captures it until silence
#   3. WAV goes to Groq whisper-large-v3-turbo for transcription
#   4. Transcript must contain the wake word ("sipher" / "buddy") to open an
#      ACTIVE session; follow-ups stay active for SIPHER_ACTIVE_SECONDS
#   5. Question goes to Groq llama-3.1-8b-instant, short spoken-style answer;
#      data questions get live /api/voice/context telemetry in the prompt
#   6. "rotate channel 0 to 100 degrees" is parsed and sent to the robot bridge
#      through the command endpoint (/api/voice/command)
#   7. Every transcript/action/answer is mirrored to the dashboard
#      (/api/voice/log) so the voice console and agents see it live
#   8. Answer is spoken with piper (if installed) or espeak
#
# Secrets: GROQ_API_KEY is read from the environment — never committed.
# Run: python3 agent.py   (or via deploy/systemd/sipher-voice.service)
#
# Env vars:
#   GROQ_API_KEY          required for cloud STT/LLM
#   SIPHER_MIC            ALSA device (default plughw:CARD=Device,DEV=0)
#   SIPHER_ACTIVE_SECONDS follow-up window after a wake word (default 25)
#   SIPHER_AGENT_MODEL    chat model (default llama-3.1-8b-instant)

import io
import json
import os
import re
import sys
import time
import wave
import struct
import shutil
import subprocess
import threading
import math
import urllib.request

# ---------------------------------------------------------------- config

MIC = os.getenv("SIPHER_MIC", "plughw:CARD=Device,DEV=0")
RATE = 16000
FRAME_MS = 200                      # arecord chunk size
FRAME_BYTES = RATE * 2 * FRAME_MS // 1000   # S16_LE mono
SILENCE_END_S = 0.9                 # trailing silence that closes an utterance
MAX_UTTERANCE_S = 12.0              # hard cap so runaway noise still gets sent
ACTIVE_SECONDS = float(os.getenv("SIPHER_ACTIVE_SECONDS", "25"))
CHAT_MODEL = os.getenv("SIPHER_AGENT_MODEL", "llama-3.1-8b-instant")
API = os.getenv("SIPHER_API", "http://127.0.0.1:8888").rstrip("/")
STT_MODEL = "whisper-large-v3-turbo"
WAKE_WORDS = ("sipher", "buddy")
SYSTEM_PROMPT = (
    "You are Sipher, a friendly four-legged spider-style quadruped robot built "
    "around a Raspberry Pi 4. Your human talks to you by voice, so reply with "
    "short conversational speech: 1-3 sentences, no markdown, no lists, no "
    "emoji. Be direct, accurate, and a little playful."
)

# Optional env file outside the tree: ~/.config/sipher/voice.env (key=value)
ENV_FILE = os.path.expanduser("~/.config/sipher/voice.env")
if os.path.exists(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

# ---------------------------------------------------------------- groq client

def groq():
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return None
    try:
        from groq import Groq
        return Groq(api_key=key)
    except Exception as e:
        print("groq client unavailable:", e, flush=True)
        return None

CLIENT = groq()

# ---------------------------------------------------------------- helpers

def rms(frame):
    """Loudness of a raw int16 frame."""
    if len(frame) < 2:
        return 0
    n = len(frame) // 2
    vals = struct.unpack(f"<{n}h", frame)
    return math.sqrt(sum(v * v for v in vals) / n)


def wav_bytes(samples):
    """Wrap raw int16 mono PCM in a WAV container for the STT upload."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples)
    return buf.getvalue()


# ---------------------------------------------------------------- dashboard feed

def api(path, payload=None, timeout=4):
    """Call the Pi command endpoint (Layer 4/1 seam)."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        API + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode() or "{}")


def publish(role, text, action=None):
    """Mirror an exchange to the dashboard voice console (best effort)."""
    try:
        api("/api/voice/log", {"role": role, "text": text, "action": action})
    except Exception as e:
        print("feed error:", e, flush=True)


def live_context():
    """Compact live sensor/Pi snapshot so answers use real dashboard data."""
    try:
        snap = api("/api/voice/context", timeout=3)
    except Exception:
        return ""
    return json.dumps(
        {"sensors": snap.get("sensors") or {}, "pi": snap.get("pi") or {}},
        default=str)[:4000]


# ---------------------------------------------------------------- intent parsing

SERVO_CHANNEL = re.compile(
    r"(?:channel|servo|ch)\s*(\d{1,2})\s*(?:to|at|->|=)?\s*(\d{1,3})\s*"
    r"(?:degrees?|deg|°)",
    re.I)
SERVO_PLAIN = re.compile(
    r"(?:rotate|move|turn|swing|set|drive)\s+(?:the\s+)?"
    r"(?:servo\s+|channel\s+|ch\s+)?(\d{1,2})\s*(?:to|at|->|=)\s*(\d{1,3})",
    re.I)

DATA_WORDS = (
    "battery", "voltage", "current", "power", "temperature", "temp", "cpu",
    "memory", "ram", "disk", "sensor", "sensors", "distance", "range",
    "lidar", "tof", "imu", "pitch", "roll", "yaw", "gps", "status", "health",
    "data", "reading", "readings", "uptime",
)


def parse_servo(text):
    """'rotate channel 0 to 100 degrees' -> (0, 100); None if not a servo move."""
    for rx in (SERVO_CHANNEL, SERVO_PLAIN):
        m = rx.search(text)
        if m:
            ch, deg = int(m.group(1)), int(m.group(2))
            if 0 <= ch <= 15 and 0 <= deg <= 180:
                return ch, deg
    return None


def speak(text, speaking_flag):
    """TTS off the hot path; the mic is ignored while the flag is set."""
    def run():
        speaking_flag.set()
        try:
            if shutil.which("piper"):
                # piper is dropped in ~/piper with a voice model when installed
                subprocess.run(
                    ["piper", "-m", "en_US-amy-medium.onnx", "-f", "/tmp/say.wav"],
                    input=text.encode(), check=False)
                subprocess.run(["aplay", "/tmp/say.wav"], check=False)
            elif shutil.which("espeak"):
                subprocess.run(["espeak", "-s", "150", text],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                print("TTS:", text, flush=True)
        finally:
            speaking_flag.clear()
            time.sleep(0.2)   # let the speaker/mic echo die out
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- groq calls

def transcribe(audio):
    """WAV bytes → text via Groq STT."""
    if CLIENT is None:
        return ""
    try:
        tr = CLIENT.audio.transcriptions.create(
            file=("speech.wav", audio, "audio/wav"),
            model=STT_MODEL,
            language="en",
            response_format="text",
        )
        return str(tr).strip().lower()
    except Exception as e:
        print("STT error:", e, flush=True)
        return ""


HISTORY = []


def answer(question, context=""):
    """Question text → spoken-style answer from Groq chat."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        messages.append({
            "role": "system",
            "content": ("Live dashboard telemetry for this question (use the real "
                        "numbers, do not invent values): " + context),
        })
    HISTORY.append({"role": "user", "content": question})
    del HISTORY[:-8]
    try:
        res = CLIENT.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages + HISTORY,
            max_tokens=160,
            temperature=0.6,
        )
        reply = res.choices[0].message.content.strip()
        HISTORY.append({"role": "assistant", "content": reply})
        del HISTORY[:-8]
        return reply
    except Exception as e:
        print("chat error:", e, flush=True)
        return "Sorry, my brain connect failed just now."


# ---------------------------------------------------------------- vad + loop

class Listener:
    """arecord pipe → adaptive energy VAD → utterance byte buffer."""

    def __init__(self):
        self.proc = subprocess.Popen(
            ["arecord", "-D", MIC, "-f", "S16_LE", "-r", str(RATE),
             "-c", "1", "-t", "raw", "-q"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.floor = 300.0          # ambient noise floor, adapts over time

    def read_frame(self):
        buf = self.proc.stdout.read(FRAME_BYTES)
        if len(buf) < FRAME_BYTES:
            raise RuntimeError("arecord stream ended")
        return buf

    def utterance(self, speaking):
        """Block until a full utterance is captured."""
        pre = []
        voiced = 0
        silence = 0
        chunks = []
        while True:
            frame = self.read_frame()
            loud = rms(frame) > self.floor + 150
            # the floor only drops so constant noise never mutes the mic
            self.floor = max(50.0, self.floor * 0.995 + rms(frame) * 0.005)
            if speaking.is_set():
                pre = []; chunks = []; voiced = 0; silence = 0
                continue
            if loud:
                voiced += 1
                silence = 0
                if voiced >= 2:                       # 2 frames = speech starts
                    chunks = pre + [frame]
                    pre = []
                elif chunks:
                    chunks.append(frame)
            else:
                voiced = 0
                if chunks:
                    chunks.append(frame)
                    silence += 1
                    dur = len(chunks) * FRAME_MS / 1000
                    if silence * FRAME_MS / 1000 >= SILENCE_END_S or dur >= MAX_UTTERANCE_S:
                        return b"".join(chunks)
                else:
                    pre.append(frame)


def main():
    if CLIENT is None:
        sys.exit("GROQ_API_KEY missing — set it or use ~/.config/sipher/voice.env")
    speaking = threading.Event()
    lis = Listener()
    active_until = 0.0
    print(f"listening on {MIC} — say 'sipher' or 'buddy'", flush=True)
    while True:
        audio = lis.utterance(speaking)
        text = transcribe(wav_bytes(audio))
        if not text:
            continue
        now = time.time()
        woke = any(w in text for w in WAKE_WORDS)
        if woke:
            body = re.sub(r"\b(?:sipher|cipher|ssy for|buddy)\b", "", text).strip(" ,.!")
            tag = "wake"
        else:
            body = text
            tag = "follow-up"
        if not woke and now > active_until:
            continue                                   # chatter without wake word
        print(f"[{tag}] heard: {body or text!r}", flush=True)
        if not body:                                   # just the wake word
            active_until = now + ACTIVE_SECONDS
            publish("wake", "wake word detected")
            speak("Yes?", speaking)
            continue
        if woke:
            active_until = now + ACTIVE_SECONDS
        publish("user", body)

        move = parse_servo(body)
        if move:
            ch, deg = move
            try:
                res = api("/api/voice/command", {"ch": ch, "deg": deg})
                publish("action", f"servo ch{ch} -> {deg} deg", res)
                ok = bool(res.get("ok"))
                reply = (f"moving channel {ch} to {deg} degrees" if ok
                         else "the bridge rejected that move")
            except Exception as e:
                publish("error", f"servo ch{ch} -> {deg} deg failed: {e}")
                reply = "I could not reach the robot bridge."
            print("reply:", reply, flush=True)
            publish("assistant", reply)
            active_until = max(active_until, time.time() + 15)
            speak(reply, speaking)
            continue

        context = ""
        if any(w in body for w in DATA_WORDS):
            context = live_context()
        reply = answer(body, context)
        print("reply:", reply, flush=True)
        publish("assistant", reply)
        # keep the session alive a beat longer than the answer duration
        active_until = max(active_until, time.time() + 15)
        speak(reply, speaking)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass

