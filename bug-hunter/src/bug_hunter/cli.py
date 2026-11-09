"""``bug-hunter`` command line: ``config``, ``map``, ``runs``, ``cache``, ``eval``,
``run`` (one bug signal through graph v1) and ``replay`` (inspect or resume a run).
``sweep`` arrives in chunk 08.

Keys come from ``bug-hunter/.env`` locally (loaded here, never printed) and from
repository secrets in CI.
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


@app.callback()
def _startup() -> None:
    """Load bug-hunter/.env (if present) and turn LangSmith tracing on when a key is
    set. Values are never echoed."""
    from dotenv import load_dotenv

    from bug_hunter.config import PACKAGE_ROOT
    from bug_hunter.graph.tracing import configure

    load_dotenv(PACKAGE_ROOT / ".env", override=False)
    configure()


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
spend_app = typer.Typer(help="Daily model-spend ledger (runs/spend.json).")
app.add_typer(spend_app, name="spend")


@spend_app.command("show")
def spend_show(
    day: Annotated[
        str | None, typer.Option(help="YYYY-MM-DD (default today, UTC).")
    ] = None,
) -> None:
    """Today's entries and total against the daily cap."""
    from bug_hunter import spend

    typer.echo(spend.summary(day))


@spend_app.command("add")
def spend_add(
    usd: Annotated[float, typer.Argument(help="Cost in USD.")],
    source: Annotated[
        str, typer.Option(help="github | estimate | local-run | other")
    ] = "github",
    note: Annotated[str, typer.Option(help="Run id / what it was.")] = "",
) -> None:
    """Record spend that did not happen on this machine (a GitHub run, an estimate)."""
    from bug_hunter import spend

    entry = spend.record(usd, source, note)
    typer.echo(
        f"recorded ${entry.usd:.2f} ({entry.source}) — "
        f"{spend.summary().splitlines()[0]}"
    )


@spend_app.command("check")
def spend_check(
    expected: Annotated[
        float, typer.Option(help="Expected cost of the run about to start.")
    ] = 0.0,
) -> None:
    """Exit 1 if today's spend plus --expected would pass the daily cap."""
    from bug_hunter import spend

    try:
        spent = spend.check_cap(expected_usd=expected)
    except spend.SpendCapExceeded as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)
    typer.echo(
        f"ok: ${spent:.2f} spent today + ~${expected:.2f} stays under the "
        f"${spend.DAILY_CAP_USD:.0f} cap"
    )


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


@eval_app.command("modes")
def eval_modes(
    case_id: Annotated[str, typer.Argument(help="Case id in cases.yaml.")],
    modes: Annotated[list[str], typer.Argument(help="sweep and/or issue.")],
) -> None:
    """Restrict a case to the given harness modes (e.g. sweep only: no user symptom)."""
    from bug_hunter.config import PACKAGE_ROOT
    from evals.schema import load_cases, save_cases

    path = PACKAGE_ROOT / "evals" / "golden" / "cases.yaml"
    cases = load_cases(path)
    match = [c for c in cases.cases if c.id == case_id]
    if not match:
        typer.echo(f"{case_id}: not in cases.yaml", err=True)
        raise typer.Exit(code=1)
    match[0].modes = list(dict.fromkeys(modes))  # validated on save/load
    save_cases(path, cases)
    load_cases(path)
    typer.echo(f"{case_id}: modes = {match[0].modes}")


