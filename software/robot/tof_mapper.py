"""
tof_mapper.py — Layer 2 occupancy mapper for sipher

Consumes `dashboard_tick` payloads produced by the Pico firmware and builds a
2D occupancy grid from the single forward VL53L0X ToF sensor + MPU6050 heading.

Data flow (per docs/ARCHITECTURE.md layer boundaries):
    firmware tick -> pico_bridge (Layer 2, owns serial) -> TofMapper.feed()
    dashboard     -> command_endpoint (:8888) -> bridge GET /map -> TofMapper.state()

Pose model
    heading : MPU6050 gyro-z integrated in firmware -> tick["yaw_deg"] (deg, 0..360,
              0 = robot heading at boot, increasing counter-clockwise)
    x, y    : GPS lat/lon converted to metres relative to the first fix when a fix
              exists (`pose_source = "gps"`), otherwise held at the origin
              (`pose_source = "origin"`).  Without GPS there is no odometry, so the
              map is only geometrically correct while the robot rotates in place.

World frame: x = east, y = north, cell (0,0) at the origin, +cell = 0.05 m.
"""

import base64
import json
import math
import threading
import time

# --- tunables ---------------------------------------------------------------
CELL_M = 0.05                      # metres per cell
GRID = 241                         # 241 x 241 -> 12.05 m x 12.05 m, odd => centred
CX0 = GRID // 2                    # cell index of world (0, 0)
CY0 = GRID // 2
TOF_MIN_MM = 40                    # below this the ranging is garbage
TOF_MAX_MM = 2000                  # VL53L0X practical max; beyond this = "clear"
TOF_CLEAR_MM = 2500                # ray length used when clearing without a hit
SENSOR_YAW_OFFSET = 0.0            # ToF mounting yaw relative to robot forward
GPS_M_LAT = 110540.0               # metres per degree latitude
RAYS_KEPT = 40                     # recent rays returned for the live display

UNKNOWN, FREE, OCCUPIED = 0, 1, 2


