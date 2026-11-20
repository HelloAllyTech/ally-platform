"""How each analysis agent is described to the planner (2026-11-16).

The wording (`description`, `use_when`, `skip_when`) lives in the Skills Store
prompt ``debrief_planner_agents`` so a person can change how the planner
chooses; the ids and every machine field (scopes, costs, requires, how it runs)
stay in the manifests. The manifests' own wording is the default, and ally-be's
``src/prompts/debrief/planner_agents.txt`` must equal ``render_default()``.

The format, one section per agent::

    ## protocol_check
    description: ...
    use_when: ...
    skip_when: ...

Text before the first section is for the editor and is ignored. An agent or a
field the live text leaves out keeps the manifest's wording.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

PROMPT_CODE = "debrief_planner_agents"
FIELDS = ("description", "use_when", "skip_when")

HEADER = """\
How the planner sees each analysis agent it may choose. One section per agent: \
a line "## <agent id>", then "description:", "use_when:" and "skip_when:", one \
line each. The ids are fixed in code; change only the wording after each colon.\
"""

_SECTION = re.compile(r"^##\s+(\S+)\s*$", re.M)
_FIELD = re.compile(r"^(description|use_when|skip_when):\s*(.*\S)\s*$")


def parse(text: Optional[str]) -> Dict[str, Dict[str, str]]:
    """{agent id: {field: wording}} from the live text; {} when there is none."""
    out: Dict[str, Dict[str, str]] = {}
    if not text:
        return out
    marks = list(_SECTION.finditer(text))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        fields: Dict[str, str] = {}
        for line in text[m.end() : end].splitlines():
            f = _FIELD.match(line.strip())
            if f:
                fields[f.group(1)] = f.group(2)
        if fields:
            out[m.group(1)] = fields
    return out


def with_wording(card: Dict[str, Any], wording: Dict[str, Dict[str, str]]):
    """The planner's card with the live wording for its agent, if any."""
    live = wording.get(card.get("id")) or {}
    return {**card, **{k: live[k] for k in FIELDS if live.get(k)}}


def render_default() -> str:
    """The default text: the header, then every plannable agent's wording."""
    from app.core.debrief_graph.registry import agents  # noqa: F401 - registers
    from app.core.debrief_graph.registry.manifest import REGISTRY

    parts = [HEADER]
    for m in REGISTRY.values():
        if m.floor:
            continue
        parts.append(
            "\n".join(
                [
                    f"## {m.id}",
                    f"description: {' '.join(m.description.split())}",
                    f"use_when: {' '.join(m.use_when.split())}",
                    f"skip_when: {' '.join(m.skip_when.split())}",
                ]
            )
        )
    return "\n\n".join(parts) + "\n"
