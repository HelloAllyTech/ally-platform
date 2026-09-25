from enum import Enum


class LLMTask(str, Enum):
    """Task labels for token-usage analytics. Must match ally-be's LlmTask enum.
    The live agent produces the labels below; other tasks come from ally-ai."""

    AGENT_TURN = "agent_turn"
    # Episodic-memory summarizer (compaction + end-of-session final fold).
    ROLLING_SUMMARY = "rolling_summary"
    # Live supervisor notes: one call per committed learner turn deciding
    # whether to send a coaching hint. Kept separate from AGENT_TURN because it
    # runs at the same frequency on a deliberately cheaper model.
    SUPERVISOR_NOTE = "supervisor_note"
    # Client working memory: one detached call per learner turn deriving the
    # actor's inner state. Same cadence as AGENT_TURN but off the reply path,
    # so it must be separable from turn cost when arguing the feature's worth.
    CLIENT_WORKING_MEMORY = "client_working_memory"
    # Back-channel phrases: one call per session, at session start, generating
    # the listener affirmations played while the learner holds the floor. Kept
    # separate from AGENT_TURN because it is a per-simulation opt-in, so its
    # spend has to be readable on its own.
    BACKCHANNEL_PHRASES = "backchannel_phrases"
