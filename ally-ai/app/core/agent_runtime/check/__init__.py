"""Check for the conversational agent: what the model replied → what ally-be gets.

Deterministic, like v1's check. The model may chat freely, but a fact
about the organisation reaches a person only with a citation that resolves to a
passage this run actually offered.

The response keeps the `/knowledge-agent/answer` shape, so ally-be's decision mapping
is unchanged: small talk comes back as intent `answer` with no citations and
decline reason `none`, plus `turn_type`.

A draft the check refuses comes back with a rejection reason. The graph gives the
agent one chance to rewrite it (nodes/agent_check.py); only a second refusal
becomes a decline with no text, which ally-be sends as the bot's decline wording.

The phases are in `pipeline.py`; the wording fixes in `fixes.py`; the rules the
check enforces in code in `safety.py`; the text helpers in `text.py`.
"""

from app.core.agent_runtime.check.fixes import (
    TEAM_WILL_CONFIRM,
    fallback_contact,
    offers_slot,
)
from app.core.agent_runtime.check.organisation import Organisation, organisation_of
from app.core.agent_runtime.check.pipeline import check_reply
from app.core.agent_runtime.check.rejections import (
    REJECTIONS,
    Rejection,
    rejection_feedback,
)
from app.core.agent_runtime.check.safety import clinical_advice, touches_topic
from app.core.agent_runtime.check.text import (
    contact_details,
    detail_kinds,
    looks_factual,
    mentions_sources,
    normalise_detail,
    plain_text,
    says_it_has_nothing,
    unsupported_details,
)
from app.core.agent_runtime.check.verdict import CheckContext, Verdict

__all__ = [
    "REJECTIONS",
    "TEAM_WILL_CONFIRM",
    "CheckContext",
    "Organisation",
    "Rejection",
    "Verdict",
    "check_reply",
    "clinical_advice",
    "contact_details",
    "detail_kinds",
    "fallback_contact",
    "looks_factual",
    "mentions_sources",
    "normalise_detail",
    "offers_slot",
    "organisation_of",
    "plain_text",
    "rejection_feedback",
    "says_it_has_nothing",
    "touches_topic",
    "unsupported_details",
]
