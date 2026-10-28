"""Test isolation: a developer or CI shell may export feature flags (e.g. LYLO_HACK_PROVE=1). Tests must not
inherit them; each test turns on what it needs with mock.patch.dict. Runs before any test module is imported."""
import os

FEATURE_FLAGS = ("LYLO_HACK_DEMO", "LYLO_HACK_ENGINE_OVERRIDE", "LYLO_HACK_NO_ADAPTER", "LYLO_HACK_PHOTO_HELPER",
                 "LYLO_HACK_PROVE", "LYLO_HACK_SAM", "LYLO_HACK_VIN", "LYLO_HACK_VISION", "LYLO_HACK_VOICE",
                 "LYLO_HACK_FIX_SHARED_LIST", "LYLO_HACK_REQUIRE_DATA", "LYLO_HACK_VISION_DEBUG_SAVE", "LYLO_HACK_FORCE_IPV")
for _k in FEATURE_FLAGS:
    os.environ.pop(_k, None)
os.environ["LYLO_HACK_MUSE"] = "0"  # never call Muse in tests
