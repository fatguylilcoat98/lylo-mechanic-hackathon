"""Optional IPv4 preference for outbound calls (NHTSA, Meta).

LYLO_HACK_FORCE_IPV4=1: when a host has IPv4 addresses, only those are tried.
Fixes hosts with a broken IPv6 route, where each outbound call stalls 12-40 s
before falling back. Unset or 0 keeps the old behavior exactly (nothing patched).
"""
import os
import socket

_orig = socket.getaddrinfo


def _v4_first(*args, **kwargs):
    res = _orig(*args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 or res


def enabled():
    return os.environ.get("LYLO_HACK_FORCE_IPV4") == "1"


def apply():
    """Patch once if enabled. Returns True when the IPv4 preference is active."""
    if not enabled():
        return False
    if socket.getaddrinfo is not _v4_first:
        socket.getaddrinfo = _v4_first
    return True


def reset():
    socket.getaddrinfo = _orig
