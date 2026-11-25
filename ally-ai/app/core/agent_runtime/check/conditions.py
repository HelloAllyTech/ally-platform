"""A rule's condition stays with the rule (TF1 round 2, Saathi B-5).

"Will you tell my parents?" got "No, we won't tell your parents" from a passage that
says "Saathi Youth Helpline does not contact your parents or school unless your life
is in immediate danger." Without its "unless", the reply says something the
organisation doesn't. A reply about a rule that a passage states with a condition
must carry the condition: sent back once, and if the rewrite still drops it, the
rule's own sentence is added.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Sequence, Set

#: The words that make a rule conditional.
_CONDITION = re.compile(
    r"\b(?:unless|only if|only when|except(?:\s+(?:when|if|for))?|until|"
    r"as long as|provided (?:that )?|if (?:your|their|someone'?s|a person'?s) life)\b",
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")
#: A stored passage's heading ("Policies, 1 saathi youth helpline pdf page 1 …").
_HEADING = re.compile(r"^.*?\bpage \d+\s+", re.IGNORECASE)
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_STOP = {
    "about",
    "also",
    "been",
    "does",
    "doesn",
    "from",
    "have",
    "into",
    "just",
    "more",
    "only",
    "that",
    "their",
    "them",
    "then",
    "there",
    "they",
    "this",
    "what",
    "when",
    "will",
    "with",
    "would",
    "your",
    "yours",
    "unless",
    "except",
    "until",
}


def _stems(text: str) -> Set[str]:
    return {
        word.lower()[:6]
        for word in _WORD.findall(text or "")
        if len(word) >= 4 and word.lower() not in _STOP
    }


def dropped_condition(
    answer: str, question: str, passages: Sequence[Dict[str, Any]]
) -> Optional[str]:
    """The passage sentence whose condition the reply leaves out, or None.

    A sentence counts when the rule before its condition shares a word with the
    question and with the reply (it is what they are talking about), and the reply
    carries fewer than half of the condition's words."""
    reply = _stems(answer)
    asked = _stems(question)
    if not reply:
        return None
    for passage in passages:
        for sentence in _SENTENCE_END.split(str(passage.get("text") or "")):
            match = _CONDITION.search(sentence)
            if not match:
                continue
            rule = _stems(sentence[: match.start()])
            if not (rule & reply) or not (rule & asked):
                continue
            condition = _stems(sentence[match.start() :])
            if not condition:
                continue
            if len(condition & reply) * 2 >= len(condition):
                continue
            return _HEADING.sub("", sentence).strip()
    return None
