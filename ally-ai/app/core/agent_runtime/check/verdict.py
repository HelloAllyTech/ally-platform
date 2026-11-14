"""What the check knows about a run, and its decision on one draft."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from app.core.agent_runtime.check.organisation import Organisation
from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.schemas import AgentIntent


@dataclass(frozen=True)
class CheckContext:
    """What the check knows about the run besides the draft itself."""

    passages: List[Dict[str, Any]]
    turn_type: str
    general: bool
    #: The gate verdict on the run's first search (None when it found something
    #: relevant or no search ran).
    search_gate: Optional[str]
    question: str
    #: Whether a search ran this run at all.
    searched: bool
    organisation: Organisation
    history: Sequence[Dict[str, str]]
    #: The bot's safety pack id (chunk 20a), None without one.
    safety_pack: Optional[str] = None
    #: One search ran and another is allowed (chunk 20a-2): a decline is sent back
    #: to search again with different words before it is accepted.
    can_search_again: bool = False
    #: The owner's wording for when it doesn't know (onboarding's "When it doesn't
    #: know"). Its contact details count as sourced, and every decline carries them.
    decline_text: str = ""
    #: Topics the owner asked it not to talk about (chunk 20a-2).
    avoid_topics: Sequence[str] = ()
    #: What the assistant is for (chunk 20a-2): answer, enquiries, training, guide.
    purpose: Optional[str] = None
    #: The run offers a create tool (chunk 6): the assistant can book, so it may
    #: offer to and name free times, as long as a find showed them.
    can_book: bool = False


@dataclass
class Verdict:
    """The check's decision on one draft, as it is worked out phase by phase."""

    intent: AgentIntent
    answer: str
    citations: List[Dict[str, Any]]
    #: The model chose to decline, so its text is a decline written for the person.
    #: A decline forced by the check replaces whatever the model wrote, which may be
    #: the very claim being refused; ally-be then sends the bot's decline wording.
    model_declined: bool
    rejection: Optional[Rejection] = None
    #: A refusal that keeps the model's text if the rewrite doesn't fix it (wording,
    #: a nudge, or details removed sentence by sentence), rather than clearing it.
    keeps_text: bool = False
    #: General knowledge on a bot allowed it: answered without a citation.
    unsupported: bool = False
