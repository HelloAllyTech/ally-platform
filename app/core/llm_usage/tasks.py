from enum import Enum


class LLMTask(str, Enum):
    """Task labels for token-usage analytics. Must match ally-be's LlmTask enum.
    The live agent produces AGENT_TURN, ROLLING_SUMMARY and SUPERVISOR_NOTE;
    other tasks come from ally-ai."""

    AGENT_TURN = "agent_turn"
    # Episodic-memory summarizer (compaction + end-of-session final fold).
    ROLLING_SUMMARY = "rolling_summary"
    # Live supervisor notes: one call per committed learner turn deciding
    # whether to send a coaching hint. Kept separate from AGENT_TURN because it
    # runs at the same frequency on a deliberately cheaper model.
    SUPERVISOR_NOTE = "supervisor_note"
