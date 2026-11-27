"""Recorded-fixture fakes for the chunk 08 signal sources (no network)."""

from __future__ import annotations

import json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures" / "signals"


class FixtureGitHub:
    def __init__(self, name: str = "github.json"):
        self.data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        self.calls: list[tuple] = []

    def workflow_runs(self, workflow, branch, conclusion, created_after):
        self.calls.append(("runs", workflow, branch, conclusion, created_after))
        return list(self.data["workflow_runs"].get(workflow, []))

    def failed_job_logs(self, run_id):
        return self.data["logs"].get(str(run_id), "")

    def failed_jobs(self, run_id):
        # recorded jobs when the fixture has them, else one test job with the log
        jobs = self.data.get("jobs", {}).get(str(run_id))
        if jobs is not None:
            return [dict(j, log=j.get("log", "")) for j in jobs]
        return [
            {
                "name": "Tests",
                "failed_steps": ["Run tests"],
                "log": self.failed_job_logs(run_id),
            }
        ]

    def issues(self, since, label):
        self.calls.append(("issues", since, label))
        return list(self.data["issues"])

    def label_events(self, number):
        return list(self.data["label_events"].get(str(number), []))

    def is_org_member(self, org, login):
        assert org == "HelloAllyTech"
        return login in self.data["members"]
