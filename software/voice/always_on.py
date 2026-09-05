#!/usr/bin/env python3
# always_on.py — sipher Pi 4 always-listening for "rotate" / "stop" via USB mic hw:3,0
# Free, offline: arecord + faster-whisper tiny + piper/espeak
# Run: python3 always_on.py  (systemd on boot)
import subprocess, time, pathlib, json, os, sys
MIC="plughw:CARD=Device,DEV=0"
TMP="/tmp/voice.wav"
USE_GROQ = bool(os.getenv("GROQ_API_KEY"))
# try faster-whisper, fallback to Vosk/arecord energy
try:
    from faster_whisper import WhisperModel
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    print("faster-whisper tiny ready", flush=True)
except Exception as e:
    model=None
    print("whisper not ready",e, flush=True)

def record():
    subprocess.run(["arecord","-D",MIC,"-f","S16_LE","-r","16000","-c","1","-d","2","-t","wav",TMP], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return TMP

def transcribe(path):
    if USE_GROQ:
        # Groq Whisper via API (needs GROQ_API_KEY)
        try:
            from groq import Groq
            client=Groq()
            with open(path,"rb") as f:
                tr=client.audio.transcriptions.create(file=(path,f.read()), model="whisper-large-v3", language="en", response_format="text")
            return tr.lower() if isinstance(tr,str) else str(tr).lower()
        except Exception as e:
            print("groq err",e)
    if model:
        segs,_ = model.transcribe(path, language="en")
        return " ".join(s.text for s in segs).lower()
    # fallback energy check
    return ""

def tts(text):
    try:
        subprocess.run(["espeak", text], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: print("TTS:",text)

def servo(cmd):
    if "rotate" in cmd:
        subprocess.Popen(["nohup","/home/sipher/.local/bin/mpremote","connect","/dev/ttyACM0","run","/tmp/all_now.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tts("rotating")
        print("rotate triggered", flush=True)
    elif "stop" in cmd:
        subprocess.run(["pkill","-9","-f","mpremote"], stdout=subprocess.DEVNULL)
        subprocess.run(["/home/sipher/.local/bin/mpremote","connect","/dev/ttyACM0","exec","import machine; i2c=machine.I2C(1,sda=machine.Pin(2),scl=machine.Pin(3)); i2c.writeto_mem(0x40,0x00,bytes([16]))"], stdout=subprocess.DEVNULL)
        tts("stopped")
        print("stop triggered", flush=True)

print("always on — say rotate / stop", flush=True)
while True:
    record()
    # skip silence via file size / energy
    try:
        import wave
        with wave.open(TMP) as w:
            data=w.readframes(w.getnframes())
            # simple energy
            if max(data[::2])==0 and min(data[::2])==0:
                continue
    except: pass
    txt=transcribe(TMP)
    print("heard:",repr(txt), flush=True)
    if not txt: continue
    # calm backchannel filler while thinking already handled by tts above
    if "rotate" in txt or "motor" in txt or "servo" in txt:
        # hmm filler before action
        if "hmm" not in txt: tts("hmm okay")
        servo("rotate")
    elif "stop" in txt:
        tts("okay got it")
        servo("stop")
