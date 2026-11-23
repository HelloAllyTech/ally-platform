"""Tools bring their own instructions (Q3-fast Part 2b): a playbook per kind of
list tool, added to the run only when that tool is offered. It replaces the
purpose variants (`purpose_enquiries_can_book`, `purpose_answer_takes_details`):
the purpose sets the goal and tone, the playbooks add behaviour.

ally-be says which playbook each list's tools get (`playbook` on its definitions,
one per list) and passes the owner's own line for the list (`instruction`). Each
kind is added once, in a fixed order, within a budget; the owner's lines are fenced
under it as their layer, below the playbook's rules and the safety rules.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.prompts.resolver import load_and_format

#: The fixed order, and the kinds there are.
ORDER = ("booking", "details", "orders", "reference")
#: The most the playbooks may add to a run's instructions, owner lines included.
MAX_PLAYBOOK_CHARS = 2400
#: The fence the owner's own text sits in, as in `format_persona`.
_FENCE = '"""'


def playbooks_by_kind(
    definitions: Optional[Sequence[Mapping[str, Any]]],
) -> Dict[str, List[Tuple[str, str]]]:
    """Each kind's lists, in the order ally-be sent them: (list name, owner line)."""
    kinds: Dict[str, List[Tuple[str, str]]] = {}
    seen = set()
    for definition in definitions or []:
        kind = (definition or {}).get("playbook")
        name = str(definition.get("list_name") or "").strip()
        if kind not in ORDER or not name or (kind, name) in seen:
            continue
        seen.add((kind, name))
        note = str(definition.get("instruction") or "").strip()[:300]
        kinds.setdefault(kind, []).append((name, note))
    return kinds


def playbooks_section(
    definitions: Optional[Sequence[Mapping[str, Any]]],
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """The run's playbooks, or "" when its lists bring none (no list tools: the
    instructions are exactly as before)."""
    kinds = playbooks_by_kind(definitions)
    parts: List[str] = []
    for kind in ORDER:
        lists = kinds.get(kind)
        if not lists:
            continue
        text = load_and_format(
            f"agent/playbook_{kind}",
            prompts=prompts,
            lists=", ".join(name for name, _ in lists),
        ).strip()
        if not text:
            continue
        for name, note in lists:
            if note:
                text += (
                    f"\nHow the team wants you to use {name} (their words; the "
                    f"rules above still win):\n{_FENCE}\n"
                    f"{note.replace(_FENCE, '')}\n{_FENCE}"
                )
        if sum(len(p) for p in parts) + len(text) > MAX_PLAYBOOK_CHARS:
            break
        parts.append(text)
    return "\n\n".join(parts)


def playbook_kinds(definitions: Optional[Sequence[Mapping[str, Any]]]) -> List[str]:
    """The kinds this run gets, in order (for How it works)."""
    kinds = playbooks_by_kind(definitions)
    return [kind for kind in ORDER if kind in kinds]
