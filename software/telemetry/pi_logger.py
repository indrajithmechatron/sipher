#!/usr/bin/env python3
# pi_logger.py — sipher Pi 4 logs Pico JSON + USB mic level
# Run on sipher@192.168.1.35: python3 pi_logger.py
import serial, time, json, subprocess, pathlib
port="/dev/ttyACM0"; baud=115200
try:
    import serial
except: print("pip3 install pyserial"); raise
ser=serial.Serial(port, 115200, timeout=1)
log=pathlib.Path("/home/sipher/sipher.log")
print(f"Logging {port} → {log} (USB mic hw:3,0 also alive: arecord -D hw:3,0 -f S16_LE -r 16000)")
while True:
    l=ser.readline().decode(errors="ignore").strip()
    if l:
        print(l)
        log.open("a").write(l+"\n")
