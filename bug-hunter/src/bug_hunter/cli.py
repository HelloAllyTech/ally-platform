"""``bug-hunter`` command line.

Chunk 01 ships ``bug-hunter config check``. ``run``, ``sweep``, ``eval`` and
``replay`` arrive with the chunks that build them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

from bug_hunter.config import ROLES, BugHunterConfig, ConfigError, load_config

app = typer.Typer(
    help="Bug Hunter v2: finds and fixes bugs in the ally-platform apps.",
    no_args_is_help=True,
)
config_app = typer.Typer(help="Inspect and validate the configuration.")
app.add_typer(config_app, name="config")


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
