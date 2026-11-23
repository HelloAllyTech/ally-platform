"""App context pulls the right pieces out of the root CLAUDE.md and AGENTS.md."""

from __future__ import annotations

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.app_context import load_app_context


def test_mobile_context_carries_the_dart_format_rule(config: BugHunterConfig) -> None:
    ctx = load_app_context(config, "ally-mobile", "HEAD")
    assert "dart format" in ctx.stack_rules and "flutter test" in ctx.stack_rules
    assert ctx.app_notes == "Never run dart format on this app."
    assert (
        "flutter test --no-pub" in ctx.verified_commands
    )  # from apps.yaml: no CLAUDE.md block
    assert ctx.agents_md.startswith("# ally-mobile")
    assert "Flutter" in ctx.repo_row


def test_be_context_uses_the_verified_commands_block(config: BugHunterConfig) -> None:
    ctx = load_app_context(config, "ally-be", "HEAD")
    assert "npm test -- --forceExit --detectOpenHandles" in ctx.verified_commands
    assert "Node 24" in ctx.verified_commands
    assert "Prettier" in ctx.stack_rules
    short = ctx.render_short()
    assert "AGENTS.md" not in short and "Verified commands" in short
    assert "## AGENTS.md" in ctx.render()


def test_context_is_cached_per_commit(config: BugHunterConfig) -> None:
    a = load_app_context(config, "ally-ai", "c1")
    b = load_app_context(config, "ally-ai", "c1")
    c = load_app_context(config, "ally-ai", "c2")
    assert a is b and a is not c
