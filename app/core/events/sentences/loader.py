from pathlib import Path
from typing import Dict, Optional, List

from pydantic import BaseModel, Field, ValidationError

from app.core.constants import VisibilityType
from app.core.events.sentences.mapping import EVENT_ID_TO_FILE

import yaml


class SimilarityEventDefinition(BaseModel):
    """Schema for similarity-based sentences loaded from YAML."""

    id: str = Field(..., description="Event ID, must match metadata.id")
    sentences: List[str] = Field(..., min_length=1)

    # Optional tunables; if omitted, GenericSimilarityEvent defaults apply
    match_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    min_match_tokens: Optional[int] = Field(default=None, ge=1)

    # Optional default visibility for curated event
    visibility: Optional[VisibilityType] = Field(default=None)


# Module-level cache to avoid re-reading from disk
_SIMILARITY_SENTENCE_CACHE: Dict[str, SimilarityEventDefinition] = {}


def _sentences_dir() -> Path:
    return Path(__file__).parent


def has_similarity_sentences(event_id: str) -> bool:
    """Return True if we have a curated YAML file for the event id."""
    key = event_id.strip().lower()
    return key in EVENT_ID_TO_FILE


def load_similarity_sentences(event_id: str) -> Optional[SimilarityEventDefinition]:
    """Load and validate the similarity sentences for an event id.

    Returns None if the event id is not mapped. Raises on YAML errors or schema issues.
    """
    key = event_id.strip().lower()
    filename = EVENT_ID_TO_FILE.get(key)
    if not filename:
        return None

    if key in _SIMILARITY_SENTENCE_CACHE:
        return _SIMILARITY_SENTENCE_CACHE[key]

    path = _sentences_dir() / filename
    if not path.exists():
        raise FileNotFoundError(f"Similarity sentences file not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)  # type: ignore[attr-defined]

    try:
        definition = SimilarityEventDefinition.model_validate(raw)
    except ValidationError as ve:  # Re-raise with filename context
        raise ValidationError.from_exception_data(
            title=f"Invalid similarity sentences in {filename}",
            line_errors=ve.errors(),
        )

    _SIMILARITY_SENTENCE_CACHE[key] = definition
    return definition
