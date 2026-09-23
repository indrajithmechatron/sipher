# Standalone TFT image display — run via mpremote (bypasses main loop)
# mpremote connect /dev/sipher-pico run show_image_now.py
import machine, time

CS = machine.Pin(17, machine.Pin.OUT, value=1)
RST = machine.Pin(5, machine.Pin.OUT, value=1)
DC = machine.Pin(4, machine.Pin.OUT, value=0)
spi = machine.SPI(0, baudrate=40_000_000, polarity=0, phase=0,
                  sck=machine.Pin(18), mosi=machine.Pin(19), miso=machine.Pin(16))

def cmd(c):
    CS.value(0); DC.value(0); spi.write(bytes([c & 0xFF])); CS.value(1)

def data(d):
    CS.value(0); DC.value(1); spi.write(d); CS.value(1)

# ILI9341 init + landscape
RST.value(0); time.sleep_ms(10)
RST.value(1); time.sleep_ms(10)
cmd(0x01); time.sleep_ms(150)
cmd(0x28)
cmd(0x3A); data(b'\x55')
cmd(0x36); data(b'\x20')
cmd(0x11); time.sleep_ms(120)
cmd(0x29); time.sleep_ms(50)

# Full-screen window 320x240
cmd(0x2A); data(bytes([0x00, 0x00, 0x01, 0x3F]))
cmd(0x2B); data(bytes([0x00, 0x00, 0x00, 0xEF]))
cmd(0x2C)

CS.value(0); DC.value(1)
with open("anime.rgb565", "rb") as f:
    while True:
        chunk = f.read(4096)
        if not chunk:
            break
        spi.write(chunk)
CS.value(1)
print("SHOW_OK")
