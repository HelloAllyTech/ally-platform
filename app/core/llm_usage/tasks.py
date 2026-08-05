from enum import Enum


class LLMTask(str, Enum):
    """Task labels for token-usage analytics. Must match ally-be's LlmTask enum.
    The live agent produces AGENT_TURN and ROLLING_SUMMARY; other tasks come
    from ally-ai."""

    AGENT_TURN = "agent_turn"
    # Episodic-memory summarizer (compaction + end-of-session final fold).
    ROLLING_SUMMARY = "rolling_summary"
