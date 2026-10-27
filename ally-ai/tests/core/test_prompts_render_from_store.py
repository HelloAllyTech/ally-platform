"""Every prompt this service renders must come from the Skills Store.

ally-be sends each prompt's live version in the request (`prompts`). A render
call that leaves it out silently runs the local default instead, and the
defaults in Git are minimal bases, not the tuned text. So every
`load_and_format` / `load_template` / `get_backend_llm_overrides` call in app/
must pass the request's prompts.
"""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[2] / "app"
RENDERERS = {"load_and_format", "load_template", "get_backend_llm_overrides"}


def _calls_without_prompts() -> list[str]:
    found = []
    for path in sorted(APP_DIR.rglob("*.py")):
        if path.parent == APP_DIR / "prompts":
            continue  # the resolver itself
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name not in RENDERERS:
                continue
            passes = len(node.args) >= 2 or any(
                kw.arg == "prompts" for kw in node.keywords
            )
            if not passes:
                found.append(f"{path.relative_to(APP_DIR.parent)}:{node.lineno}")
    return found


def test_every_render_passes_the_requests_prompts():
    missing = _calls_without_prompts()
    assert not missing, (
        f"These render calls don't pass the request's prompts, so they ignore the "
        f"Skills Store and run the local default: {missing}"
    )
