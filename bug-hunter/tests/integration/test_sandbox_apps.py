"""Integration: for each app, the sandbox runs one known-passing test file from the
real repo and reports pass. Needs Docker; skipped otherwise. Timings are appended
to bug-hunter/runs/integration-timings.json for the chunk notes.

    poetry run pytest tests/integration -m docker -v -s
"""

from __future__ import annotations

import json
import os
import time
import uuid

import pytest

from bug_hunter.config import load_config
from bug_hunter.runs import Run
from bug_hunter.tools.runner import Runner
from bug_hunter.tools.sandbox import Sandbox, docker_available

KNOWN_PASSING = {
    "ally-be": "src/common/util/test/async.util.spec.ts",
    "ally-web": (
        "apps/ally-admin-dashboard/src/utils/__tests__/promptVersionText.test.ts"
    ),
    "ally-ai": "tests/prompts/test_resolver.py",
    # not test_download_files.py: it loads the Silero VAD from Hugging Face (network)
    "ally-ai-learn": "tests/unit/test_makefile.py",
    "ally-mobile": "test/features/account/presentation/profile_image_format_test.dart",
}
from bug_hunter.config import RUNS_DIR  # noqa: E402

TIMINGS = RUNS_DIR / "integration-timings.json"

pytestmark = pytest.mark.docker


def _record(app: str, data: dict) -> None:
    RUNS_DIR.mkdir(exist_ok=True)
    existing = json.loads(TIMINGS.read_text()) if TIMINGS.exists() else {}
    existing[app] = data
    TIMINGS.write_text(json.dumps(existing, indent=2))


@pytest.fixture(scope="module")
def worktree():
    """One Run for the module: its worktree is removed and its artefacts kept
    (under runs/artefacts/<run_id>/) however the tests end."""
    if not docker_available():
        pytest.skip("Docker daemon not reachable")
    config = load_config(env={})
    run_id = f"it-{uuid.uuid4().hex[:8]}"
    with Run.start(config, "ally-be", "HEAD", run_id=run_id, runs_dir=RUNS_DIR) as run:
        yield config, run.worktree, run_id


@pytest.mark.parametrize("app", list(KNOWN_PASSING))
def test_app_runs_one_passing_test_file(worktree, app: str) -> None:
    only = os.environ.get("BUGHUNTER_IT_APPS")
    if only and app not in only.split(","):
        pytest.skip(f"{app} not in BUGHUNTER_IT_APPS")
    config, path, run_id = worktree
    sandbox = Sandbox(config, path, app, run_id)  # same worktree, this app's image
    timing: dict = {"test_file": KNOWN_PASSING[app]}
    try:
        t0 = time.monotonic()
        sandbox.ensure_image()
        timing["image_s"] = round(time.monotonic() - t0, 1)
        t0 = time.monotonic()
        install = sandbox.install()
        timing["install_s"] = round(time.monotonic() - t0, 1)
        timing["install_cached"] = install is None
        runner = Runner(config, sandbox)
        result = runner.run_tests(KNOWN_PASSING[app])
        timing["one_file_s"] = result.duration_s
        timing["passed"] = result.passed
        if not result.passed:
            timing["excerpt"] = result.excerpt[-1500:]
        if os.environ.get("BUGHUNTER_IT_FULL") == "1":
            full = runner.run_tests()
            timing["full_suite_s"] = full.duration_s
            timing["full_suite_passed"] = full.passed
            timing["full_suite_failing"] = full.failing_tests[:20]
    except Exception as exc:  # noqa: BLE001 - recorded for the notes
        timing["error"] = str(exc)[-1500:]
        _record(app, timing)
        raise
    finally:
        sandbox.cleanup()
    _record(app, timing)
    print(f"\n{app}: {timing}")
    assert result.passed, result.excerpt
