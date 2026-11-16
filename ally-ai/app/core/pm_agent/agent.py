"""The PM agent: one `create_deep_agent` (spec C1, D7), built by one builder for
the weekly run and the console conversation. No outer graph.

Both share:

- planning: LangChain's todo list (`write_todos`);
- subagents, read-only tools only (they replace the default general-purpose
  subagent, so no subagent can act):
  - the investigator (`general-purpose`): one problem, several lookups;
  - the reviewer: one proposed change, fresh context, three questions; its
    structured verdict is stored by code (`ReviewRecorder`), not by the model,
    and sets the change's confidence;
- memory: `/memories/` is the Postgres store in the agent's own namespace
  (`MEMORY_NAMESPACE`), loaded at the start of every run (`memory=`). The weekly
  run and the conversation read and write the same file, so what a person tells
  the agent in the console is there for the next weekly run, and the reverse;
- skills: `/skills/` is this package's `skills/` folder, read-only;
- drafts: every other path is scratch state for this thread only.

What differs is the tool set, the instructions, the thread and `interrupt_on`:
the conversation pauses an approval, a turn-down and an always-ask retry for the
person's yes (LangGraph human-in-the-loop); the weekly run never pauses (people
approve in the Console days later).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional

from deepagents import FilesystemPermission, create_deep_agent
from deepagents.backends import (
    CompositeBackend,
    FilesystemBackend,
    StateBackend,
    StoreBackend,
)
from deepagents.backends.utils import create_file_data
from langchain.agents.middleware import (
    AgentMiddleware,
    InterruptOnConfig,
    ToolCallRequest,
    TodoListMiddleware,
)
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.store.base import BaseStore
from langgraph.types import Command
from pydantic import BaseModel, Field

from app.core.debrief_graph.gateway import Gateway, GatewayError
from app.core.pm_agent.ledger import RunLedger, now_ms
from app.core.pm_agent.middleware import PmRunGuard
from app.core.pm_agent.store import MEMORY_NAMESPACE
from app.core.pm_agent.tools import SUBAGENT_READ_TOOLS

SKILLS_DIR = Path(__file__).parent / "skills"
MEMORY_FILE = "/memories/AGENTS.md"
REVIEWER = "reviewer"
#: The gateway call that stores the reviewer's verdict (code calls it, never a model).
REVIEW_RECORD_TOOL = "change_review_record"

MEMORY_SEED = """\
# PM agent memory

Nothing recorded yet. Keep here: what you tried and why, what happened to it, open
hypotheses, and what people told you in the console that should shape later work
(for example how a language or an organisation differs). Rewrite rather than append
forever.
"""

INVESTIGATOR_PROMPT = """\
You investigate one problem for the Debrief PM agent and report back. You can query \
the redacted reporting views, read expert comments and the metric failure points. \
You cannot change anything. Return: what you checked, the numbers (with n), the \
comment ids that bear on it, and your best explanation with how sure you are. \
Never paste learner words; cite ids instead. Keep the report under 300 words.\
"""

REVIEWER_PROMPT = """\
You review one change the Debrief PM agent proposed, before it is tried on \
learners. You get its id and nothing else: read it with change_read (its \
evidence, wording or rule text, languages) and check the evidence yourself with \
the read-only tools. You cannot change anything.

Answer three questions, each "yes", "no" or "unclear", with the evidence for your \
answer (numbers with n, comment ids, metric names):
1. supported: does the evidence support this change?
2. fits_everywhere: does it fit every language and every organisation it would \
reach? A change written for one language or organisation that would reach others \
is not a yes.
3. safe: is it free of risk to safety: risk cues, crisis lines and support copy, \
learners in distress? Anything that touches those, or that you cannot rule out, is \
not a yes.

Say "unclear" whenever you are not sure; never guess "yes". Never paste learner \
words; cite ids.\
"""


class ReviewAnswer(BaseModel):
    answer: Literal["yes", "no", "unclear"]
    evidence: str = Field(
        description="The evidence for this answer: numbers with n, comment ids, "
        "metric names. One or two sentences; no learner words."
    )


class ReviewVerdict(BaseModel):
    """The reviewer's answer on one change."""

    idea_id: str = Field(description="The id of the change you reviewed.")
    supported: ReviewAnswer
    fits_everywhere: ReviewAnswer
    safe: ReviewAnswer


