"""Adapter transports. Serial is the MX+ path. Scripted is for tests."""

from __future__ import annotations

import os
import select
import termios
import time
from typing import Callable


class TransportError(RuntimeError):
    pass


class AdapterTimeout(TimeoutError):
    pass


class Transport:
    def open(self) -> None:
        raise NotImplementedError

    def exchange(self, command: str, timeout: float) -> str:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError


class SerialTransport(Transport):
    """POSIX serial or rfcomm node. OBDLink MX+ SPP is 115200 8N1."""

    def __init__(self, path: str, baud: int = 115200):
        self.path = path
        self.baud = baud
        self.fd: int | None = None

    def open(self) -> None:
        if not os.path.exists(self.path):
            raise TransportError(f"device not present: {self.path}")
        fd = os.open(self.path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self._configure(fd)
        self.fd = fd

    def _configure(self, fd: int) -> None:
        attrs = termios.tcgetattr(fd)
        iflag, oflag, cflag, lflag, ispeed, ospeed, cc = attrs
        iflag &= ~(
            termios.IGNBRK
            | termios.BRKINT
            | termios.PARMRK
            | termios.ISTRIP
            | termios.INLCR
            | termios.IGNCR
            | termios.ICRNL
            | termios.IXON
        )
        oflag &= ~termios.OPOST
        lflag &= ~(termios.ECHO | termios.ECHONL | termios.ICANON | termios.ISIG | termios.IEXTEN)
        cflag &= ~(termios.CSIZE | termios.PARENB)
        cflag |= termios.CS8 | termios.CREAD | termios.CLOCAL
        # ELM/STN over rfcomm does not use RTS/CTS. Leaving CRTSCTS set stalls writes.
        if hasattr(termios, "CRTSCTS"):
            cflag &= ~termios.CRTSCTS
        baud = getattr(termios, f"B{self.baud}", None)
        if baud is None:
            raise TransportError(f"unsupported baud {self.baud}")
        cc[termios.VMIN] = 0
        cc[termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, [iflag, oflag, cflag, lflag, baud, baud, cc])
        termios.tcflush(fd, termios.TCIOFLUSH)

    def exchange(self, command: str, timeout: float) -> str:
        if self.fd is None:
            raise TransportError("serial transport is not open")
        payload = (command + "\r").encode("ascii")
        self._write_all(payload)
        return self._read_until_prompt(timeout)

    def _write_all(self, payload: bytes) -> None:
        """Write until the bytes are queued.

        poll(POLLOUT) on a pty slave can stay clear while write() still
        succeeds. Try the write, and wait only after BlockingIOError.
        """
        assert self.fd is not None
        view = payload
        deadline = time.monotonic() + 2.0
        while view:
            try:
                n = os.write(self.fd, view)
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AdapterTimeout("write timeout")
                select.select([], [self.fd], [], min(0.05, remaining))
                continue
            if n <= 0:
                raise TransportError("adapter write failed")
            view = view[n:]

    def _read_until_prompt(self, timeout: float) -> str:
        assert self.fd is not None
        chunks = bytearray()
        remaining = timeout
        while remaining > 0:
            ready, _, _ = select.select([self.fd], [], [], min(remaining, 0.2))
            if not ready:
                remaining -= 0.2
                continue
            try:
                data = os.read(self.fd, 4096)
            except BlockingIOError:
                continue
            if not data:
                raise TransportError("adapter closed the port")
            chunks.extend(data)
            if b">" in chunks:
                text = chunks.decode("ascii", errors="replace")
                body, _, _rest = text.partition(">")
                return _clean_body(body)
        raise AdapterTimeout(f"no prompt within {timeout}s")

    def close(self) -> None:
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def _clean_body(body: str) -> str:
    lines = []
    for line in body.replace("\r", "\n").split("\n"):
        stripped = line.strip()
        if stripped:
            lines.append(stripped)
    return "\n".join(lines)


class ScriptedTransport(Transport):
    """Handler returns (body, delay_seconds) or raises AdapterTimeout / TransportError."""

    def __init__(self, handler: Callable[[str], tuple[str, float]], clock):
        self.handler = handler
        self.clock = clock
        self.sent: list[str] = []
        self.opened = False

    def open(self) -> None:
        self.opened = True

    def exchange(self, command: str, timeout: float) -> str:
        if not self.opened:
            raise TransportError("scripted transport is not open")
        self.sent.append(command.strip())
        try:
            body, delay = self.handler(command.strip())
        except AdapterTimeout:
            self.clock.sleep(timeout)
            raise
        if delay > timeout:
            self.clock.sleep(timeout)
            raise AdapterTimeout(command)
        self.clock.sleep(delay)
        return body

    def close(self) -> None:
        self.opened = False
