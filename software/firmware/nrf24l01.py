"""
nRF24L01+ PA+LNA driver for MicroPython (Pico 2 W).

Shares SPI0 with ILI9341 TFT. Uses hardware CS pins for bus arbitration:
  SPI0: SCK=GP18, MOSI=GP19, MISO=GP16
  nRF:  CSN=GP20, CE=GP21, IRQ=GP22 (optional)
  TFT:  CS=GP17, DC=GP4, RST=GP5

Usage:
    from nrf24l01 import NRF24L01
    nrf = NRF24L01(spi, cs=20, ce=21)
    nrf.open_tx_pipe(b"\xe1\xf0\xf0\xf0\xf0")
    nrf.start_listening()
    if nrf.any():
        print(nrf.recv())
"""

import time
from machine import Pin, SPI


# nRF24L01+ registers
CONFIG = 0x00
EN_AA = 0x01
EN_RXADDR = 0x02
SETUP_AW = 0x03
SETUP_RETR = 0x04
RF_CH = 0x06
RF_SETUP = 0x07
STATUS = 0x07
OBSERVE_TX = 0x08
RX_ADDR_P0 = 0x0A
RX_ADDR_P1 = 0x0B
TX_ADDR = 0x10
RX_PW_P0 = 0x11
RX_PW_P1 = 0x12
FIFO_STATUS = 0x17
DYNPD = 0x1C
FEATURE = 0x1D

# CONFIG bits
PRIM_RX = 0x01
PWR_UP = 0x02
CRCO = 0x04
EN_CRC = 0x08

# STATUS bits
RX_DR = 0x40
TX_DS = 0x20
MAX_RT = 0x10

# RF_SETUP bits
RF_DR_HIGH = 0x08
RF_DR_250K = 0x20
RF_PWR_0 = 0x00
RF_PWR_1 = 0x06
RF_PWR_MAX = 0x06

# FIFO_STATUS
RX_EMPTY = 0x01


