# vicore

OBDLink MX+ evidence recorder. No language model.

Simulated sessions:

```bash
cd /home/chris/vehicle-intelligence
python3 -m vicore load-all-fixtures --db data/demo.sqlite
python3 -m vicore status --db data/demo.sqlite
python3 -m vicore serve --db data/demo.sqlite --port 8765
```

Real MX+ (not run until the adapter is paired and bound):

```bash
cd /home/chris/vehicle-intelligence
python3 -m vicore hardware-check --db data/vicore.sqlite
sudo rfcomm bind 0 <MAC> 1
sudo chgrp plugdev /dev/rfcomm0
sudo chmod 660 /dev/rfcomm0
python3 -m vicore live --device /dev/rfcomm0 --db data/vicore.sqlite --serve-port 8765
```

Replay a stored session through state, trust, events, and experiments:

```bash
python3 -m vicore replay --session <session_id> --db data/vicore.sqlite
```
