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


if __name__ == "__main__":
    app()
