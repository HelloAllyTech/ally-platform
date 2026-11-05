"""Check for the conversational agent: what the model replied → what ally-be gets.

Deterministic, like the parity path's check. The model may chat freely, but a fact
about the organisation reaches a person only with a citation that resolves to a
passage this run actually offered.

The response keeps the `/knowledge-agent/answer` shape, so ally-be's decision mapping
is unchanged: small talk comes back as intent `answer` with no citations and
decline reason `none`, plus `turn_type`.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from app.core.agent_runtime.schemas import REPLY_ACTION, AgentIntent
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import AnswerIntent, DeclineReason
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Small talk that carries a number, a price, a percentage, a link or an email is
# asserting something checkable, so it has to be grounded like an answer. Errs on
# the side of treating harmless text as factual: the cost is a decline, the
# alternative an invented price.
_LOOKS_FACTUAL = re.compile(
    r"\d|[₹$€£%]|\b(?:rs|inr|usd|eur)\b|https?://|www\.|[\w.+-]+@[\w-]+\.\w+",
    re.IGNORECASE,
)


def looks_factual(text: str) -> bool:
    return bool(_LOOKS_FACTUAL.search(text or ""))


def check_reply(
    step: Dict[str, Any],
    meta: Dict[str, Any],
    passages: List[Dict[str, Any]],
    *,
    turn_type: str,
    language: str,
    retrieval: Dict[str, Any],
    general: bool,
    prefetch_gate: Optional[str],
    tool_passages: int,
) -> Dict[str, Any]:
    """The run's result.

    `prefetch_gate` is the decline reason the up-front search would have given in
    the parity path (None when it cleared the threshold or did not run).
    `tool_passages` counts passages added by tools this run.
    """
    action = step.get("action") or REPLY_ACTION
    intent = AgentIntent(step.get("intent") or AgentIntent.DECLINE)
    answer_text = (step.get("answer") or "").strip()
    citations = KnowledgeAgentService._resolve_citations(
        list(step.get("citations") or []), passages
    )
    unsupported = False
    # The model chose to decline, so its text is a decline written for the person.
    # A decline forced here replaces whatever the model wrote, which may be the
    # very claim being refused; ally-be then sends the bot's decline wording.
    model_declined = action == REPLY_ACTION and intent == AgentIntent.DECLINE

    if action != REPLY_ACTION:
        # The tool budget ran out and the model still asked for a tool: it has
        # nothing it is willing to answer with.
        logger.info("Agent asked for a tool past its budget; declining")
        intent = AgentIntent.DECLINE
    elif not answer_text:
        intent = AgentIntent.DECLINE
    elif intent == AgentIntent.SMALLTALK and (
        looks_factual(answer_text) or tool_passages
    ):
        # Small talk does not need a source, but this one either states something
        # checkable or was written after searching: ground it like an answer.
        logger.info("Small talk looks factual; treating it as an answer")
        intent = AgentIntent.ANSWER

    if intent == AgentIntent.ANSWER and not citations:
        if general:
            # A bot allowed general knowledge keeps today's behaviour: the answer
            # stands, flagged as ungrounded.
            unsupported = True
        else:
            logger.info("Agent answer with no valid citations; declining")
            intent = AgentIntent.DECLINE

    if intent == AgentIntent.DECLINE:
        citations = []
        if not model_declined:
            answer_text = ""
        # The parity path's reason when the up-front search found nothing and no
        # tool did either, so the unanswered queue reads the same as in v1.
        decline_reason = (
            DeclineReason(prefetch_gate)
            if prefetch_gate and not tool_passages
            else DeclineReason.MODEL_DECLINED
        )
    else:
        decline_reason = DeclineReason.NONE
        if intent in (AgentIntent.SMALLTALK, AgentIntent.CLARIFY):
            citations = []

    response_intent = {
        AgentIntent.ANSWER: AnswerIntent.ANSWER,
        AgentIntent.SMALLTALK: AnswerIntent.ANSWER,
        AgentIntent.CLARIFY: AnswerIntent.CLARIFY,
        AgentIntent.DECLINE: AnswerIntent.DECLINE,
    }[intent]
    retrieval = {
        **retrieval,
        "passages_used": len(passages),
        "unsupported": unsupported,
    }

    return {
        "intent": response_intent,
        "answer": answer_text,
        "language": (step.get("language") or language or "en").strip(),
        "confidence": 0.0,
        "citations": citations,
        "decline_reason": decline_reason,
        "retrieval": retrieval,
        "provider": meta.get("provider", ""),
        "model": meta.get("model", ""),
        "prompt_version": settings.KNOWLEDGE_AGENT.PROMPT_VERSION,
        "turn_type": turn_type,
    }
