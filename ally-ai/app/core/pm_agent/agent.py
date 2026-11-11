"""The PM agent: one `create_deep_agent` (spec C1, D7). No outer graph.

- planning: LangChain's todo list (`write_todos`);
- subagents: one investigator per problem, via `task`, with the read-only tools
  only (it replaces the default general-purpose subagent, so no subagent can act);
- memory: `/memories/` is the Postgres store in the agent's own namespace,
  loaded at the start of every run (`memory=`);
- skills: `/skills/` is this package's `skills/` folder, read-only;
- drafts: every other path is scratch state for this run only.

Action tools stay on the main agent. `interrupt_on` is not used today: people
approve in the Console days later, without holding the run paused. A tool that
should pause a run later goes in `interrupt_on` here, on the main agent only.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from deepagents import FilesystemPermission, create_deep_agent
from deepagents.backends import (
    CompositeBackend,
    FilesystemBackend,
    StateBackend,
    StoreBackend,
)
from langchain.agents.middleware import TodoListMiddleware
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.store.base import BaseStore

from app.core.pm_agent.ledger import RunLedger
from app.core.pm_agent.middleware import PmRunGuard
from app.core.pm_agent.store import MEMORY_NAMESPACE
from app.core.pm_agent.tools import READ_TOOLS

SKILLS_DIR = Path(__file__).parent / "skills"
MEMORY_FILE = "/memories/AGENTS.md"

INVESTIGATOR_PROMPT = """\
You investigate one problem for the Debrief PM agent and report back. You can query \
the redacted reporting views, read expert comments and the metric failure points. \
You cannot change anything. Return: what you checked, the numbers (with n), the \
comment ids that bear on it, and your best explanation with how sure you are. \
Never paste learner words; cite ids instead. Keep the report under 300 words.\
"""


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
):
    first = next(m for m in (primary, backup, *models) if m and m in models)
    read_tools = [t for t in tools if t.name in READ_TOOLS]
    investigator = {
        # The default subagent's name: replacing it keeps action tools off every
        # subagent.
        "name": "general-purpose",
        "description": (
            "Investigates one problem with read-only tools (reporting SQL, comments, "
            "metrics) and returns findings. Give it the whole question in one go."
        ),
        "system_prompt": INVESTIGATOR_PROMPT,
        "tools": read_tools,
        "model": models[first],
        "middleware": [PmRunGuard(ledger, models, primary, backup, "investigator")],
    }
    return create_deep_agent(
        model=models[first],
        tools=tools,
        system_prompt=system_prompt,
        # Planning: this deepagents line no longer adds the todo list by default.
        middleware=[
            TodoListMiddleware(),
            PmRunGuard(ledger, models, primary, backup, "main"),
        ],
        subagents=[investigator],
        skills=["/skills/"],
        memory=[MEMORY_FILE],
        permissions=[
            FilesystemPermission(
                operations=["write"], paths=["/skills/**"], mode="deny"
            )
        ],
        backend=build_backend(store),
        store=store,
        checkpointer=checkpointer,
        name="debrief_pm_agent",
    )
