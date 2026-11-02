"""v0.5.2: scripts/check-apk-manifest.sh fails on a manifest that drops RECORD_AUDIO. Synthetic manifests."""
import os
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _run(tmp_path, manifest):
    (tmp_path / "scripts").mkdir()
    shutil.copy(os.path.join(ROOT, "scripts", "check-apk-manifest.sh"), tmp_path / "scripts")
    if manifest is not None:
        d = tmp_path / "baseline/mobile/android/app/src/main"
        d.mkdir(parents=True)
        (d / "AndroidManifest.xml").write_text(manifest)
    return subprocess.run(["bash", str(tmp_path / "scripts/check-apk-manifest.sh")], capture_output=True, text=True)


def test_removed_fails(tmp_path):
    r = _run(tmp_path, '<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>')
    assert r.returncode == 1 and "removes" in r.stdout


def test_missing_fails(tmp_path):
    assert _run(tmp_path, '<uses-permission android:name="android.permission.INTERNET"/>').returncode == 1


def test_ok(tmp_path):
    assert _run(tmp_path, '<uses-permission android:name="android.permission.RECORD_AUDIO"/>').returncode == 0


def test_skip_when_not_generated(tmp_path):
    r = _run(tmp_path, None)
    assert r.returncode == 0 and "SKIP" in r.stdout
