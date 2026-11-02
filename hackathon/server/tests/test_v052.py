"""v0.5.2: generic DTC titles (flag LYLO_HACK_DTC_TITLES) and the access-log flag. Synthetic data only."""
import importlib.util
import os

from lylo_hack import dtc_titles, live

HERE = os.path.dirname(os.path.abspath(__file__))


def _payload(code, desc=None):
    d = {"code": code, "status": "active"}
    if desc:
        d["description"] = desc
    return {"raw_dtcs": [d], "raw_pids": []}


def test_corrected_wording():
    assert dtc_titles.lookup("P0037")["title"] == "HO2S Heater Control Circuit Low (Bank 1 Sensor 2)"
    assert dtc_titles.lookup("p2241")["title"] == "O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)"


def test_coverage_all_systems():
    t = dtc_titles.titles()
    assert len(t) > 9000
    for c in ("P0420", "P0171", "P0300", "P2096", "U0100", "C0035", "B0001"):
        assert t.get(c), c


def test_unknown_degrades():
    assert "unknown code" in dtc_titles.describe("P0ZZZ")
    assert "manufacturer-specific" in dtc_titles.describe("P1ZZZ")
    assert dtc_titles.lookup(None)["known"] is False


def test_flag_off_leaves_description_none(monkeypatch):
    monkeypatch.delenv("LYLO_HACK_DTC_TITLES", raising=False)
    session, _, _ = live.build_session(_payload("P0037"))
    assert session.raw_dtcs[0].description is None


def test_flag_on_fills_only_missing(monkeypatch):
    monkeypatch.setenv("LYLO_HACK_DTC_TITLES", "1")
    session, _, _ = live.build_session(_payload("P2241"))
    assert "Bank 2 Sensor 1" in session.raw_dtcs[0].description
    session, _, _ = live.build_session(_payload("P0037", "from the phone"))
    assert session.raw_dtcs[0].description == "from the phone"


def _conf(monkeypatch, val):
    if val is None:
        monkeypatch.delenv("LYLO_HACK_ACCESSLOG", raising=False)
    else:
        monkeypatch.setenv("LYLO_HACK_ACCESSLOG", val)
    monkeypatch.setenv("LYLO_HACK_ENV_FILE", "none")
    spec = importlib.util.spec_from_file_location("gconf", os.path.join(HERE, "..", "gunicorn.conf.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_accesslog_flag(monkeypatch):
    off = _conf(monkeypatch, None)
    assert not hasattr(off, "accesslog")
    on = _conf(monkeypatch, "1")
    assert on.accesslog == "-"
    # path only (%(U)s, no query string), no headers or bodies
    assert "%(U)s" in on.access_log_format and "%(q)s" not in on.access_log_format and "%({" not in on.access_log_format
