"""Unit tests for scripts/dead_code.py (stdlib only): python3 -m unittest scripts/test_dead_code.py

The knip sample is trimmed from real `knip 6.44.1 --reporter json` output on ally-be.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dead_code  # noqa: E402

SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "knip-sample.json").read_text())


class ParseKnipTest(unittest.TestCase):
    def setUp(self):
        self.found = dead_code.parse_knip(SAMPLE, "ally-be")
        self.by_id = {f["id"]: f for f in self.found}

    def test_unused_file_comes_from_the_issue_own_files_list(self):
        fid = "ally-be|file|ally-be/src/database/db.logger.ts|(whole file)"
        self.assertIn(fid, self.by_id)
        self.assertIsNone(self.by_id[fid]["line"])

    def test_exports_and_types_carry_name_and_line(self):
        kinds = {f["kind"] for f in self.found if f["path"].endswith("bug-finding.enum.ts")}
        self.assertEqual(kinds, {"export", "type"})
        exp = next(f for f in self.found if f["kind"] == "export")
        self.assertTrue(exp["line"])
        self.assertTrue(exp["id"].startswith("ally-be|export|ally-be/src/"))

    def test_noise_buckets_are_not_reported(self):
        # The third issue only has enumMembers; it must yield nothing.
        self.assertFalse([f for f in self.found if "ozonetel.type.ts" in f["path"]])

    def test_ids_have_no_line_numbers(self):
        for f in self.found:
            self.assertEqual(f["id"], f"{f['repo']}|{f['kind']}|{f['path']}|{f['name']}")

    def test_empty_output(self):
        self.assertEqual(dead_code.parse_knip({"issues": []}, "ally-web"), [])
        self.assertEqual(dead_code.parse_knip({}, "ally-web"), [])


if __name__ == "__main__":
    unittest.main()
