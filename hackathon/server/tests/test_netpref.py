import os
import socket
import unittest
from unittest import mock

from lylo_hack import netpref

V6 = (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 443, 0, 0))
V4 = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))


class NetPrefTest(unittest.TestCase):
    def tearDown(self):
        netpref.reset()

    def test_off_by_default_changes_nothing(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LYLO_HACK_FORCE_IPV4", None)
            before = socket.getaddrinfo
            self.assertFalse(netpref.apply())
            self.assertIs(socket.getaddrinfo, before)

    def test_on_keeps_only_ipv4_when_present(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_FORCE_IPV4": "1"}):
            with mock.patch.object(netpref, "_orig", return_value=[V6, V6, V4]):
                self.assertTrue(netpref.apply())
                self.assertEqual(socket.getaddrinfo("x", 443), [V4])

    def test_on_falls_back_to_ipv6_only_hosts(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_FORCE_IPV4": "1"}):
            with mock.patch.object(netpref, "_orig", return_value=[V6]):
                netpref.apply()
                self.assertEqual(socket.getaddrinfo("x", 443), [V6])

    def test_apply_twice_is_safe(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_FORCE_IPV4": "1"}):
            netpref.apply(); netpref.apply()
            self.assertIs(socket.getaddrinfo, netpref._v4_first)


if __name__ == "__main__":
    unittest.main()
