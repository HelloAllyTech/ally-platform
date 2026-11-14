"""Slow: build the repo map for all five real apps, record build time, symbol
counts, cache size and the ally-be DI resolution share for the chunk notes; show
the diff neighbourhood of real commits.

    make test-slow     (writes bug-hunter/runs/cache/map-stats.json)
"""

from __future__ import annotations

import json
import subprocess

import pytest

from bug_hunter.config import CACHE_DIR, load_config
from bug_hunter.context.contracts import build_contracts, save_contracts
from bug_hunter.context.repo_map import build_map, resolution_report, stats_table

pytestmark = pytest.mark.slow

APPS = ("ally-be", "ally-web", "ally-ai", "ally-ai-learn", "ally-mobile")
# One real fix commit per language on master (chunk 03 brief: three or more).
COMMITS = {
    "ally-be": "058f8d163",  # fix(ally-be): existence-guard the migration
    "ally-web": "7299a25cd",  # fix(admin): surface mic/speech-service errors
    "ally-mobile": "dba4d3e55",  # fix(scribe): battery-optimization exemption
}
STATS = CACHE_DIR / "map-stats.json"


@pytest.fixture(scope="module")
def config():
    return load_config(env={})


def test_all_apps_build_and_record_stats(config) -> None:
    results = {}
    stats = []
    maps = {}
    for app in APPS:
        repo_map, st = build_map(config, app, use_cache=False)
        maps[app] = repo_map
        stats.append(st)
        results[app] = {
            "files": st.files_total,
            "symbols": st.symbols,
            "calls": st.calls,
            "build_seconds": st.build_seconds,
            "cache_kb": round(st.cache_bytes / 1024),
            "resolution": resolution_report(st),
        }
        assert st.symbols > 100 and st.files_parsed == st.files_total - st.files_skipped
    for app in APPS:  # a warm build writes the cache; the next one loads it whole
        build_map(config, app, use_cache=True)
        _m, cached = build_map(config, app, use_cache=True)
        results[app]["cached_load_seconds"] = cached.build_seconds
        assert cached.files_reused == cached.files_total and cached.files_parsed == 0
    contracts = build_contracts(
        config, {a: maps[a] for a in ("ally-be", "ally-ai", "ally-ai-learn")}
    )
    size = save_contracts(contracts, CACHE_DIR / "repo-map" / "contracts.json")
    results["contracts"] = {
        "routes": len(contracts.routes),
        "http_matches": len(contracts.http),
        "unmatched_client_literals": len(contracts.unmatched_client_calls),
        "queues": [q.queue for q in contracts.queues],
        "bytes": size,
    }
    be = results["ally-be"]["resolution"]
    assert be["by_method"].get("di", 0) > 1000
    assert be["resolved_share"] > be["resolved_share_without_di"]
    STATS.parent.mkdir(parents=True, exist_ok=True)
    STATS.write_text(json.dumps(results, indent=1))
    print("\n" + stats_table(stats))
    print(json.dumps({"ally-be": be, "contracts": results["contracts"]}, indent=1))


@pytest.mark.parametrize("app,commit", list(COMMITS.items()))
def test_neighbourhood_of_real_commits(config, app: str, commit: str) -> None:
    repo_map, _ = build_map(config, app, use_cache=True)
    diff = subprocess.run(
        [
            "git",
            "-C",
            str(config.repo_root),
            "show",
            "--format=",
            "--unified=0",
            commit,
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    hood = repo_map.neighbourhood(diff)
    text = hood.render()
    print(f"\n=== {app} {commit}\n{text[:3000]}")
    assert hood.changed_files, "diff should name changed files"
    assert hood.items, "a code change should touch at least one symbol"
    out = STATS.parent / f"neighbourhood-{app}-{commit}.md"
    out.write_text(text)
