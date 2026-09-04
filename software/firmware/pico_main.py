# pico_main.py — sipher Pico 2 W unified (MPU6050 + VL53LOX + INA219 + PCA9685 + GPS)
# I2C1 GP2 SDA GP3 SCL (MPU 0x68, VL53 0x29, PCA 0x40, INA 0x41)
# UART0 GP0 TX GP1 RX (GPS 9600)
# USB-CDC JSON lines → Pi sipher@192.168.1.35:/dev/ttyACM0
import machine, time, struct, sys
i2c = machine.I2C(1, sda=machine.Pin(2), scl=machine.Pin(3), freq=100000)
uart = machine.UART(0, baudrate=9600, tx=machine.Pin(0), rx=machine.Pin(1))
# wake MPU
try:
    i2c.writeto_mem(0x68, 0x6B, bytes([0]))
    time.sleep_ms(100)
except: pass
# PCA9685 init (prescale for 50Hz, sleep -> write)
try:
    i2c.writeto_mem(0x40, 0x00, bytes([0x10])); time.sleep_ms(5)
    i2c.writeto_mem(0x40, 0xFE, bytes([121])); # 50Hz
    i2c.writeto_mem(0x40, 0x00, bytes([0x80])); time.sleep_ms(5)
except: pass
def read_mpu():
    try:
        d=i2c.readfrom_mem(0x68, 0x3B, 14)
        ax,ay,az=struct.unpack(">hhh", d[0:6]); gx,gy,gz=struct.unpack(">hhh", d[8:14]); return ax,ay,az,gx,gy,gz
    except: return None
def read_vl53():
    try:
        # WHO_AMI check already done via scan; simple range would need VL53 driver
        # return raw distance via minimal read (needs init - placeholder)
        return i2c.readfrom_mem(0x29, 0xC0, 1)[0]
    except: return None
def read_ina():
    try:
        v=int.from_bytes(i2c.readfrom_mem(0x41, 0x02, 2), "big"); return v
    except: return None
def read_gps():
    try:
        if uart.any():
            l=uart.readline()
            if l: return l.decode().strip()
    except: pass
    return None
count=0
while True:
    mpu=read_mpu(); vl=read_vl53(); ina=read_ina(); gps=read_gps()
    # keep I2C scan occasionally
    scan=[hex(x) for x in i2c.scan()]
    print('{"t":%d,"scan":%s,"mpu":%s,"vl53":%s,"ina":%s,"gps":%s}' % (time.ticks_ms(), scan, mpu, vl, ina, repr(gps)))
    time.sleep(1)
    count+=1
