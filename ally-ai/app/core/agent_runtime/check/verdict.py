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
    #: What the run was given about the person (chunk 8a): their memory lines, this
    #: chat's summary and their name. A source for what they said about themselves,
    #: never for the organisation.
    personal: str = ""
    #: A list find ran this run and answered (chunk 6b): it looked, even though it
    #: isn't a search.
    looked_up: bool = False
    #: A find this run found nothing at the time asked, or only the nearest entries
    #: (chunk 6b). "Nothing's free on Thursday evening" is then an answer, from the
    #: find, not a missing source.
    found_nothing: bool = False
    #: Something in this run can pass the person's request on (chunk 6b): the
    #: `hand_over` tool, or a create tool on a list that takes their details (a
    #: callback or a lead). Without either, it never promises to pass anything on.
    can_pass_on: bool = True
    #: How many of `passages`, from the start, were carried over from the previous
    #: message (chunk 6b): citable, but not found by this run.
    carried: int = 0
    #: The plain-words refusals this run's list writes got from the list's rules
    #: (Q3-fast Part 0b): "That table is taken.", "You already have 2 Reservations…".
    #: A reply that relays one is an answer about the person's request, not a gap
    #: in what the assistant knows.
    refused: Sequence[str] = ()

    @property
    def found(self) -> List[Dict[str, Any]]:
        """The passages this run looked up itself: carried list entries left out."""
        return self.passages[self.carried :]


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
