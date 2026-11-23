"""Chunk 08: the HTTP GitHub reader builds read-only requests (fake opener)."""

from __future__ import annotations

import io
import json
import urllib.error

from bug_hunter.signals.clients import HttpGitHubReader


class Resp(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body if isinstance(body, bytes) else json.dumps(body).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_reader_only_issues_get_requests_with_the_token() -> None:
    seen = []

    def opener(req):
        seen.append(req)
        if "/members/" in req.full_url:
            if req.full_url.endswith("/outsider"):
                raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)
            return Resp(b"", status=204)
        if req.full_url.endswith("/jobs"):
            return Resp(
                {
                    "jobs": [
                        {"id": 7, "conclusion": "failure"},
                        {"id": 8, "conclusion": "success"},
                    ]
                }
            )
        if "/jobs/7/logs" in req.full_url:
            return Resp(b"FAILED tests/x.py::test_a")
        return Resp(
            {"workflow_runs": [{"id": 1, "head_sha": "abc", "created_at": "t"}]}
        )

    gh = HttpGitHubReader("tok", opener=opener)
    assert (
        gh.workflow_runs("test-ally-be.yml", "master", "failure", "2026-11-15")[0]["id"]
        == 1
    )
    assert gh.failed_job_logs(1) == "FAILED tests/x.py::test_a"
    assert gh.is_org_member("HelloAllyTech", "staff") is True
    assert gh.is_org_member("HelloAllyTech", "outsider") is False
    assert all(r.get_method() == "GET" for r in seen)
    assert all(r.headers["Authorization"] == "Bearer tok" for r in seen)
    assert (
        "created=%3E%3D2026-11-15" in seen[0].full_url
        and "branch=master" in seen[0].full_url
    )
