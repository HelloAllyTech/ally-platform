from enum import Enum


class LLMTask(str, Enum):
    """Task labels for token-usage analytics. Must match ally-be's LlmTask enum.
    The live agent only produces AGENT_TURN; other tasks come from ally-ai."""

    AGENT_TURN = "agent_turn"