@eval_app.command("blame")
def eval_blame(
    ids: Annotated[
        list[str] | None,
        typer.Argument(
            help="Case ids (default: every bug case without introduced_by)."
        ),
    ] = None,
    force: Annotated[
        bool, typer.Option("--force", help="Recompute even when already set.")
    ] = False,
) -> None:
    """Record, per bug case, the commit that introduced the bug (git blame of the lines
    the fix removed, at the parent). Sweep mode reviews that commit's diff."""
    from bug_hunter.config import PACKAGE_ROOT
    from evals.mine_cases import Repo, introducing_commit
    from evals.run_evals import case_repo_paths
    from evals.schema import load_cases, save_cases

    config = _load_or_exit()
    path = PACKAGE_ROOT / "evals" / "golden" / "cases.yaml"
    case_file = load_cases(path)
    repo = Repo(config.repo_root)
    wanted = set(ids or [])
    changed = 0
    for index, case in enumerate(case_file.cases):
        if case.kind != "bug" or (wanted and case.id not in wanted):
            continue
        if case.introduced_by and not force:
            continue
        app_path = config.app(case.app).path
        sha = introducing_commit(
            repo,
            case.commit,
            case.parent,
            case_repo_paths(case, app_path, case.src_files),
        )
        modes = list(case.modes)
        if sha is None and "sweep" in modes:
            modes.remove("sweep")
        case_file.cases[index] = case.model_copy(
            update={"introduced_by": sha, "modes": modes or ["issue"]}
        )
        changed += 1
        typer.echo(
            f"{case.id}: introduced_by={sha[:12] if sha else 'none (issue-only)'}"
            f"{'' if sha else '  modes=' + ','.join(modes or ['issue'])}"
        )
    save_cases(path, case_file)
    typer.echo(f"updated {changed} cases in {path.name}")


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
    max_cost_usd: Annotated[
        float | None,
        typer.Option(help="Stop cleanly once the cases cost this much (limits.yaml)."),
    ] = None,
    override_spend_cap: Annotated[
        bool,
        typer.Option(
            "--override-spend-cap",
            help="Start even past the $15 daily ledger cap (user's explicit go-ahead).",
        ),
    ] = False,
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
    from bug_hunter import spend

    options = HarnessOptions(
        mode=mode,
        oracle_check=oracle_check,
        dry_run=dry_run,
        min_free_gb=min_free_gb,
        max_cost_usd=max_cost_usd,
        spend_file=spend.SPEND_FILE,
        override_spend_cap=True if override_spend_cap else None,
    )
    try:
        report, path = run_evals(config, selected, load_agent(agent), options)
    except spend.SpendCapExceeded as exc:
        typer.echo(f"refused: {exc}", err=True)
        raise typer.Exit(code=3)
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
                "cost_usd": report.meta.get("cost_usd_total"),
                "cost_cap_usd": report.meta.get("cost_cap_usd"),
                "spend_today_usd": report.meta.get("spend_today_usd"),
                "stopped": report.meta["stopped_reason"],
            },
            indent=1,
        )
    )
    if report.meta["stopped_reason"]:
        raise typer.Exit(code=2)


# --- run / replay (chunk 05) ----


