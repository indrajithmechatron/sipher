"""main.py — boot coordinator for Pico 2 W
Sequence: boot logo → sleep 4s → run pico_main main loop.
"""
import boot_logo

try:
    boot_logo.show()
except Exception as e:
    print("boot logo error:", e)

import time
time.sleep_ms(4000)

import pico_main
pico_main.main()