class TofMapper:
    def __init__(self, cell=CELL_M, grid=GRID):
        self._lock = threading.Lock()
        self.cell = float(cell)
        self.grid_n = int(grid)
        self.cx0 = self.grid_n // 2
        self.cy0 = self.grid_n // 2
        self.grid = bytearray(self.grid_n * self.grid_n)
        self.running = False
        self.rev = 0
        self.samples = 0
        self.hits = 0
        self.frees = 0
        self.dropped = 0
        self.last = None            # last accepted tick, summary only
        self.rays = []
        self.pose = {"x": 0.0, "y": 0.0, "yaw_deg": 0.0, "source": "origin"}
        self._gps_home = None
        self._moving = False
        self._still_count = 0

    # -- control -------------------------------------------------------------
    def start(self, interval_ms=None):
        with self._lock:
            self.running = True
        return {"mapping": True, "interval_ms": interval_ms}

    def stop(self):
        with self._lock:
            self.running = False
        return {"mapping": False}

    def reset(self):
        with self._lock:
            self.grid = bytearray(self.grid_n * self.grid_n)
            self.rev += 1
            self.samples = 0
            self.hits = 0
            self.frees = 0
            self.dropped = 0
            self.rays = []
            self.pose = {"x": 0.0, "y": 0.0, "yaw_deg": 0.0, "source": "origin"}
            self._gps_home = None
        return {"mapping": self.is_running(), "reset": True}

    def is_running(self):
        with self._lock:
            return self.running

    # -- indexing ------------------------------------------------------------
    def _idx(self, cx, cy):
        return cy * self.grid_n + cx

    def _in_bounds(self, cx, cy):
        return 0 <= cx < self.grid_n and 0 <= cy < self.grid_n

    def _world_to_cell(self, x, y):
        return (int(round(x / self.cell)) + self.cx0,
                int(round(y / self.cell)) + self.cy0)

    def _cell_to_world(self, cx, cy):
        return ((cx - self.cx0) * self.cell, (cy - self.cy0) * self.cell)

    # -- ray marking ---------------------------------------------------------
    def _ray(self, x0, y0, x1, y1, mark_end):
        """Bresenham from robot cell to hit cell; returns (cells_set, end_occupied)."""
        cx0, cy0 = self._world_to_cell(x0, y0)
        cx1, cy1 = self._world_to_cell(x1, y1)
        dx = abs(cx1 - cx0)
        dy = abs(cy1 - cy0)
        sx = 1 if cx0 < cx1 else -1
        sy = 1 if cy0 < cy1 else -1
        err = dx - dy
        cx, cy = cx0, cy0
        set_free = 0
        set_occ = 0
        while True:
            last = (cx == cx1 and cy == cy1)
            if self._in_bounds(cx, cy):
                i = self._idx(cx, cy)
                if last and mark_end:
                    if self.grid[i] != OCCUPIED:
                        self.grid[i] = OCCUPIED
                        set_occ += 1
                else:
                    if self.grid[i] != FREE:
                        self.grid[i] = FREE
                        set_free += 1
            if last:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                cx += sx
            if e2 < dx:
                err += dx
                cy += sy
        return set_free, set_occ

    # -- pose ----------------------------------------------------------------
    def _update_pose(self, tick):
        yaw = tick.get("yaw_deg")
        x, y, source = 0.0, 0.0, "origin"
        gps = tick.get("gps") or {}
        if gps.get("fix") and gps.get("lat") is not None and gps.get("lon") is not None:
            lat = float(gps["lat"])
            lon = float(gps["lon"])
            if self._gps_home is None:
                self._gps_home = (lat, lon)
            dlat = lat - self._gps_home[0]
            dlon = lon - self._gps_home[1]
            dlon_m = dlon * GPS_M_LAT * math.cos(math.radians(self._gps_home[0]))
            x = dlon_m
            y = dlat * GPS_M_LAT
            source = "gps"
        self.pose = {"x": round(x, 3), "y": round(y, 3),
                     "yaw_deg": float(yaw if yaw is not None else 0.0),
                     "source": source}
        return x, y

    def _detect_motion(self, tick):
        """Cheap 'is it moving' flag: IMU accel magnitude deviating from 1 g."""
        mpu = tick.get("mpu")
        moving = self._moving
        if mpu and len(mpu) >= 3:
            ax, ay, az = mpu[0], mpu[1], mpu[2]
            mag = math.sqrt(ax * ax + ay * ay + az * az) / 16384.0
            if abs(mag - 1.0) > 0.06:
                self._still_count = 0
                moving = True
            else:
                self._still_count += 1
                if self._still_count > 5:
                    moving = False
        self._moving = moving
        return moving

    # -- ingest --------------------------------------------------------------
    def feed(self, tick):
        """Called by the bridge for every Pico tick. Safe to call when stopped."""
        if not tick or not isinstance(tick, dict):
            return
        with self._lock:
            if not self.running:
                return
            yaw = tick.get("yaw_deg")
            dist = tick.get("vl53_mm")
            if yaw is None:
                self.dropped += 1
                return
            x, y = self._update_pose(tick)
            moving = self._detect_motion(tick)
            self.samples += 1

            # heading in world frame: yaw 0 = +X, increasing counter-clockwise
            ang = math.radians(yaw + SENSOR_YAW_OFFSET)
            ux, uy = math.cos(ang), math.sin(ang)

            if dist is None or dist < TOF_MIN_MM:
                self.last = {"yaw_deg": yaw, "dist_mm": dist, "ok": False,
                             "moving": moving}
                return

            # reached distance in metres (clamped so rays stay on the grid)
            reach = min(float(dist), TOF_CLEAR_MM) / 1000.0
            mark_end = TOF_MIN_MM <= dist < TOF_MAX_MM
            hx = x + ux * reach
            hy = y + uy * reach
            set_free, set_occ = self._ray(x, y, hx, hy, mark_end)
            self.frees += set_free
            self.hits += set_occ
            self.rev += 1

            self.rays.append({"x": round(hx, 3), "y": round(hy, 3),
                              "d_mm": int(dist), "yaw": round(yaw, 1),
                              "gx": x, "gy": y})
            if len(self.rays) > RAYS_KEPT:
                self.rays = self.rays[-RAYS_KEPT:]
            self.last = {"yaw_deg": round(yaw, 2), "dist_mm": int(dist),
                         "ok": True, "moving": moving,
                         "free": set_free, "occ": set_occ}

    # -- export --------------------------------------------------------------
    def state(self, include_grid=True):
        with self._lock:
            n = self.grid_n
            out = {
                "mapping": self.running,
                "rev": self.rev,
                "samples": self.samples,
                "hits": self.hits,
                "free_cells": self.frees,
                "dropped": self.dropped,
                "cell_m": self.cell,
                "grid": {"w": n, "h": n, "ox": self._world_to_cell(0, 0)[0],
                         "oy": self._world_to_cell(0, 0)[1]},
                "bounds": {
                    "x0": round(-self.cx0 * self.cell, 3),
                    "y0": round(-self.cy0 * self.cell, 3),
                    "x1": round((n - 1 - self.cx0) * self.cell, 3),
                    "y1": round((n - 1 - self.cy0) * self.cell, 3),
                },
                "pose": dict(self.pose),
                "moving": self._moving,
                "last": self.last,
                "rays": list(self.rays),
                "ts": time.time(),
            }
            if include_grid:
                out["data_b64"] = base64.b64encode(bytes(self.grid)).decode("ascii")
        return out


# ---------------------------------------------------------------------------
# Helper used by the bridge / endpoint: control the Pico tick rate around a sweep
# ---------------------------------------------------------------------------
MAP_INTERVAL_MS = 250
IDLE_INTERVAL_MS = 1000


def state_json(mapper, include_grid=True):
    return json.dumps(mapper.state(include_grid=include_grid))
