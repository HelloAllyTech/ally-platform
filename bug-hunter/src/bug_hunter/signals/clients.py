"""Production clients for the signal sources (used on the VM). Read-only.

- ``HttpGitHubReader``: GitHub REST with a token (the GitHub App's installation token,
  or a fine-grained token as the fallback), passed in, never read from a file here.
- ``CloudWatchLogs``: Logs Insights via boto3 (read-only credentials on the VM).
- ``git_commits`` / ``git_changed_files``: the commit sweep's view of master.

Unit tests drive these with a fake HTTP opener; the network is never touched in tests.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Callable

API = "https://api.github.com"
Opener = Callable[[urllib.request.Request], Any]


class _DropAuthOnCrossHostRedirect(urllib.request.HTTPRedirectHandler):
    """GitHub answers a job-log download with a redirect to a signed blob-storage URL.
    urllib's stock handler copies every header onto the redirect, so the storage host
    got our GitHub token and refused it (401 "Server failed to authenticate the
    request"). The token is GitHub's: it never leaves for another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and (
            urllib.parse.urlsplit(newurl).netloc
            != urllib.parse.urlsplit(req.full_url).netloc
        ):
            new.remove_header("Authorization")
        return new


_http = urllib.request.build_opener(_DropAuthOnCrossHostRedirect)


class HttpGitHubReader:
    def __init__(
        self,
        token: str,
        repo: str = "HelloAllyTech/ally-platform",
        opener: Opener | None = None,
    ):
        self.token = token
        self.repo = repo
        self.opener = opener or (lambda req: _http.open(req, timeout=60))

    def _get(self, path: str, params: dict[str, Any] | None = None, raw=False):
        url = f"{API}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "bug-hunter",
            },
        )
        with self.opener(req) as resp:
            body = resp.read()
            status = getattr(resp, "status", 200)
        if raw:
            return status, body.decode("utf-8", errors="replace")
        return json.loads(body or b"null")

    def workflow_runs(self, workflow, branch, conclusion, created_after):
        data = self._get(
            f"/repos/{self.repo}/actions/workflows/{workflow}/runs",
            {
                "branch": branch,
                "status": conclusion,
                "created": f">={created_after}",
                "per_page": 50,
            },
        )
        return [
            {"id": r["id"], "head_sha": r["head_sha"], "created_at": r["created_at"]}
            for r in data.get("workflow_runs", [])
        ]

    def failed_job_logs(self, run_id):
        jobs = self._get(f"/repos/{self.repo}/actions/runs/{run_id}/jobs")
        parts = []
        for job in jobs.get("jobs", []):
            if job.get("conclusion") == "failure":
                _, text = self._get(
                    f"/repos/{self.repo}/actions/jobs/{job['id']}/logs", raw=True
                )
                parts.append(text)
        return "\n".join(parts)

    def issues(self, since, label):
        return self._get(
            f"/repos/{self.repo}/issues",
            {"labels": label, "since": since, "state": "open", "per_page": 100},
        )

    def label_events(self, number):
        return self._get(
            f"/repos/{self.repo}/issues/{number}/events", {"per_page": 100}
        )

    def is_org_member(self, org, login):
        try:
            status, _ = self._get(f"/orgs/{org}/members/{login}", raw=True)
        except urllib.error.HTTPError:
            return False  # 404 / 302: not a (visible) member
        return status == 204


class CloudWatchLogs:
    """Logs Insights, read-only. boto3 is imported here only, on the VM."""

    def __init__(self, region: str = "ap-south-1", client: Any = None, poll_s=2.0):
        if client is None:
            import boto3  # noqa: PLC0415 - optional dependency, VM only

            client = boto3.client("logs", region_name=region)
        self.client = client
        self.poll_s = poll_s

    def query(self, log_group: str, query: str, start: datetime, end: datetime):
        qid = self.client.start_query(
            logGroupName=log_group,
            startTime=int(start.timestamp()),
            endTime=int(end.timestamp()),
            queryString=query,
            limit=500,
        )["queryId"]
        while True:
            res = self.client.get_query_results(queryId=qid)
            if res["status"] in ("Complete", "Failed", "Cancelled", "Timeout"):
                break
            time.sleep(self.poll_s)
        return [{f["field"]: f["value"] for f in row} for row in res.get("results", [])]


def git_commits(git, ref: str = "origin/master", days: int = 1):
    """Commits on master after ``since`` (oldest first); the last day when unset."""

    def list_commits(since: str | None) -> list[str]:
        args = ["rev-list", "--reverse", "--no-merges"]
        args += [f"{since}..{ref}"] if since else [f"--since={days} days ago", ref]
        return [s for s in git._git(args).stdout.split() if s]

    return list_commits


def git_changed_files(git):
    def changed(sha: str) -> list[str]:
        out = git._git(["show", "--name-only", "--format=", sha]).stdout
        return [line for line in out.splitlines() if line.strip()]

    return changed
