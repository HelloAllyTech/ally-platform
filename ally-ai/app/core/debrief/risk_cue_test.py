"""The test behind a risk-cue option (spec DEBRIEF_ACROSS_ROLEPLAYS §5).

A creator gives an option example lines that ARE risk cues and lines that are NOT. Each
line is put in a character's mouth inside a short synthetic session and read by the real
Safety reader with the option's own definition. The option passes only when, on EVERY
run:

- every cue example is found as a risk cue at the character's turn (any category), and
- no non-cue example is flagged as a CLEAR risk cue (a ``possible`` one is allowed: it
  is the Writer's call, as in a real debrief).

With ``word_list_raises`` off, the word list never raises a cue to clear, as in a real
run.
Synthetic sessions only.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.debrief.cue_strength import cue_strength
from app.core.debrief.safety_reader import TranscriptTurn, read_safety

# The learner opens and answers neutrally, so the character's line is the only content.
_OPEN = "How have things been for you lately?"
_REPLY = "Thank you for telling me. Can you say a little more?"


def _session(line: str) -> List[TranscriptTurn]:
    return [
        TranscriptTurn(turn_index=1, role="counselor", text=_OPEN),
        TranscriptTurn(turn_index=2, role="client", text=line),
        TranscriptTurn(turn_index=3, role="counselor", text=_REPLY),
    ]


async def _read(
    line: str, definition: Optional[str], model: Optional[str], language: str
):
    reading, _ = await read_safety(
        _session(line),
        language,
        model=model,
        risk_cue_definition=definition,
    )
    return reading


async def run_risk_cue_test(
    cue_examples: List[str],
    non_cue_examples: List[str],
    risk_cue_definition: Optional[str] = None,
    word_list_raises: bool = True,
    reps: int = 3,
    model: Optional[str] = None,
    language: str = "en",
) -> Dict[str, Any]:
    """Run every example ``reps`` times; ``passed`` only when every run was clean."""
    cues = [c.strip() for c in cue_examples if c and c.strip()]
    non_cues = [c.strip() for c in non_cue_examples if c and c.strip()]
    results: List[Dict[str, Any]] = []
    for rep in range(1, max(1, reps) + 1):
        missed: List[str] = []
        false_clear: List[str] = []
        for line in cues:
            reading = await _read(line, risk_cue_definition, model, language)
            if reading is None or not any(c.turn_index == 2 for c in reading.risk_cues):
                missed.append(line)
        for line in non_cues:
            reading = await _read(line, risk_cue_definition, model, language)
            if reading is None:
                # No answer is a failure of the test, not proof the line is harmless.
                false_clear.append(f"{line} (the reader gave no answer)")
                continue
            if any(
                c.turn_index == 2
                and cue_strength(c.model_dump(), word_list_raises) == "clear"
                for c in reading.risk_cues
            ):
                false_clear.append(line)
        results.append({"rep": rep, "missed": missed, "false_clear": false_clear})
    return {
        "passed": bool(cues)
        and bool(non_cues)
        and all(not r["missed"] and not r["false_clear"] for r in results),
        "reps": results,
        "cue_examples": len(cues),
        "non_cue_examples": len(non_cues),
        "model": model,
    }
