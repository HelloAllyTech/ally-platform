"""List tools (chunk 6): `find_<list>`, `create_<list>` and `update_<list>`.

ally-be generates each one from a list's definition and sends it in the gateway
block as `{name, description, input_schema, kind}`. Here each definition becomes a
gateway tool at run time: there is no module per list. The input model is built
from the schema (flat: strings, whole numbers and enums, each with an empty
default, as the step schema needs) and cached on the definition's hash, so the
same list gives the same class and the step schema's own cache keeps hitting,
while the cache can't grow without bound.

What the gateway returns becomes passages: a find's records, a write's record, a
refusal's alternatives, numbered after the run's passages and cited like a
document's. They are not searches, and "found nothing new" doesn't apply to them.
"""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from functools import lru_cache
from typing import Any, Dict, List, Mapping, Optional, Tuple, Type

from pydantic import BaseModel, ConfigDict, Field, create_model

from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult

#: At most this many definitions a run (ally-be caps them too).
MAX_LIST_TOOLS = 12
#: Built input models kept; a bot has at most 12 list tools a run.
_MODEL_CACHE_SIZE = 64

LIST_TOOL_KINDS = ("find", "create", "update")


def _canonical(definition: Mapping[str, Any]) -> str:
    """One definition as text. Not key-sorted: the order of its fields is the order
    ally-be chose (the list's field order), and the model sees them in it."""
    return json.dumps(definition, separators=(",", ":"), ensure_ascii=False)


def definition_key(definition: Mapping[str, Any]) -> str:
    """A hash of one definition: the cache key for its input model."""
    return hashlib.sha256(_canonical(definition).encode()).hexdigest()


def _field_type(name: str, index: int, spec: Mapping[str, Any]) -> Tuple[Any, Any]:
    description = str(spec.get("description") or name)
    values = spec.get("enum")
    if isinstance(values, list) and values:
        members = {f"v{i}": str(value) for i, value in enumerate(values)}
        enum = Enum(f"{name.title().replace('_', '')}{index}", members, type=str)
        default = str(spec.get("default", values[0]))
        return enum, Field(
            enum(default) if default in members.values() else enum(str(values[0])),
            alias=name,
            description=description,
        )
    if spec.get("type") == "integer":
        default = spec.get("default", 0)
        return int, Field(
            int(default) if isinstance(default, (int, float)) else 0,
            alias=name,
            description=description,
        )
    return str, Field(
        str(spec.get("default") or ""), alias=name, description=description
    )


@lru_cache(maxsize=_MODEL_CACHE_SIZE)
def _input_model(key: str, canonical: str) -> Type[BaseModel]:
    definition = json.loads(canonical)
    properties: Dict[str, Any] = (definition.get("input_schema") or {}).get(
        "properties"
    ) or {}
    fields: Dict[str, Any] = {}
    for index, (name, spec) in enumerate(properties.items()):
        # Field keys are any `[a-z0-9_]` slug: one that starts with `_` or a digit
        # isn't a Python name, so each field has a safe name and the key as alias.
        fields[f"f{index}"] = _field_type(name, index, spec or {})
    return create_model(
        f"Input_{definition['name']}",
        __config__=ConfigDict(populate_by_name=True, extra="ignore"),
        **fields,
    )


def input_model_for(definition: Mapping[str, Any]) -> Type[BaseModel]:
    """The definition's input model: one class per distinct definition."""
    canonical = _canonical(definition)
    return _input_model(definition_key(definition), canonical)


def _prepare(args: BaseModel) -> Dict[str, Any]:
    """The body's `input`: the schema's keys, empty values left out."""
    body = args.model_dump(mode="json", by_alias=True)
    return {key: value for key, value in body.items() if value not in ("", None)}


def record_passages(
    raw: Any, first_number: int
) -> Tuple[List[Dict[str, Any]], List[int]]:
    """ally-be's record passages as the run's passages, numbered from
    `first_number`: the list as the title, the record's title as the section, its
    id as the chunk id. Cited like a document passage, with `record_id` set."""
    passages: List[Dict[str, Any]] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not item.get("record_id"):
            continue
        passages.append(
            {
                "chunk_id": str(item["record_id"]),
                "record_id": str(item["record_id"]),
                "document_id": "",
                "document_title": str(item.get("list") or ""),
                "section_path": str(item.get("record_title") or ""),
                "page_from": 0,
                "page_to": 0,
                "source_url": "",
                "similarity": 0.0,
                "text": str(item.get("text") or ""),
            }
        )
    numbers = list(range(first_number, first_number + len(passages)))
    return passages, numbers


def list_tool(definition: Mapping[str, Any]) -> Tool:
    """One definition as a gateway tool."""
    name = str(definition["name"])
    kind = str(definition.get("kind") or "find")

    async def handler(args: BaseModel, ctx: ToolContext) -> ToolResult:
        if ctx.gateway is None or ctx.run_id is None or ctx.step is None:
            outcome: Dict[str, Any] = {"ok": False, "error": "no_gateway"}
        else:
            outcome = await ctx.gateway.call(
                name, run_id=ctx.run_id, step=ctx.step, input=_prepare(args)
            )
        ok = bool(outcome.get("ok"))
        result = (
            outcome.get("result") if isinstance(outcome.get("result"), dict) else {}
        )
        passages, added = record_passages(result.get("passages"), len(ctx.passages) + 1)
        record: Dict[str, Any] = {
            "tool": name,
            "kind": "gateway",
            "list_kind": kind,
            "ok": ok,
            "added": added,
        }
        if ok and kind == "find":
            if isinstance(result.get("total"), int):
                record["total"] = result["total"]
            aggregate = result.get("aggregate")
            if isinstance(aggregate, dict) and "value" in aggregate:
                record["aggregate"] = {
                    "kind": str(aggregate.get("kind") or ""),
                    "value": aggregate.get("value"),
                }
        if not ok:
            record["error"] = str(outcome.get("error") or "failed")
            message = result.get("message")
            if isinstance(message, str) and message:
                # A refusal from the list's rules: copy deck §26, plain words.
                record["message"] = message[:300]
        summary = (
            f"{name}: ok, {len(added)} record" + ("" if len(added) == 1 else "s")
            if ok
            else f"{name}: error {record['error']}"
        )
        return ToolResult(passages=passages, summary=summary, record=record)

    return Tool(
        name=name,
        description=str(definition.get("description") or ""),
        input_model=input_model_for(definition),
        risk="low" if kind == "find" else "medium",
        handler=handler,
        kind="gateway",
    )


@lru_cache(maxsize=_MODEL_CACHE_SIZE)
def _tool(key: str, canonical: str) -> Tool:
    return list_tool(json.loads(canonical))


def list_tools(definitions: Optional[List[Mapping[str, Any]]]) -> List[Tool]:
    """The run's list tools, in the order ally-be sent them."""
    tools: List[Tool] = []
    for definition in (definitions or [])[:MAX_LIST_TOOLS]:
        tools.append(_tool(definition_key(definition), _canonical(definition)))
    return tools


def offers_create(definitions: Optional[List[Mapping[str, Any]]]) -> bool:
    """Whether this run can book or add something: any create tool."""
    return any((d or {}).get("kind") == "create" for d in definitions or [])