def verdict_confidence(v: ReviewVerdict) -> Dict[str, str]:
    """The change's confidence from the verdict: high only when all three are yes."""
    parts = {
        "supported": ("The evidence supports it", "The evidence may not support it"),
        "fits_everywhere": (
            "it fits every language and organisation it reaches",
            "it may not fit every language or organisation it reaches",
        ),
        "safe": ("no safety risk found", "it may touch safety"),
    }
    weak = [k for k in parts if getattr(v, k).answer != "yes"]
    if not weak:
        return {
            "level": "high",
            "why": "Reviewer: "
            + "; ".join(parts[k][0] for k in parts)
            + f". {v.supported.evidence}"[:200],
        }
    return {
        "level": "low",
        "why": (
            "Reviewer: "
            + "; ".join(f"{parts[k][1]} ({getattr(v, k).evidence})" for k in weak)
        )[:300],
    }


class ReviewRecorder(AgentMiddleware):
    """Stores each reviewer verdict through the gateway, in code.

    The reviewer answers in a structured verdict (`ReviewVerdict`, the
    subagent's `response_format`); after the `task` call returns, this posts it
    as `change_review_record`. The main agent never has a tool that records a
    verdict, so the confidence it states on `idea_propose` stays advisory.
    """

    def __init__(self, gateway: Gateway, ledger: RunLedger) -> None:
        super().__init__()
        self.gateway = gateway
        self.ledger = ledger

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[Any]],
    ):
        result = await handler(request)
        call = request.tool_call
        args = call.get("args") or {}
        if call.get("name") != "task" or args.get("subagent_type") != REVIEWER:
            return result
        message = _tool_message(result)
        if message is None:
            return result
        note = await self._record(str(args.get("description") or ""), message)
        message.content = f"{message.content}\n\n{note}"
        return result

    async def _record(self, description: str, message: ToolMessage) -> str:
        t0 = now_ms()
        try:
            verdict = ReviewVerdict.model_validate_json(str(message.content))
        except ValueError:
            return (
                "Not recorded: the reviewer gave no verdict, so the change "
                "stays low confidence."
            )
        if verdict.idea_id not in description:
            return (
                "Not recorded: the verdict is for a change the reviewer was not "
                "asked about."
            )
        confidence = verdict_confidence(verdict)
        body = {
            "idea_id": verdict.idea_id,
            **{
                k: getattr(verdict, k).model_dump()
                for k in ("supported", "fits_everywhere", "safe")
            },
        }
        status = "done"
        try:
            res = await self.gateway.call(REVIEW_RECORD_TOOL, body)
        except GatewayError as e:
            res = {"refused": str(e)}
        if isinstance(res, dict) and res.get("refused"):
            status = "refused"
            self.ledger.refusals.append(
                {"tool": REVIEW_RECORD_TOOL, "reason": str(res["refused"])}
            )
        self.ledger.record(
            t0,
            step=REVIEW_RECORD_TOOL,
            agent="main",
            status=status,
            output=json.dumps(
                {"idea_id": verdict.idea_id, "level": confidence["level"]}
            ),
        )
        if status != "done":
            return (
                f"Not recorded ({res.get('refused')}); the change stays low confidence."
            )
        return (
            f"Recorded: the change's confidence is {confidence['level']} "
            f"({confidence['why']})."
        )


def _tool_message(result: Any) -> Optional[ToolMessage]:
    if isinstance(result, ToolMessage):
        return result
    if isinstance(result, Command) and isinstance(result.update, dict):
        msgs = result.update.get("messages") or []
        if msgs and isinstance(msgs[-1], ToolMessage):
            return msgs[-1]
    return None


#: Subagents read files (skills, memory, drafts) but never write one: no
#: subagent can change the agent's memory or leave a draft behind.
READ_ONLY_FILES = [
    FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")
]
#: The main agent writes memory and drafts, never a skill.
MAIN_FILES = [
    FilesystemPermission(operations=["write"], paths=["/skills/**"], mode="deny")
]


