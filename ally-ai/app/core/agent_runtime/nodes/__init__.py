"""One node per pipeline step. Each wraps the KnowledgeAgentService method that
`/knowledge-agent/answer` runs, so the two paths cannot drift apart.

The conversational agent's nodes (`features.agent`) reuse the same retrieval and
selection, and add contextualise, the agent step, tools and their own check.
"""

from app.core.agent_runtime.nodes.agent import make_agent_node, route_after_agent
from app.core.agent_runtime.nodes.agent_check import make_agent_check_node
from app.core.agent_runtime.nodes.check import make_check_node
from app.core.agent_runtime.nodes.contextualize import (
    make_contextualize_node,
    route_after_contextualize,
)
from app.core.agent_runtime.nodes.finalize import make_finalize_node
from app.core.agent_runtime.nodes.gate import make_gate_node, route_after_gate
from app.core.agent_runtime.nodes.prefetch import make_prefetch_node
from app.core.agent_runtime.nodes.retrieve import make_retrieve_node
from app.core.agent_runtime.nodes.select import make_select_node
from app.core.agent_runtime.nodes.tools import make_tools_node
from app.core.agent_runtime.nodes.translate import make_translate_node
from app.core.agent_runtime.nodes.write import make_write_node

__all__ = [
    "make_agent_check_node",
    "make_agent_node",
    "make_check_node",
    "make_contextualize_node",
    "make_finalize_node",
    "make_gate_node",
    "make_prefetch_node",
    "make_retrieve_node",
    "make_select_node",
    "make_tools_node",
    "make_translate_node",
    "make_write_node",
    "route_after_agent",
    "route_after_contextualize",
    "route_after_gate",
]