@app.command("run")
def run_cmd(
    app_name: Annotated[
        str | None, typer.Option("--app", help="ally-be, ally-web, ally-ai, …")
    ] = None,
    issue_text: Annotated[
        str | None, typer.Option(help="Issue mode: the report, as a reporter wrote it.")
    ] = None,
    commit: Annotated[
        str | None, typer.Option(help="Sweep mode: review this commit's diff.")
    ] = None,
    ref: Annotated[
        str | None,
        typer.Option(
            help="Commit to check out (default origin/master, or the commit)."
        ),
    ] = None,
    no_checkpoint: Annotated[
        bool,
        typer.Option("--no-checkpoint", help="In-memory checkpoints (no Postgres)."),
    ] = False,
    run_id: Annotated[
        str | None, typer.Option(help="Run id (default: generated).")
    ] = None,
    push: Annotated[
        bool,
        typer.Option(
            "--push",
            help="Really push the branch and open the draft PR (needs the GitHub "
            "App). Default: dry run into the run's artefacts.",
        ),
    ] = False,
) -> None:
    """One bug signal through the graph: triage → investigate → reproduce → fix →
    verify → review → risk gate → draft PR (dry-run by default) → human approval."""
    import json as _json

    from bug_hunter.graph.build import build_graph, run_graph
    from bug_hunter.graph.checkpointer import CheckpointerError, open_checkpointer
    from bug_hunter.graph.deps import GraphDeps
    from bug_hunter.graph.state import Signal
    from bug_hunter.graph.tracing import trace_url
    from bug_hunter.runs import Run
    from bug_hunter.safety.phi import scrub, scrub_code
    from bug_hunter.tools.git import Git

    config = _load_or_exit()
    if bool(issue_text) == bool(commit):
        typer.echo("give exactly one of --issue-text or --commit", err=True)
        raise typer.Exit(code=1)
    git = Git(config.repo_root)
    diff = ""
    if commit:
        mode = "sweep"
        diff = git._git(["show", "--format=", commit]).stdout
        touched = [
            line[6:]
            for line in diff.splitlines()
            if line.startswith("+++ b/") and not line.endswith("/dev/null")
        ]
        apps_touched = sorted(
            {
                name
                for name, a in config.apps.apps.items()
                if any(t.startswith(a.path + "/") for t in touched)
            }
        )
        if app_name is None:
            if len(apps_touched) != 1:
                typer.echo(
                    f"--app needed: the commit touches {apps_touched or 'no app'}",
                    err=True,
                )
                raise typer.Exit(code=1)
            app_name = apps_touched[0]
        checkout = ref or f"{commit}^"
        signal = Signal(
            source="commit_sweep",
            ref=commit[:12],
            raw_summary=scrub_code(diff[:6000]),
            reported_by="agent",
        )
    else:
        mode = "issue"
        if app_name is None:
            typer.echo("--app is required in issue mode", err=True)
            raise typer.Exit(code=1)
        checkout = ref or "origin/master"
        signal = Signal(
            source="issue",
            ref=run_id or "cli",
            raw_summary=scrub(issue_text or ""),
            reported_by="staff",
        )
    if app_name not in config.apps.apps:
        typer.echo(f"unknown app {app_name!r}", err=True)
        raise typer.Exit(code=1)
    from bug_hunter import spend

    try:
        spend.check_cap(expected_usd=config.limits.run.max_cost_usd)
    except spend.SpendCapExceeded as exc:
        typer.echo(f"refused: {exc}", err=True)
        raise typer.Exit(code=3)
    try:
        with open_checkpointer(in_memory=no_checkpoint) as saver:
            with Run.start(config, app_name, checkout, run_id=run_id) as run:
                deps = GraphDeps.for_run(
                    config,
                    run,
                    app_name,
                    mode,
                    diff=diff,
                    ref=checkout,
                    checkpointer=saver,
                )
                deps.push = push
                if not no_checkpoint:
                    from bug_hunter.graph.approvals import PostgresApprovals
                    from bug_hunter.graph.checkpointer import db_url

                    deps.approvals = PostgresApprovals(db_url())
                typer.echo(
                    f"run {run.run_id}: {mode} mode, {app_name} at {checkout}"
                    + ("" if push else " (PR dry-run)")
                )
                graph = build_graph(deps, saver)
                state = run_graph(graph, deps, signal)
                state.trace_url = trace_url(run.run_id)
                if state.budget_used.cost_usd:
                    spend.record(
                        state.budget_used.cost_usd,
                        "local-run",
                        f"{run.run_id} {app_name}",
                    )
                typer.echo(
                    _json.dumps(
                        {
                            "run_id": run.run_id,
                            "status": state.status,
                            "finding": state.finding.title if state.finding else None,
                            "repro": state.repro.test_path if state.repro else None,
                            "stop_reason": state.stop_reason,
                            "no_bug_reason": state.no_bug_reason,
                            "tokens": state.budget_used.tokens,
                            "cost_usd": round(state.budget_used.cost_usd, 4),
                            "artefacts": str(run.kept_artefacts),
                            "trace": state.trace_url,
                            "patch": state.patch.diff_path if state.patch else None,
                            "pr": state.pr_url,
                            "risk_level": state.risk_level,
                        },
                        indent=1,
                    )
                )
                if state.status == "awaiting_human":
                    typer.echo(
                        f"paused for approval: bug-hunter resume {run.run_id} "
                        "--approve|--reject --reason '…'"
                    )
    except CheckpointerError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)


@app.command("resume")
def resume_cmd(
    run_id: Annotated[str, typer.Argument(help="The run paused at human_approval.")],
    approve: Annotated[
        bool, typer.Option("--approve", help="Approve the fix.")
    ] = False,
    reject: Annotated[bool, typer.Option("--reject", help="Reject the fix.")] = False,
    reason: Annotated[str, typer.Option(help="One line; required for reject.")] = "",
    by: Annotated[str, typer.Option(help="Who decided (default: $USER).")] = "",
) -> None:
    """Record the human decision and continue the paused run (chunk 09 adds the UI)."""
    import json as _json
    import os as _os

    from bug_hunter.graph.approvals import PostgresApprovals
    from bug_hunter.graph.build import build_graph, run_graph
    from bug_hunter.graph.checkpointer import (
        CheckpointerError,
        db_url,
        open_checkpointer,
    )
    from bug_hunter.graph.deps import GraphDeps
    from bug_hunter.runs import Run

    if approve == reject:
        typer.echo("give exactly one of --approve or --reject", err=True)
        raise typer.Exit(code=1)
    if reject and not reason.strip():
        typer.echo("--reject needs --reason", err=True)
        raise typer.Exit(code=1)
    config = _load_or_exit()
    decision = {
        "decision": "approved" if approve else "rejected",
        "by": by or _os.environ.get("USER", "unknown"),
        "reason": reason,
    }
    try:
        with open_checkpointer() as saver:
            thread = {"configurable": {"thread_id": run_id}}
            history = list(saver.list(thread, limit=1))
            if not history:
                typer.echo(f"{run_id}: no checkpoints", err=True)
                raise typer.Exit(code=1)
            values = history[0].checkpoint.get("channel_values", {})
            if values.get("status") != "awaiting_human":
                typer.echo(
                    f"{run_id}: not awaiting approval (status {values.get('status')})"
                )
                raise typer.Exit(code=1)
            app_name = values["app"]
            ref = values.get("ref") or "origin/master"
            mode = values.get("mode") or "issue"
            with Run.start(config, app_name, ref, run_id=f"{run_id}-resume") as run:
                deps = GraphDeps.for_run(
                    config,
                    run,
                    app_name,
                    mode,
                    ref=ref,
                    checkpointer=saver,
                    with_repo_map=False,
                )
                deps.run_id = run_id
                deps.approvals = PostgresApprovals(db_url())
                graph = build_graph(deps, saver)
                state = run_graph(graph, deps, None, resume_with=decision)
                typer.echo(
                    _json.dumps(
                        {
                            "run_id": run_id,
                            "status": state.status,
                            "decision": state.approval_decision,
                            "reason": state.approval_reason,
                        },
                        indent=1,
                    )
                )
    except CheckpointerError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)


