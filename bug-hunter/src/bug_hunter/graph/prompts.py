"""Versioned prompt files: ``prompts/<node>.<version>.md`` (spec §11). The first line
is a header listing the input variables; ``render`` substitutes ``$name`` and refuses
missing or unknown variables so a prompt and its node cannot drift apart silently.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from string import Template

from bug_hunter.config import PACKAGE_ROOT, BugHunterConfig

PROMPTS_DIR = PACKAGE_ROOT / "prompts"
_HEADER = re.compile(r"^<!--\s*inputs:\s*(.*?)\s*-->\s*\n", re.DOTALL)


class PromptError(ValueError):
    pass


@dataclass(frozen=True)
class Prompt:
    node: str
    version: str
    inputs: tuple[str, ...]
    text: str

    @property
    def name(self) -> str:
        return f"{self.node}.{self.version}"

    def render(self, **values: str) -> str:
        missing = [name for name in self.inputs if name not in values]
        unknown = [name for name in values if name not in self.inputs]
        if missing or unknown:
            raise PromptError(
                f"{self.name}: missing inputs {missing}, unknown inputs {unknown}"
            )
        return Template(self.text).safe_substitute(values)


def load_prompt(
    config: BugHunterConfig, node: str, prompts_dir: Path = PROMPTS_DIR
) -> Prompt:
    version = config.models.prompts.get(node)
    if version is None:
        raise PromptError(f"models.yaml has no prompt version for node {node!r}")
    path = prompts_dir / f"{node}.{version}.md"
    if not path.is_file():
        raise PromptError(f"{path}: prompt file not found")
    raw = path.read_text(encoding="utf-8")
    match = _HEADER.match(raw)
    if not match:
        raise PromptError(f"{path}: first line must be '<!-- inputs: a, b -->'")
    inputs = tuple(x.strip() for x in match.group(1).split(",") if x.strip())
    return Prompt(node, version, inputs, raw[match.end() :])


def prompt_versions(config: BugHunterConfig) -> str:
    return ", ".join(f"{n}.{v}" for n, v in sorted(config.models.prompts.items()))
