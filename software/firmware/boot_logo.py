from machine import Pin, SPI
from ili9341 import ILI9341

PIN_SCK = 18
PIN_MOSI = 19
PIN_MISO = 16
PIN_CS = 17
PIN_DC = 4
PIN_RST = 5
PIN_BL = None
BGR_ORDER = True

SRC_W = 320
SRC_H = 240
DST_W = 240
DST_H = 320


def show():
    d = ILI9341(SPI(0, baudrate=24000000, polarity=0, phase=0,
                    sck=Pin(PIN_SCK), mosi=Pin(PIN_MOSI), miso=Pin(PIN_MISO)),
                dc=Pin(PIN_DC), cs=Pin(PIN_CS), rst=Pin(PIN_RST),
                bl=Pin(PIN_BL) if PIN_BL is not None else None,
                width=DST_W, height=DST_H, rotation=0x00, bgr=BGR_ORDER)
    with open('anime.rgb565', 'rb') as f:
        src = f.read()
    dst = bytearray(DST_W * DST_H * 2)
    for sy in range(SRC_H):
        srow = sy * SRC_W * 2
        for sx in range(SRC_W):
            si = srow + sx * 2
            dx = sy
            dy = DST_H - 1 - sx
            di = (dy * DST_W + dx) * 2
            dst[di] = src[si]
            dst[di + 1] = src[si + 1]
    d._window(0, 0, DST_W - 1, DST_H - 1)
    d._data(dst)
    return d