db_app = typer.Typer(help="The bug hunter's own Postgres: checkpoints and approvals.")
app.add_typer(db_app, name="db")


@db_app.command("migrate")
def db_migrate() -> None:
    """Apply bug-hunter/migrations/*.sql (approvals table) to the bughunter database."""
    from bug_hunter.graph.approvals import PostgresApprovals
    from bug_hunter.graph.checkpointer import db_url

    applied = PostgresApprovals.migrate(db_url())
    typer.echo("applied: " + ", ".join(applied))


@app.command("replay")
def replay_cmd(
    run_id: Annotated[str, typer.Argument(help="The run to inspect or resume.")],
    resume: Annotated[
        bool,
        typer.Option("--resume", help="Continue the run from its last checkpoint."),
    ] = False,
    steps: Annotated[int, typer.Option(help="How many checkpoints to list.")] = 20,
) -> None:
    """List a run's checkpoints (node, status, cost), or resume a killed run."""
    import json as _json

    from bug_hunter.graph.build import build_graph, run_config
    from bug_hunter.graph.checkpointer import CheckpointerError, open_checkpointer
    from bug_hunter.graph.deps import GraphDeps
    from bug_hunter.graph.state import BugState
    from bug_hunter.runs import Run

    config = _load_or_exit()
    try:
        with open_checkpointer() as saver:
            thread = {"configurable": {"thread_id": run_id}}
            history = list(saver.list(thread, limit=steps))
            if not history:
                typer.echo(f"{run_id}: no checkpoints", err=True)
                raise typer.Exit(code=1)
            latest = history[0]
            values = latest.checkpoint.get("channel_values", {})
            for item in reversed(history):
                vals = item.checkpoint.get("channel_values", {})
                budget = vals.get("budget_used")
                cost = getattr(budget, "cost_usd", None) if budget is not None else None
                typer.echo(
                    f"{item.checkpoint['ts']}  step {item.metadata.get('step')}  "
                    f"source={item.metadata.get('source')}  "
                    f"status={vals.get('status')}  "
                    f"cost=${cost if cost is not None else 0:.3f}"
                )
            if not resume:
                return
            status = values.get("status")
            app_name = values.get("app")
            ref = values.get("ref") or "origin/master"
            mode = values.get("mode") or "issue"
            if status in ("escalated", "closed_not_bug", "closed_duplicate", "failed"):
                typer.echo(f"{run_id}: already finished ({status}); nothing to resume")
                return
            with Run.start(config, app_name, ref, run_id=f"{run_id}-resume") as run:
                deps = GraphDeps.for_run(
                    config, run, app_name, mode, ref=ref, checkpointer=saver
                )
                deps.run_id = run_id  # same thread, so the graph continues it
                graph = build_graph(deps, saver)
                final = graph.invoke(None, run_config(deps))
                state = (
                    final
                    if isinstance(final, BugState)
                    else BugState.model_validate(final)
                )
                typer.echo(
                    _json.dumps(
                        {
                            "run_id": run_id,
                            "status": state.status,
                            "stop_reason": state.stop_reason,
                        },
                        indent=1,
                    )
                )
    except CheckpointerError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
