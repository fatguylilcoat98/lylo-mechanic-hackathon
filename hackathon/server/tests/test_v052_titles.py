"""v0.5.2 titles in the response (LYLO_HACK_DTC_TITLES=1). Synthetic scans, Muse off."""
import json

import pytest

from lylo_hack import dtc_titles, ledger, live

CODES = ["P2241", "P0037", "U0100", "C0035", "B0001", "P0420", "P0300", "P0171", "P1690", "P0ZZZ"]


def _scan(*codes):
    return {"raw_dtcs": [{"code": c, "status": "active"} for c in codes], "raw_pids": []}


def _run(monkeypatch, flag, data):
    if flag:
        monkeypatch.setenv("LYLO_HACK_DTC_TITLES", "1")
    else:
        monkeypatch.delenv("LYLO_HACK_DTC_TITLES", raising=False)
    return live.diagnose(data, muse=False)


def test_flag_off_never_touches_titles(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("title code ran with flag off")
    monkeypatch.setattr(dtc_titles, "lookup", boom)
    monkeypatch.setattr(dtc_titles, "retitle", boom)
    monkeypatch.setattr(dtc_titles, "describe", boom)
    out = _run(monkeypatch, False, _scan("P2241", "U0100"))
    s = json.dumps(out)
    assert "Unknown fault: P2241" in s
    for it in out["detective"]["ledger"]:
        if it["type"] == "dtc":
            assert set(it) == {"id", "type", "code", "status"}


def test_flag_on_retitles_unknown(monkeypatch):
    out = _run(monkeypatch, True, _scan("P2241"))
    s = json.dumps(out, ensure_ascii=False)
    assert "Unknown fault: P2241" not in s
    assert "P2241: O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)" in s
    assert [h["cause_name"] for h in out["hypotheses"]][0].startswith("P2241: ")
    dtc = [i for i in out["detective"]["ledger"] if i["type"] == "dtc"][0]
    assert dtc["title"] == "O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)"


@pytest.mark.parametrize("code", CODES)
def test_safety_identical_on_and_off(monkeypatch, code):
    off = _run(monkeypatch, False, _scan(code, "P0128"))
    on = _run(monkeypatch, True, _scan(code, "P0128"))
    assert on["safety"] == off["safety"]
    assert on["detective"]["final_safety_level"] == off["detective"]["final_safety_level"]
    assert len(on["hypotheses"]) == len(off["hypotheses"])
    assert [h.get("confidence") for h in on["hypotheses"]] == [h.get("confidence") for h in off["hypotheses"]]


def test_unmapped_code_left_as_unknown(monkeypatch):
    out = _run(monkeypatch, True, _scan("P0ZZZ"))
    assert "P0ZZZ" in json.dumps(out)


def test_retitle_skips_safety_block():
    r = {"safety": {"reason": "Unknown fault: P2241"}, "x": ["Unknown fault: P2241", "Unknown fault: P9ZZZ"]}
    assert dtc_titles.retitle(r) == ["P2241"]
    assert r["safety"]["reason"] == "Unknown fault: P2241"
    assert r["x"][0].startswith("P2241: O2") and r["x"][1] == "Unknown fault: P9ZZZ"


# --- Vera condition 3: titles are labelled reference text, never evidence ---
from lylo_hack import detective, prove  # noqa: E402


def _prompt(monkeypatch, flag):
    if flag:
        monkeypatch.setenv("LYLO_HACK_DTC_TITLES", "1")
    else:
        monkeypatch.delenv("LYLO_HACK_DTC_TITLES", raising=False)
    data = _scan("P2241")
    session, symptoms, _ = live.build_session(data)
    result = live.orchestrator.run_diagnosis(session, symptoms).to_dict()
    seen = []

    def call(messages, schema, **kw):
        seen.append(messages)
        raise RuntimeError("stop")  # no real Muse call
    try:
        detective.run(data, result, call=call, force_call=True)
    except Exception:
        pass
    return seen[0] if seen else None


def test_prompt_labels_titles_reference_only(monkeypatch):
    msgs = _prompt(monkeypatch, True)
    sysmsg, user = msgs[0]["content"], msgs[-1]["content"]
    assert "not evidence of a cause" in sysmsg and "never raise or lower a safety level because of a title" in sysmsg
    assert dtc_titles.TITLE_NOTE in user and '"title_note"' in user


def test_prompt_unchanged_flag_off(monkeypatch):
    msgs = _prompt(monkeypatch, False)
    assert dtc_titles.PROMPT_RULE not in msgs[0]["content"]
    assert '"title' not in msgs[-1]["content"]


# --- Vera condition 2: prove records verify with and without the optional title ---
def test_prove_ledger_title_optional():
    old = {"id": "dtc:P2241:active", "type": "dtc", "code": "P2241", "status": "active"}
    new = dict(old, title="O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)", title_note=dtc_titles.TITLE_NOTE)
    led = prove.ProveLedger()
    led.append("lock", {"ledger": [old]}, now=1.0)      # record from before the flag
    e = led.append("check", {"ledger": [new]}, now=2.0)  # record with titles
    assert led.verify(head=e["sha256"], n=2)
    # tampering: adding a title to the old, already-hashed record must break the chain
    led._e[0]["body"]["ledger"][0]["title"] = "x"
    assert not led.verify(head=e["sha256"], n=2)

