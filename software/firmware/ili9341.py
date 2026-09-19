from machine import Pin, SPI
import time


def rgb(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


class ILI9341:
    def __init__(self, spi, dc, cs, rst=None, bl=None, width=240, height=320, bgr=True, rotation=0):
        self.spi = spi
        self.dc = dc
        self.cs = cs
        self.rst = rst
        self.bl = bl
        self.width = width
        self.height = height
        dc.init(Pin.OUT)
        cs.init(Pin.OUT)
        cs.value(1)
        if rst is not None:
            rst.init(Pin.OUT)
        if bl is not None:
            bl.init(Pin.OUT)
            bl.value(1)
        madctl = (0x08 if bgr else 0x00) | (rotation & 0x3F)
        self._madctl = madctl
        self.reset()
        self._init_display(madctl)
        self._window(0, 0, width - 1, height - 1)
        self.fill(0x0000)

    def reset(self):
        if self.rst:
            self.rst.value(1)
            time.sleep_ms(5)
            self.rst.value(0)
            time.sleep_ms(20)
            self.rst.value(1)
            time.sleep_ms(150)

    def _cmd(self, c, data=b''):
        self.cs.value(0)
        self.dc.value(0)
        self.spi.write(bytes([c]))
        if data:
            self.dc.value(1)
            self.spi.write(data)
        self.cs.value(1)

    def _data(self, d):
        self.cs.value(0)
        self.dc.value(1)
        self.spi.write(d)
        self.cs.value(1)

    def _init_display(self, madctl):
        self._cmd(0xC0, b'\x23\x15')
        self._cmd(0xC1, b'\x10')
        self._cmd(0xC5, b'\x3E\x28')
        self._cmd(0xC7, b'\x86')
        self._cmd(0x36, bytes([madctl]))
        self._cmd(0x3A, b'\x55')
        self._cmd(0xB1, b'\x00\x18')
        self._cmd(0xB6, b'\x08\x82\x27')
        self._cmd(0xF2, b'\x00')
        self._cmd(0x26, b'\x01')
        self._cmd(0xE0, b'\x0F\x31\x2B\x0C\x0E\x08\x4E\xF1\x37\x07\x10\x03\x0E\x09\x00')
        self._cmd(0xE1, b'\x00\x0E\x14\x03\x11\x07\x31\xC1\x48\x08\x0F\x0C\x31\x36\x0F')
        self._cmd(0x11)
        time.sleep_ms(120)
        self._cmd(0x29)
        time.sleep_ms(50)

    def _window(self, x0, y0, x1, y1):
        self._cmd(0x2A, bytes([x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF]))
        self._cmd(0x2B, bytes([y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF]))
        self._cmd(0x2C)

    def pixel(self, x, y, color):
        if 0 <= x < self.width and 0 <= y < self.height:
            self._window(x, y, x, y)
            self._data(bytes([color >> 8, color & 0xFF]))

    def fill(self, color):
        self._window(0, 0, self.width - 1, self.height - 1)
        row = bytes([color >> 8, color & 0xFF]) * self.width
        for y in range(self.height):
            self._data(row)

    def fill_rect(self, x, y, w, h, color):
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.width - 1, x + w - 1)
        y1 = min(self.height - 1, y + h - 1)
        if x1 < x0 or y1 < y0:
            return
        row = bytes([color >> 8, color & 0xFF]) * (x1 - x0 + 1)
        self._window(x0, y0, x1, y1)
        for _ in range(y0, y1 + 1):
            self._data(row)

    def rect(self, x, y, w, h, color):
        self.fill_rect(x, y, w, 1, color)
        self.fill_rect(x, y + h - 1, w, 1, color)
        self.fill_rect(x, y, 1, h, color)
        self.fill_rect(x + w - 1, y, 1, h, color)

    def hline(self, x, y, w, color):
        self.fill_rect(x, y, w, 1, color)

    def vline(self, x, y, h, color):
        self.fill_rect(x, y, 1, h, color)

    def ellipse(self, cx, cy, rx, ry, color):
        x = 0
        y = ry
        rx2 = rx * rx
        ry2 = ry * ry
        two_rx2 = 2 * rx2
        two_ry2 = 2 * ry2
        px = 0
        py = two_rx2 * y
        err = -rx2 * ry * 4 + ry2 + two_rx2
        while px * ry2 < py:
            self.pixel(cx + x, cy - y, color)
            self.pixel(cx - x, cy - y, color)
            self.pixel(cx + x, cy + y, color)
            self.pixel(cx - x, cy + y, color)
            if err >= 0:
                px = py - two_rx2 * y
                y -= 1
                py -= two_rx2
                err += rx2 * (1 - 2 * y) + py + px
            x += 1
            py -= two_ry2
            err += ry2 + py

    def canvas(self):
        return bytearray(self.width * self.height * 2)

    def blit_canvas(self, canvas, x0=0, y0=0, x1=None, y1=None):
        if x1 is None:
            x1 = self.width
        if y1 is None:
            y1 = self.height
        x1 = min(x1, self.width)
        y1 = min(y1, self.height)
        stride = self.width * 2
        for y in range(y0, y1):
            start = y * stride
            self._window(x0, y, x1 - 1, y)
            self._data(canvas[start + x0 * 2: start + x1 * 2])