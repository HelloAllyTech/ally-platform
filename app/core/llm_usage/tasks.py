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

    # ---- Latency-masking layer (per-simulation opt-ins, each on its own
    # dedicated or clip instance, so each is separable on the cost dashboard).
    # Predictive interim reply: one fast-model call per long learner turn.
    INTERIM_REPLY = "interim_reply"
    # Dynamic thinking-fillers: seed (session start), exchange (between turns)
    # and in-turn (mid-utterance) generations share one label.
    THINKING_FILLER = "thinking_filler"
    # Clip TTS: the ISOLATED TTS instance that renders filler / back-channel /
    # interim clips. Not the AgentSession's TTS, so LiveKit's metrics hook
    # (agent_tts) never sees it. Recorded per real synthesis; a clip-cache hit
    # costs nothing and records nothing.
    CLIP_TTS = "clip_tts"

    # ---- Per-turn graph calls outside the reply itself.
    # RAG title selection over the scenario knowledge base.
    KNOWLEDGE_RETRIEVAL = "knowledge_retrieval"
    # <llm_response(...)> substitution inside a branching instruction.
    BRANCHING_INSTRUCTION = "branching_instruction"
    # <chat_summary> substitution inside a branching instruction.
    BRANCHING_CHAT_SUMMARY = "branching_chat_summary"
    # Scored behaviour-instruction classification (one call per instruction).
    BEHAVIOUR_DETECTION = "behaviour_detection"
    # Guardrail classification, including the STT coherence guard.
    GUARDRAIL_CHECK = "guardrail_check"
    # Binary-classifier events, batched or single.
    BINARY_CLASSIFIER = "binary_classifier"
    # Helper-paraphrased event evaluation.
    HELPER_PARAPHRASED = "helper_paraphrased"

    # ---- Embeddings (prompt_tokens = input tokens, completion 0).
    # Semantic-similarity events: target sentences once, learner utterances.
    EVENT_EMBEDDING = "event_embedding"
    # Client working memory: backstory pool at setup, one recall query a turn.
    WORKING_MEMORY_EMBEDDING = "working_memory_embedding"

    # ---- After the session.
    # Goal-based actor-quality evaluation of a real session (HTTP request from
    # ally-be; attributed by scenario_session_id, not a room).
    ACTOR_EVALUATION = "actor_evaluation"

    # ---- Studio rehearsal (scenario report): a simulated conversation with no
    # learner, run from an HTTP request. No session exists, so these record
    # under the report id as room (as the rehearsal's graph-node calls already
    # do) with metadata.report_id.
    # The simulated counsellor: one call per rehearsal turn.
    SCENARIO_REPORT_COUNSELOR = "scenario_report_counselor"
    # The LLM judge over the finished rehearsal transcript: one call per report.
    SCENARIO_REPORT_EVALUATION = "scenario_report_evaluation"

    # ---- V2V tester: the simulated learner that joins a real session's room.
    # Recorded against that room and session, under labels of their own so
    # tester spend is never read as the session's delivery cost.
    # The tester's reply: one call per exchange.
    V2V_TESTER_REPLY = "v2v_tester_reply"
    # End-of-run judge counting tester turns that broke the counsellor role.
    V2V_ROLE_FIDELITY_JUDGE = "v2v_role_fidelity_judge"
