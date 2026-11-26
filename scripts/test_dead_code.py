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


class GroupByModuleTest(unittest.TestCase):
    def test_depth_is_per_repo(self):
        found = [
            dead_code.finding("ally-be", "export", "ally-be/src/debrief/util/a.ts", "x"),
            dead_code.finding("ally-be", "export", "ally-be/src/debrief/service/b.ts", "y"),
            dead_code.finding(
                "ally-web", "file", "ally-web/apps/admin/src/pages/Logs/a.tsx", "(whole file)"
            ),
            dead_code.finding(
                "ally-web", "file", "ally-web/apps/admin/src/pages/Users/b.tsx", "(whole file)"
            ),
        ]
        keys = {g["key"]: g["count"] for g in dead_code.group_by_module(
            found, depths={"ally-be": 3, "ally-web": 6}
        )}
        # one Nest module (both sub-folders), but two separate web feature folders
        self.assertEqual(
            keys,
            {"ally-be/src/debrief": 2, "ally-web/apps/admin/src/pages/Logs": 1,
             "ally-web/apps/admin/src/pages/Users": 1},
        )


class EvidenceItemTest(unittest.TestCase):
    """What the PM Agent's agent reads: how each finding was reached, and honest counts."""

    def test_scanners_tag_their_findings(self):
        found = dead_code.parse_knip(SAMPLE, "ally-be")
        self.assertTrue(found and all(f["scanner"] == "knip" for f in found))
        v = dead_code.finding("ally-ai", "function", "ally-ai/app/a.py", "f", 3, "vulture")
        self.assertEqual(v["scanner"], "vulture")

    def test_scanner_is_not_part_of_the_id(self):
        a = dead_code.finding("r", "function", "r/a.py", "f", 1, "vulture")
        b = dead_code.finding("r", "function", "r/a.py", "f", 9)
        self.assertEqual(a["id"], b["id"])  # baseline entries must not churn

    def test_whole_file_line_says_import_graph_and_is_relative_to_module(self):
        f = dead_code.finding("w", "file", "w/src/constants/demographics.ts", "(whole file)", None, "knip")
        line = dead_code.describe_item(f, "w/src/constants")
        self.assertEqual(line, "file demographics.ts: no file imports it [knip: import graph]")

    def test_symbol_line_names_the_symbol_and_the_check_to_use(self):
        f = dead_code.finding("a", "function", "a/app/x/y.py", "helper", 4, "vulture")
        self.assertEqual(
            dead_code.describe_item(f, "a/app/x"), "function helper in y.py [vulture: name match]"
        )

    def test_untagged_finding_still_renders(self):
        f = dead_code.finding("a", "class", "a/app/x.py", "K")
        self.assertEqual(dead_code.describe_item(f, "a/app"), "class K in x.py")

    def test_count_is_the_total_and_items_are_capped_whole_files_first(self):
        found = [
            dead_code.finding("w", "export", f"w/src/m/f{i}.ts", f"e{i}", i, "knip")
            for i in range(60)
        ] + [dead_code.finding("w", "file", "w/src/m/dead.ts", "(whole file)", None, "knip")]
        (g,) = dead_code.group_by_module(found, depths={"w": 3})
        self.assertEqual(g["count"], 61)
        self.assertEqual(len(g["items"]), dead_code.ITEMS_MAX)
        self.assertTrue(g["items"][0].startswith("file dead.ts"))
        self.assertTrue(all(len(i) <= dead_code.ITEM_MAX for i in g["items"]))
        self.assertNotIn("_found", g)


if __name__ == "__main__":
    unittest.main()
