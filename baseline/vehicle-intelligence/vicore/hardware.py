"""Read-only check for an OBDLink MX+ serial node. Does not scan or pair."""

from __future__ import annotations

import os
import shutil
from pathlib import Path


def hardware_status() -> dict:
    nodes = sorted(str(path) for path in Path("/dev").glob("rfcomm*"))
    nodes += sorted(str(path) for path in Path("/dev").glob("ttyUSB*"))
    nodes += sorted(str(path) for path in Path("/dev").glob("ttyACM*"))
    present = [node for node in nodes if os.path.exists(node)]
    return {
        "hardware_tested": False,
        "adapter_connected": bool(present),
        "device_nodes": present,
        "rfcomm": shutil.which("rfcomm"),
        "bluetoothctl": shutil.which("bluetoothctl"),
        "dialout_note": "rfcomm nodes are often group dialout. This user must be able to open the node.",
    }


def hardware_instructions(db_path: str) -> str:
    return "\n".join(
        [
            "The MX+ is not connected to this process.",
            "1. Ignition ON. Plug the OBDLink MX+ into the vehicle.",
            "2. Pair it (PIN is usually 1234):",
            "   bluetoothctl",
            "   power on",
            "   pairable on",
            "   scan on",
            "   pair <MAC>",
            "   trust <MAC>",
            "   quit",
            "3. Bind the serial port:",
            "   sudo rfcomm bind 0 <MAC> 1",
            "   sudo chgrp plugdev /dev/rfcomm0",
            "   sudo chmod 660 /dev/rfcomm0",
            "4. Run the live session:",
            f"   cd /home/chris/vehicle-intelligence && python3 -m vicore live --device /dev/rfcomm0 --db {db_path} --serve-port 8765",
            "5. Open http://127.0.0.1:8765",
            "The IT JUST DID IT button on that page is the user trigger.",
        ]
    )
