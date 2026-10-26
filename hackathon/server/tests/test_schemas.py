"""Strict json_schema rules (v0.4.2 incident): every property must be required and
additionalProperties false, or the Meta API rejects the call before looking at the photo."""
import unittest
from lylo_hack import detective, helper, vision, voice


def problems(s, path="$"):
    out = []
    if s.get("type") == "object":
        props, req = set(s.get("properties", {})), set(s.get("required", []))
        if props != req:
            out.append(f"{path}: required mismatch {sorted(props ^ req)}")
        if s.get("additionalProperties") is not False:
            out.append(f"{path}: additionalProperties must be false")
        for k, v in s.get("properties", {}).items():
            out += problems(v, f"{path}.{k}")
    if s.get("type") == "array":
        out += problems(s["items"], path + "[]")
    return out


class StrictSchemas(unittest.TestCase):
    def test_all_schemas_strict_valid(self):
        for mod in (detective, helper, vision, voice):
            self.assertEqual(problems(mod.SCHEMA), [], mod.__name__)

    def test_checker_catches_missing_required(self):
        bad = {"type": "object", "additionalProperties": False, "required": [], "properties": {"a": {"type": "string"}}}
        self.assertTrue(problems(bad))