def build_backend(store: BaseStore) -> CompositeBackend:
    return CompositeBackend(
        default=StateBackend(),
        routes={
            "/memories/": StoreBackend(
                namespace=lambda _rt: MEMORY_NAMESPACE, store=store
            ),
            "/skills/": FilesystemBackend(root_dir=SKILLS_DIR, virtual_mode=True),
        },
    )


async def seed_memory(store: BaseStore) -> None:
    """The memory file exists from the first run, so reading it never fails."""
    if await store.aget(MEMORY_NAMESPACE, "/AGENTS.md") is None:
        await store.aput(MEMORY_NAMESPACE, "/AGENTS.md", create_file_data(MEMORY_SEED))


def build_pm_deep_agent(
    *,
    ledger: RunLedger,
    tools: List[BaseTool],
    models: Dict[str, BaseChatModel],
    primary: str,
    backup: Optional[str],
    system_prompt: str,
    store: BaseStore,
    checkpointer: Optional[BaseCheckpointSaver],
    gateway: Gateway,
    name: str,
    label: str = "main",
    interrupt_on: Optional[Dict[str, bool | InterruptOnConfig]] = None,
    context_schema: Optional[type] = None,
):
    """The one PM agent harness: same memory, skills, subagents and run guard for
    every caller; the caller picks the tools, instructions and `interrupt_on`."""
    first = next(m for m in (primary, backup, *models) if m and m in models)
    read_tools = [t for t in tools if t.name in SUBAGENT_READ_TOOLS]
    investigator = {
        # The default subagent's name: replacing it keeps action tools off every
        # subagent.
        "name": "general-purpose",
        "description": (
            "Investigates one problem with read-only tools (reporting SQL, comments, "
            "metrics) and returns findings. Only for questions that need several "
            "lookups; give it the whole question in one go."
        ),
        "system_prompt": INVESTIGATOR_PROMPT,
        "tools": read_tools,
        "model": models[first],
        "middleware": [PmRunGuard(ledger, models, primary, backup, "investigator")],
        "permissions": READ_ONLY_FILES,
        # Read-only: nothing it can call ever pauses for a person.
        "interrupt_on": {},
    }
    reviewer = {
        "name": REVIEWER,
        "description": (
            "Reviews one proposed change before it is tried: give it only the "
            "change's id. Answers whether the evidence supports it, whether it fits "
            "every language and organisation it reaches, and whether it could hurt "
            "safety. Its verdict sets the change's confidence."
        ),
        "system_prompt": REVIEWER_PROMPT,
        "tools": read_tools,
        "model": models[first],
        "middleware": [PmRunGuard(ledger, models, primary, backup, "reviewer")],
        "response_format": ToolStrategy(ReviewVerdict),
        "permissions": READ_ONLY_FILES,
        "interrupt_on": {},
    }
    return create_deep_agent(
        model=models[first],
        tools=tools,
        system_prompt=system_prompt,
        # Planning: this deepagents line no longer adds the todo list by default.
        middleware=[
            TodoListMiddleware(),
            PmRunGuard(ledger, models, primary, backup, label),
            ReviewRecorder(gateway, ledger),
        ],
        subagents=[investigator, reviewer],
        skills=["/skills/"],
        memory=[MEMORY_FILE],
        permissions=MAIN_FILES,
        backend=build_backend(store),
        store=store,
        checkpointer=checkpointer,
        interrupt_on=interrupt_on,
        context_schema=context_schema,
        name=name,
    )


def build_pm_agent(
    *,
    ledger: RunLedger,
    tools: List[BaseTool],
    models: Dict[str, BaseChatModel],
    primary: str,
    backup: Optional[str],
    system_prompt: str,
    store: BaseStore,
    checkpointer: Optional[BaseCheckpointSaver],
    gateway: Gateway,
):
    """The weekly (monthly, questions) run: never pauses."""
    return build_pm_deep_agent(
        ledger=ledger,
        tools=tools,
        models=models,
        primary=primary,
        backup=backup,
        system_prompt=system_prompt,
        store=store,
        checkpointer=checkpointer,
        gateway=gateway,
        name="debrief_pm_agent",
    )
