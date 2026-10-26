"""Clocks so acquisition tests do not sleep in wall time."""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class SystemClock:
    def wall(self) -> float:
        return time.time()

    def mono(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        if seconds > 0:
            time.sleep(seconds)


@dataclass
class FakeClock:
    wall_s: float = 1_767_225_600.0
    mono_s: float = 0.0

    def wall(self) -> float:
        return self.wall_s

    def mono(self) -> float:
        return self.mono_s

    def sleep(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("negative sleep")
        self.wall_s += seconds
        self.mono_s += seconds

    def advance(self, seconds: float) -> None:
        self.sleep(seconds)
