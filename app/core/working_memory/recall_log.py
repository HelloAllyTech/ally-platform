"""Best-effort emitter for what recall considered on a turn.

Reuses ``msg_event_queue`` (the same SQS queue as turn_metrics — Core routes by
``message_type``). Fire-and-forget: never blocks or fails the working-memory update,
which is
itself already off the reply path.

WHY THIS EXISTS. `recall.select` has always returned every score it considered, and its
docstring says what that was for: "the second element is what makes the coefficients
above
tunable from production rather than from argument". Nothing ever consumed it — the only
call
site discards it as `_scored` — so the weights on cue hits, semantic similarity,
encoding
strength, recency decay and stance congruence have never been tunable from anything but
argument. This ships the scores so they can be.

NOT A SIMILARITY FLOOR, and this is why the corpus retrieval log could not simply absorb
it.
Recall is a RANKING with several terms and a hard cap; nothing here is admitted or
rejected by
a threshold, so a precision curve over a floor would describe a mechanism that does not
exist.
The question this data answers is different: was the fact the turn needed in the pool
and
passed over?

WHAT IS NOT SENT: the learner's words. The cue tier says WHICH source was used, not its
content, and the turn's own text already lives in ally-be's transcript — the judge that
reads
this joins to it by session and turn rather than having it duplicated into an analytics
table.
"""

import json
import time
from typing import Any, Dict, List, Optional, Sequence

from app.core.config import settings
from app.core.logger import get_logger
from app.core.queue import msg_event_queue

logger = get_logger(__name__)

#: Passed-over candidates reported per turn, highest-scoring first.
#:
#: The near misses are the whole point — a fact that scored just under the cap is the
#: evidence
#: that the cap or a weight is wrong — and the pool's tail carries none of that. Five
#: keeps a
#: turn's message small next to the 256KB SQS limit, which matters because this rides
#: the queue
#: that also carries session memory.
MAX_PASSED_OVER = 5

#: Fact text is truncated rather than sent whole: it identifies the fact for a reader
#: and a
#: judge, and a pool of long backstory facts would otherwise dominate the message.
MAX_FACT_CHARS = 240


def _fact_row(scored: Any, selected: bool) -> Dict[str, Any]:
    """One candidate and every term that decided it."""
    fact = getattr(scored, "fact", None)
    text = (getattr(fact, "text", "") or "")[:MAX_FACT_CHARS]
    return {
        "text": text,
        "selected": selected,
        "score": round(float(getattr(scored, "score", 0.0) or 0.0), 4),
        "cue_hits": int(getattr(scored, "cue_hits", 0) or 0),
        "similarity": round(float(getattr(scored, "similarity", 0.0) or 0.0), 4),
        "mood_congruent": bool(getattr(scored, "mood_congruent", False)),
        "spread": bool(getattr(scored, "spread", False)),
        "encoding_strength": round(
            float(getattr(fact, "encoding_strength", 0.0) or 0.0), 4
        ),
        "last_recalled_turn": getattr(fact, "last_recalled_turn", None),
        "stances_seen": len(getattr(fact, "stances_seen", []) or []),
    }


async def emit_recall(
    *,
    room_id: Optional[str],
    turn_index: int,
    stance: str,
    cue_tier: str,
    cue_count: int,
    scored: Sequence[Any],
    selected_texts: Sequence[str],
    cap: int,
) -> None:
    """Schedule a best-effort ``wm_recall`` message. Never raises, never blocks.

    `cue_tier` is which SOURCE supplied the cues — the updater's nomination, the
    learner's own
    last words, or the scenario description. It is worth recording on its own: the first
    v2v
    run showed cue_hits at 0 on every turn, so recall was selecting by encoding strength
    and
    decay while appearing to respond to the conversation. A tier distribution makes that
    visible without anyone having to read a transcript.
    """
    try:
        if not getattr(settings, "CLIENT_WORKING_MEMORY_ENABLED", True):
            return
        if not room_id or room_id.startswith("preview-"):
            return
        if not scored:
            return

        chosen = set(selected_texts)
        selected_rows: List[Dict[str, Any]] = []
        passed_over: List[Dict[str, Any]] = []
        for item in scored:
            fact_text = getattr(getattr(item, "fact", None), "text", "") or ""
            if fact_text in chosen:
                selected_rows.append(_fact_row(item, True))
            else:
                passed_over.append(_fact_row(item, False))

        passed_over.sort(key=lambda row: row["score"], reverse=True)

        body = json.dumps(
            {
                "message_type": "wm_recall",
                "timestamp": int(time.time()),
                "room_id": room_id,
                "data": {
                    "wm_recall": {
                        "turn_index": int(turn_index),
                        "stance": stance or "",
                        "cue_tier": cue_tier,
                        "cue_count": int(cue_count),
                        "pool_size": len(scored),
                        "cap": int(cap),
                        "selected": selected_rows,
                        "passed_over": passed_over[:MAX_PASSED_OVER],
                    }
                },
            }
        )

        await msg_event_queue.send_message(body)
    except Exception:
        logger.debug("wm_recall emit skipped (best-effort)", exc_info=True)
