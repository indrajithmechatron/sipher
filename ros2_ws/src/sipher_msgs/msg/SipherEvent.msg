# Discrete robot event (e-stop, admin unlock, device loss, ...).
std_msgs/Header header
string type       # e.g. "estop", "admin_unlock", "device_lost"
string level      # "info" | "warn" | "error"
string data       # optional JSON payload
