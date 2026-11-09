"""``bug-hunter`` command line.

Chunk 01 ships ``bug-hunter config check``. ``run``, ``sweep``, ``eval`` and
``replay`` arrive with the chunks that build them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

from bug_hunter.config import (
    ARTEFACTS_DIR,
    ROLES,
    RUNS_DIR,
    BugHunterConfig,
    ConfigError,
    load_config,
)

app = typer.Typer(
    help="Bug Hunter v2: finds and fixes bugs in the ally-platform apps.",
    no_args_is_help=True,
)
config_app = typer.Typer(help="Inspect and validate the configuration.")
app.add_typer(config_app, name="config")
map_app = typer.Typer(help="Repo map: build and inspect the symbol index.")
app.add_typer(map_app, name="map")
runs_app = typer.Typer(help="Runs: sweep what crashed runs left behind.")
app.add_typer(runs_app, name="runs")
cache_app = typer.Typer(help="Caches and kept artefacts: sizes and cleaning.")
app.add_typer(cache_app, name="cache")
eval_app = typer.Typer(help="Eval harness: mine, curate and run golden cases.")
app.add_typer(eval_app, name="eval")


def _load_or_exit(
    config_dir: Path | None = None, repo_root: Path | None = None
) -> BugHunterConfig:
    try:
        return load_config(config_dir=config_dir, repo_root=repo_root)
    except ConfigError as exc:
        typer.echo(f"config error:\n{exc}", err=True)
        raise typer.Exit(code=1)


def _mb(size: int) -> str:
    return f"{size / 1024 / 1024:.1f} MB"


@map_app.command("build")
def map_build(
    apps: Annotated[
        list[str] | None, typer.Argument(help="Apps to index (default: all five).")
    ] = None,
    no_cache: Annotated[
        bool,
        typer.Option(
            "--no-cache", help="Parse everything; do not read or write the cache."
        ),
    ] = False,
    contracts: Annotated[
        bool,
        typer.Option("--contracts", help="Also rebuild the cross-app contract hints."),
    ] = False,
) -> None:
    """Build (or refresh) the repo map at HEAD and print build stats."""
    from bug_hunter.context.repo_map import build_map, resolution_report, stats_table

    config = _load_or_exit()
    names = apps or list(config.apps.apps)
    stats = []
    maps = {}
    for name in names:
        repo_map, st = build_map(config, name, use_cache=not no_cache)
        maps[name] = repo_map
        stats.append(st)
        rep = resolution_report(st)
        typer.echo(
            f"{name}: {st.files_total} files ({st.files_parsed} parsed, "
            f"{st.files_reused} reused), {st.symbols} symbols, {st.calls} calls, "
            f"resolved {rep['resolved_share']:.0%} "
            f"(plausible {rep['plausible_share']:.0%}), {st.build_seconds}s, "
            f"cache {st.cache_bytes / 1024:.0f} KB"
        )
    typer.echo("")
    typer.echo(stats_table(stats))
    if contracts:
        from bug_hunter.config import CACHE_DIR
        from bug_hunter.context.contracts import build_contracts, save_contracts

        built = build_contracts(config, maps)
        size = save_contracts(built, CACHE_DIR / "repo-map" / "contracts.json")
        typer.echo(
            f"contracts: {len(built.routes)} routes, {len(built.http)} http matches, "
            f"{len(built.queues)} queues ({size} bytes)"
        )


@map_app.command("neighbourhood")
def map_neighbourhood(
    app_name: Annotated[str, typer.Argument(help="App the commit touches.")],
    commit: Annotated[str, typer.Argument(help="Commit to describe.")],
) -> None:
    """Show the diff neighbourhood (symbols, callers, callees, tests) of a commit."""
    import subprocess

    from bug_hunter.context.repo_map import build_map

    config = _load_or_exit()
    repo_map, _ = build_map(config, app_name)
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
    typer.echo(repo_map.neighbourhood(diff).render())


@runs_app.command("clean")
def runs_clean() -> None:
    """Remove orphaned live runs, stale worktrees and bughunter-* containers."""
    from bug_hunter.runs import clean_orphans

    config = _load_or_exit()
    removed = clean_orphans(config)
    for kind, items in removed.items():
        typer.echo(f"{kind}: {', '.join(items) if items else 'nothing to remove'}")


@cache_app.command("size")
def cache_size() -> None:
    """Sizes of kept artefacts, repo-map and tiktoken caches, dependency volumes."""
    from bug_hunter.runs import cache_report

    report = cache_report()
    typer.echo(f"kept artefacts: {_mb(report['artefacts_bytes'])}  ({ARTEFACTS_DIR})")
    typer.echo(f"repo-map cache: {_mb(report['repo_map_bytes'])}")
    for app_name, size in sorted(report["repo_map_per_app_bytes"].items()):
        typer.echo(f"  {app_name:<14} {_mb(size)}")
    typer.echo(f"tiktoken cache: {_mb(report['tiktoken_bytes'])}")
    typer.echo(f"live runs: {', '.join(report['live_runs']) or 'none'}  ({RUNS_DIR})")
    if report["docker_volumes"]:
        typer.echo("dependency volumes (docker):")
        for name, size in sorted(report["docker_volumes"].items()):
            typer.echo(f"  {name:<48} {size}")


@cache_app.command("clean")
def cache_clean(
    max_age_days: Annotated[
        int | None,
        typer.Option(
            help="Delete kept artefacts older than this (default from limits.yaml)."
        ),
    ] = None,
    max_size_mb: Annotated[
        int | None,
        typer.Option(
            help="Then delete oldest until under this size (default from limits.yaml)."
        ),
    ] = None,
    include_paused: Annotated[
        bool,
        typer.Option(
            "--include-paused",
            help="Also delete artefacts of runs paused for approval.",
        ),
    ] = False,
    repo_map: Annotated[
        bool,
        typer.Option(
            "--repo-map", help="Also drop all cached repo maps (rebuilt on demand)."
        ),
    ] = False,
    volumes: Annotated[
        bool,
        typer.Option(
            "--volumes",
            help="Also delete the bug hunter's dependency volumes (bughunter-deps-*).",
        ),
    ] = False,
) -> None:
    """Prune kept artefacts by age and size; optionally repo maps and volumes."""
    import shutil

    from bug_hunter.config import CACHE_DIR
    from bug_hunter.runs import cache_report, clean_artefacts, remove_docker_dep_volumes

    config = _load_or_exit()
    result = clean_artefacts(
        config,
        max_age_days=max_age_days,
        max_size_mb=max_size_mb,
        include_paused=include_paused,
    )
    typer.echo(f"artefacts deleted: {', '.join(result['deleted']) or 'none'}")
    if result["kept_paused"]:
        typer.echo(f"kept (paused for approval): {', '.join(result['kept_paused'])}")
    typer.echo(f"artefacts now: {_mb(result['size_bytes'])}")
    if repo_map:
        shutil.rmtree(CACHE_DIR / "repo-map", ignore_errors=True)
        typer.echo("repo-map cache removed")
    if volumes:
        removed = remove_docker_dep_volumes()
        typer.echo(f"dependency volumes removed: {', '.join(removed) or 'none'}")
    report = cache_report()
    typer.echo(
        f"total on disk now: artefacts {_mb(report['artefacts_bytes'])}, "
        f"repo-map {_mb(report['repo_map_bytes'])}, "
        f"tiktoken {_mb(report['tiktoken_bytes'])}"
    )


def resolved_config_summary(config: BugHunterConfig) -> dict[str, Any]:
    """The resolved config as plain data. Contains no secrets: the config files
    hold none, and env overrides are only ``provider:model`` pairs."""
    return {
        "config_dir": str(config.config_dir),
        "repo_root": str(config.repo_root),
        "models": {
            "defaults": config.models.defaults.model_dump(),
            "roles": {
                role: {
                    **config.model_for(role).model_dump(),
                    "overridden": role in config.model_overrides,
                    "fallbacks": [
                        spec.model_dump() for spec in config.fallbacks_for(role)
                    ],
                }
                for role in ROLES
            },
        },
        "limits": config.limits.model_dump(),
        "apps": {
            name: {
                "path": str(config.app_path(name)),
                "exists": config.app_path(name).is_dir(),
                "lang": app_config.lang,
                "test": app_config.test,
                "test_one": app_config.test_one,
                "lint": app_config.lint,
                "typecheck": app_config.typecheck,
                "test_dirs": app_config.test_dirs,
                "risk_paths": app_config.risk_paths,
            }
            for name, app_config in config.apps.apps.items()
        },
        "global_risk_paths": config.apps.global_risk_paths,
    }


def _print_summary(summary: dict[str, Any]) -> None:
    typer.echo(f"config dir: {summary['config_dir']}")
    typer.echo(f"repo root:  {summary['repo_root']}")
    typer.echo("")
    typer.echo("models")
    defaults = summary["models"]["defaults"]
    typer.echo(
        f"  defaults: temperature={defaults['temperature']} "
        f"timeout_s={defaults['timeout_s']} max_retries={defaults['max_retries']}"
    )
    for role, spec in summary["models"]["roles"].items():
        line = f"  {role:<12} {spec['provider']}:{spec['model']}"
        if spec["overridden"]:
            line += "  (env override)"
        if spec["fallbacks"]:
            chain = ", ".join(
                f"{f['provider']}:{f['model']}" for f in spec["fallbacks"]
            )
            line += f"  fallbacks: {chain}"
        typer.echo(line)
    typer.echo("")
    typer.echo("limits")
    for section, values in summary["limits"].items():
        pairs = " ".join(f"{key}={value}" for key, value in values.items())
        typer.echo(f"  {section}: {pairs}")
    typer.echo("")
    typer.echo("apps")
    for name, details in summary["apps"].items():
        mark = "ok" if details["exists"] else "MISSING"
        typer.echo(f"  {name:<14} {mark:<8} {details['path']}")
        typer.echo(f"      test:      {details['test']}")
        if details["test_one"]:
            typer.echo(f"      test_one:  {details['test_one']}")
        if details["lint"]:
            typer.echo(f"      lint:      {details['lint']}")
        if details["typecheck"]:
            typer.echo(f"      typecheck: {details['typecheck']}")
        typer.echo(f"      risk_paths: {len(details['risk_paths'])}")
    typer.echo(f"  global_risk_paths: {len(summary['global_risk_paths'])}")


@config_app.command("check")
def config_check(
    config_dir: Annotated[
        Path | None,
        typer.Option(help="Config directory (default: bug-hunter/config)."),
    ] = None,
    repo_root: Annotated[
        Path | None,
        typer.Option(help="ally-platform root (default: parent of bug-hunter/)."),
    ] = None,
    as_json: Annotated[
        bool, typer.Option("--json", help="Print the resolved config as JSON.")
    ] = False,
) -> None:
    """Load the config, print it without secrets, and verify every app path exists."""
    try:
        config = load_config(config_dir=config_dir, repo_root=repo_root)
    except ConfigError as exc:
        typer.echo(f"config error:\n{exc}", err=True)
        raise typer.Exit(code=1)

    summary = resolved_config_summary(config)
    if as_json:
        typer.echo(json.dumps(summary, indent=2))
    else:
        _print_summary(summary)

    missing = config.missing_app_paths()
    if missing:
        typer.echo("", err=True)
        typer.echo("missing app paths:", err=True)
        for item in missing:
            typer.echo(f"  - {item}", err=True)
        raise typer.Exit(code=1)
    typer.echo("")
    typer.echo("config ok")


@eval_app.command("mine")
def eval_mine(
    apps: Annotated[
        list[str] | None, typer.Argument(help="Apps to mine (default: all five).")
    ] = None,
    no_gh: Annotated[
        bool, typer.Option("--no-gh", help="Do not call gh for PR titles.")
    ] = False,
) -> None:
    """Mine real-bug and clean-diff candidates into evals/golden/candidates/."""
    from bug_hunter.config import PACKAGE_ROOT
    from evals.mine_cases import Repo, mine_all, write_candidates

    config = _load_or_exit()
    folder = PACKAGE_ROOT / "evals" / "golden" / "candidates"
    repo = Repo(config.repo_root)
    candidates = mine_all(
        config, repo, apps, use_gh=not no_gh, pr_cache_path=folder / "pr-cache.json"
    )
    md = write_candidates(folder, repo, candidates)
    bugs = sum(1 for c in candidates if c.kind == "bug")
    typer.echo(f"{bugs} bug and {len(candidates) - bugs} clean candidates → {md}")


@eval_app.command("accept")
def eval_accept(
    ids: Annotated[
        list[str], typer.Argument(help="Candidate ids to add to cases.yaml.")
    ],
) -> None:
    """Move reviewed candidates into evals/golden/cases.yaml."""
    import json as _json

    from bug_hunter.config import PACKAGE_ROOT
    from evals.schema import Case, load_cases, save_cases

    folder = PACKAGE_ROOT / "evals" / "golden"
    candidates = {
        c["id"]: c
        for c in _json.loads((folder / "candidates" / "candidates.json").read_text())
    }
    cases = load_cases(folder / "cases.yaml")
    known = {c.id for c in cases.cases}
    added = []
    for cid in ids:
        if cid in known:
            typer.echo(f"{cid}: already in cases.yaml")
            continue
        c = candidates.get(cid)
        if c is None:
            typer.echo(f"{cid}: not a candidate", err=True)
            raise typer.Exit(code=1)
        cases.cases.append(
            Case(
                id=c["id"],
                kind=c["kind"],
                app=c["app"],
                parent=c["parent"],
                commit=c["sha"],
                expected=c["expected"],
                layout=c.get("layout", "monorepo"),
                risk=c["risk"],
                description=c["description"],
                src_files=c["src_files"],
                oracle_tests=c["test_files"],
                src_lines=c["src_lines"],
                lockfile_blob=c["lockfile_blob"],
            )
        )
        added.append(cid)
    save_cases(folder / "cases.yaml", cases)
    typer.echo(
        f"added {len(added)}: {', '.join(added) or 'none'}; "
        f"cases.yaml now {len(cases.cases)} cases {cases.by_app()}"
    )


@eval_app.command("run")
def eval_run(
    cases_filter: Annotated[
        str | None,
        typer.Option("--cases", help="app, kind (bug/clean) or id; comma-separated."),
    ] = None,
    agent: Annotated[
        str, typer.Option(help="'baseline' or module:Class.")
    ] = "baseline",
    mode: Annotated[str, typer.Option(help="sweep or issue.")] = "issue",
    oracle_check: Annotated[
        bool,
        typer.Option(
            "--oracle-check", help="Prove cases: real fix makes the oracle pass."
        ),
    ] = False,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Print the plan; run nothing.")
    ] = False,
    min_free_gb: Annotated[
        float | None, typer.Option(help="Disk floor (default from limits.yaml).")
    ] = None,
) -> None:
    """Run the golden cases against an agent, one at a time, and write a report."""
    import json as _json

    from bug_hunter.config import PACKAGE_ROOT
    from evals.agents import load_agent
    from evals.run_evals import HarnessOptions, run_evals
    from evals.schema import load_cases

    config = _load_or_exit()
    case_file = load_cases(PACKAGE_ROOT / "evals" / "golden" / "cases.yaml")
    selected = case_file.select(cases_filter)
    if not selected:
        typer.echo(
            "no cases selected (is cases.yaml empty? "
            "run `bug-hunter eval mine` and `eval accept`)",
            err=True,
        )
        raise typer.Exit(code=1)
    if mode not in ("sweep", "issue"):
        typer.echo("mode must be sweep or issue", err=True)
        raise typer.Exit(code=1)
    options = HarnessOptions(
        mode=mode, oracle_check=oracle_check, dry_run=dry_run, min_free_gb=min_free_gb
    )
    report, path = run_evals(config, selected, load_agent(agent), options)
    if dry_run:
        typer.echo(_json.dumps(report.meta["plan"], indent=1))
        return
    typer.echo(f"report: {path}")
    summary = report.to_dict()["metrics"]["total"]
    typer.echo(
        _json.dumps(
            {
                "cases": summary["cases"],
                "rates": summary["rates"],
                "stopped": report.meta["stopped_reason"],
            },
            indent=1,
        )
    )
    if report.meta["stopped_reason"]:
        raise typer.Exit(code=2)


if __name__ == "__main__":
    app()