class NRF24L01:
    def __init__(self, spi, cs=20, ce=21, irq=None, channel=76, data_rate=250000, pa_level="MAX"):
        """
        Args:
            spi:      SPI instance (shared with TFT is fine — hardware CS handles arbitration)
            cs:       CSN pin number (active low, chip select)
            ce:       CE pin number (enable TX/RX)
            irq:      IRQ pin number (optional, active low on RX data / TX done / max retransmits)
            channel:  RF channel (0-125), default 76 = 2.476 GHz
            data_rate: 250000, 1000000, or 2000000 bps
            pa_level: "MIN", "LOW", "HIGH", "MAX"
        """
        self._spi = spi
        self._cs = Pin(cs, Pin.OUT, value=1)
        self._ce = Pin(ce, Pin.OUT, value=0)
        self._irq = Pin(irq, Pin.IN, Pin.PULL_UP) if irq is not None else None

        self._channel = channel
        self._data_rate = data_rate
        self._pa_level = pa_level
        self._pipe0_rx_addr = None
        self._tx_pipe = None

        self._init()

    def _write_reg(self, reg, data):
        if isinstance(data, int):
            data = bytes([data])
        self._cs(0)
        self._spi.write(bytes([0x20 | reg]))
        self._spi.write(data)
        self._cs(1)

    def _read_reg(self, reg, length=1):
        self._cs(0)
        self._spi.write(bytes([reg & 0x1F]))
        data = self._spi.read(length)
        self._cs(1)
        return data[0] if length == 1 else data

    def _flush_tx(self):
        self._cs(0)
        self._spi.write(bytes([0xE1]))
        self._cs(1)

    def _flush_rx(self):
        self._cs(0)
        self._spi.write(bytes([0xE2]))
        self._cs(1)

    def _get_status(self):
        self._cs(0)
        status = self._spi.read(1)[0]
        self._cs(1)
        return status

    def _clear_irq(self, flags=RX_DR | TX_DS | MAX_RT):
        self._write_reg(STATUS, flags)

    def _init(self):
        # Power down first
        self._write_reg(CONFIG, 0x00)
        time.sleep_ms(5)

        # Flush FIFOs
        self._flush_tx()
        self._flush_rx()

        # Auto-ack on all pipes
        self._write_reg(EN_AA, 0x3F)

        # Enable RX addresses: pipe 0 + pipe 1
        self._write_reg(EN_RXADDR, 0x03)

        # 5-byte address width
        self._write_reg(SETUP_AW, 0x03)

        # Auto-retransmit: 500us delay, 15 retries
        self._write_reg(SETUP_RETR, 0x1A)

        # RF channel
        self._write_reg(RF_CH, self._channel & 0x7F)

        # RF setup: data rate + PA level
        rf_setup = 0x00
        if self._data_rate == 250000:
            rf_setup |= RF_DR_250K
        elif self._data_rate == 2000000:
            rf_setup |= RF_DR_HIGH
        # else 1Mbps = 0x00

        pa_map = {"MIN": 0x00, "LOW": 0x02, "HIGH": 0x04, "MAX": 0x06}
        rf_setup |= pa_map.get(self._pa_level, RF_PWR_MAX)
        self._write_reg(RF_SETUP, rf_setup)

        # Dynamic payload length on pipes 0 and 1
        self._write_reg(FEATURE, 0x06)       # EN_DPL + EN_DYN_ACK
        self._write_reg(DYNPD, 0x03)         # DPL_P0 + DPL_P1

        # Clear all IRQ flags
        self._clear_irq()

        # Power up in RX mode
        self._write_reg(CONFIG, EN_CRC | PWR_UP | PRIM_RX)

        time.sleep_ms(5)

    def open_tx_pipe(self, address):
        """Set TX address (5 bytes). Also sets pipe 0 RX address for auto-ack."""
        self._pipe0_rx_addr = address
        self._write_reg(TX_ADDR, address)
        self._write_reg(RX_ADDR_P0, address)

    def open_rx_pipe(self, pipe_num, address):
        """Set RX address for pipe 1-5 (pipe 0 is set by open_tx_pipe for auto-ack)."""
        assert 1 <= pipe_num <= 5
        reg = RX_ADDR_P1 + (pipe_num - 1)
        self._write_reg(reg, address)
        # Enable this pipe
        en = self._read_reg(EN_RXADDR)
        self._write_reg(EN_RXADDR, en | (1 << pipe_num))

    def start_listening(self):
        """Switch to RX mode."""
        self._clear_irq()
        self._flush_rx()
        self._write_reg(CONFIG, EN_CRC | PWR_UP | PRIM_RX)
        self._ce(1)
        time.sleep_ms(1)

    def stop_listening(self):
        """Switch out of RX mode (CE low, power down briefly)."""
        self._ce(0)
        time.sleep_us(130)

    def send(self, data, timeout_ms=200):
        """
        Send data (up to 32 bytes). Returns True on success, False on timeout.
        Automatically switches to TX mode and back to RX if previously listening.
        """
        was_listening = self._read_reg(CONFIG) & PRIM_RX

        # Switch to TX
        self._ce(0)
        self._write_reg(CONFIG, EN_CRC | PWR_UP)
        time.sleep_us(130)

        # Flush and load payload
        self._flush_tx()
        self._cs(0)
        self._spi.write(bytes([0xA0]))  # W_TX_PAYLOAD
        self._spi.write(data[:32])
        self._cs(1)

        # Pulse CE to start transmission
        self._ce(1)
        time.sleep_us(10)
        self._ce(0)

        # Wait for TX_DS or MAX_RT
        start = time.ticks_ms()
        while time.ticks_diff(time.ticks_ms(), start) < timeout_ms:
            status = self._get_status()
            if status & TX_DS:
                self._clear_irq(TX_DS)
                if was_listening:
                    self.start_listening()
                return True
            if status & MAX_RT:
                self._clear_irq(MAX_RT)
                self._flush_tx()
                if was_listening:
                    self.start_listening()
                return False
            time.sleep_ms(1)

        # Timeout
        self._flush_tx()
        self._clear_irq(MAX_RT | TX_DS | RX_DR)
        if was_listening:
            self.start_listening()
        return False

    def recv(self):
        """Read one payload from RX FIFO. Returns bytes or None if empty."""
        status = self._get_status()
        if status & RX_DR:
            self._clear_irq(RX_DR)

            # Read payload width
            self._cs(0)
            self._spi.write(bytes([0x60]))  # R_RX_PL_WID
            width = self._spi.read(1)[0]
            self._cs(1)

            if width > 32:
                self._flush_rx()
                return None

            # Read payload
            self._cs(0)
            self._spi.write(bytes([0x61]))  # R_RX_PAYLOAD
            data = self._spi.read(width)
            self._cs(1)
            return data

        return None

    def any(self):
        """Check if there is data in the RX FIFO."""
        fifo = self._read_reg(FIFO_STATUS)
        return not (fifo & RX_EMPTY)

    def tx_done(self):
        """Check if last TX completed (TX_DS flag)."""
        status = self._get_status()
        if status & TX_DS:
            self._clear_irq(TX_DS)
            return True
        if status & MAX_RT:
            self._clear_irq(MAX_RT)
            self._flush_tx()
        return False

    def power_down(self):
        self._ce(0)
        cfg = self._read_reg(CONFIG)
        self._write_reg(CONFIG, cfg & ~PWR_UP)

    def power_up(self):
        cfg = self._read_reg(CONFIG)
        self._write_reg(CONFIG, cfg | PWR_UP)
        time.sleep_ms(5)

    def channel(self, ch=None):
        """Get or set RF channel (0-125)."""
        if ch is not None:
            self._channel = ch
            self._write_reg(RF_CH, ch & 0x7F)
        return self._channel

    def rssi(self):
        """Read observed TX count (useful for link quality)."""
        return self._read_reg(OBSERVE_TX)

    def status_str(self):
        """Return human-readable status string."""
        cfg = self._read_reg(CONFIG)
        fifo = self._read_reg(FIFO_STATUS)
        status = self._get_status()
        mode = "RX" if cfg & PRIM_RX else "TX"
        pwr = "ON" if cfg & PWR_UP else "OFF"
        rx_empty = "empty" if fifo & RX_EMPTY else "data"
        irq_flags = []
        if status & RX_DR: irq_flags.append("RX_DR")
        if status & TX_DS: irq_flags.append("TX_DS")
        if status & MAX_RT: irq_flags.append("MAX_RT")
        return f"nRF24L01+ mode={mode} pwr={pwr} ch={self._channel} fifo={rx_empty} irq={irq_flags or 'none'}"
