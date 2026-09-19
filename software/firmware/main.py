import boot_logo

try:
    boot_logo.show()
except Exception as e:
    print("boot logo error:", e)

import time

time.sleep_ms(4000)

import pico_main