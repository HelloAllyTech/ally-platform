"""Check for the conversational agent: what the model replied → what ally-be gets.

Deterministic, like the parity path's check. The model may chat freely, but a fact
about the organisation reaches a person only with a citation that resolves to a
passage this run actually offered.

The response keeps the `/knowledge-agent/answer` shape, so ally-be's decision mapping
is unchanged: small talk comes back as intent `answer` with no citations and
decline reason `none`, plus `turn_type`.

A draft the check refuses comes back with a rejection reason. The graph gives the
agent one chance to rewrite it (nodes/agent_check.py); only a second refusal
becomes a decline with no text, which ally-be sends as the bot's decline wording.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

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


#: Why a draft was refused, as told to the agent when it rewrites it. Plain
#: guidance, never the refused text.
REJECTIONS: Dict[str, str] = {
    "uncited": (
        "It stated something about the organisation without citing a passage. "
        "Cite the passages that support it; if none do and searches are left, "
        "search; otherwise tell the person, in your own words, that you don't have "
        "that information and where they could go instead."
    ),
    "unsourced_detail": (
        "It included a specific detail (a number, price, link, email or contact) "
        "that no passage supports. Leave the detail out, or cite the passage it "
        "comes from."
    ),
    "empty": "It was empty. Write the reply the person should get.",
}


def check_reply(
    step: Dict[str, Any],
    meta: Dict[str, Any],
    passages: List[Dict[str, Any]],
    *,
    turn_type: str,
    language: str,
    retrieval: Dict[str, Any],
    general: bool,
    search_gate: Optional[str],
) -> Tuple[Dict[str, Any], Optional[str]]:
    """The run's result, and the rejection reason (a `REJECTIONS` key) when the
    check refused the draft; None when it went through as the model meant it.

    `search_gate` is the gate verdict on the run's first search (None when it
    found something relevant or no search ran).
    """
    action = step.get("action") or REPLY_ACTION
    intent = AgentIntent(step.get("intent") or AgentIntent.DECLINE)
    answer_text = (step.get("answer") or "").strip()
    citations = KnowledgeAgentService._resolve_citations(
        list(step.get("citations") or []), passages
    )
    unsupported = False
    rejection: Optional[str] = None
    # The model chose to decline, so its text is a decline written for the person.
    # A decline forced here replaces whatever the model wrote, which may be the
    # very claim being refused; ally-be then sends the bot's decline wording.
    model_declined = action == REPLY_ACTION and intent == AgentIntent.DECLINE

    if action != REPLY_ACTION:
        # The tool budget ran out and the model still asked for a tool: it has
        # nothing it is willing to answer with.
        logger.info("Agent asked for a tool past its budget; declining")
        intent = AgentIntent.DECLINE
        rejection = "empty"
    elif not answer_text:
        intent = AgentIntent.DECLINE
        rejection = "empty"
    elif intent == AgentIntent.SMALLTALK and (looks_factual(answer_text) or passages):
        # Small talk does not need a source, but this one either states something
        # checkable or was written after a search found passages: ground it like
        # an answer.
        logger.info("Small talk looks factual; treating it as an answer")
        intent = AgentIntent.ANSWER
        rejection = "unsourced_detail"

    if intent == AgentIntent.ANSWER and not citations:
        if general:
            # A bot allowed general knowledge keeps today's behaviour: the answer
            # stands, flagged as ungrounded.
            unsupported = True
            rejection = None
        else:
            logger.info("Agent answer with no valid citations; declining")
            intent = AgentIntent.DECLINE
            rejection = rejection or "uncited"
    elif intent != AgentIntent.DECLINE:
        rejection = None

    if intent == AgentIntent.DECLINE:
        citations = []
        if not model_declined:
            answer_text = ""
        # The parity path's reason when searching found nothing at all, so the
        # unanswered queue reads the same as in v1.
        decline_reason = (
            DeclineReason(search_gate)
            if search_gate and not passages
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

    result = {
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
    return result, rejection
