from typing import List, Literal, Mapping, Any, Optional, Dict

from app.core.constants import VisibilityType, DetectionType, ConditionOperator, DEFAULT_LANGUAGE_CODE
from app.core.events.base import BaseEvent
from app.core.events.event_types.similarity_based.similarity_event import SimilarityEvent
from app.core.events.event_types.semantic_similarity.semantic_similarity_event import SemanticSimilarityEvent
from app.core.events.event_types.time.time_event import TimeEvent, TimeData
from app.core.events.event_types.score.score_event import ScoreEvent, ScoreData
from app.core.events.event_types.combination.combination_event import CombinationEvent, CombinationData, ExpressionNode
from app.core.embeddings import BaseEmbeddingClient
from app.utils import get_logger


class UnknownEventIdError(RuntimeError):
    def __init__(self, unknown_ids: list[str]):
        super().__init__(f"Unknown event ids in metadata: {unknown_ids}")
        self.unknown_ids = unknown_ids


def _create_event_by_detection_type(
    ev: Mapping[str, Any],
    detection_type: DetectionType,
    logger=None,
    embedding_client: Optional[BaseEmbeddingClient] = None,
    language_code: Optional[str] = None,
) -> Optional[BaseEvent]:
    """
    Robust factory helper that creates event instances per detection type.
    Improved logging and defensive parsing for TIME events.

    Args:
        ev: Event metadata dictionary
        detection_type: Type of event detection
        logger: Optional logger instance
        embedding_client: Optional embedding client for semantic similarity
    """
    # use provided logger or fallback
    log = logger if logger is not None else get_logger(__name__)

    # normalize event id
    event_id = ev.get("id") or ev.get("event_id") or "<no-id>"
    visibility_type = ev.get("visibilityType") or VisibilityType.ACTIVE
    raw_data = ev.get("data")

    common_fields = {
        "score": ev.get("score"),
        "emoji": ev.get("emoji"),
        "emoji_message": ev.get("message"),
        "branching_instruction": ev.get("branchInstruction"),
        "show_feedback": ev.get("feedbackStatus", True),  # Default to True if not provided
    }

    try:
        if detection_type == DetectionType.SENTENCE_SIMILARITY:
            sentences = []
            if raw_data and isinstance(raw_data, dict) and "sentences" in raw_data:
                sentences = raw_data.get("sentences", [])
            elif "sentences" in ev:
                sentences = ev.get("sentences", [])
            if not isinstance(sentences, list):
                log.warning("Event '%s' (SENTENCE_SIMILARITY) invalid 'sentences' field: %r", event_id, raw_data)
                return None

            return SimilarityEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=raw_data or {},
                custom_sentences=sentences,
                language_code=language_code or DEFAULT_LANGUAGE_CODE,
                **common_fields,
            )

        elif detection_type == DetectionType.TIME:
            if not raw_data or not isinstance(raw_data, dict):
                log.warning("Event '%s' (TIME) missing/invalid data: %r", event_id, raw_data)
                return None

            try:
                time_data = TimeData(**raw_data)
            except Exception as e:
                log.warning("Event '%s' (TIME) invalid data: %s", event_id, e)
                return None

            return TimeEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=time_data,
                **common_fields,
            )

        elif detection_type == DetectionType.SCORE:
            if not raw_data or not isinstance(raw_data, dict):
                log.warning("Event '%s' (SCORE) missing/invalid data: %r", event_id, raw_data)
                return None
            try:
                score_data = ScoreData(**raw_data)
            except Exception as e:
                log.warning("Event '%s' (SCORE) invalid data: %s", event_id, e)
                return None
            return ScoreEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=score_data,
                **common_fields,
            )

        elif detection_type == DetectionType.SEMANTIC_SIMILARITY:
            sentences = []
            similarity_threshold = None
            if raw_data and isinstance(raw_data, dict):
                sentences = raw_data.get("sentences", [])
                similarity_threshold = raw_data.get("threshold")
            elif "sentences" in ev:
                sentences = ev.get("sentences", [])

            if not isinstance(sentences, list):
                log.warning("Event '%s' (SEMANTIC_SIMILARITY) invalid 'sentences' field: %r", event_id, raw_data)
                return None

            return SemanticSimilarityEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=raw_data or {},
                custom_sentences=sentences,
                similarity_threshold=similarity_threshold,
                embedding_client=embedding_client,
                **common_fields,
            )

        elif detection_type == DetectionType.COMBINATION:
            if not raw_data or not isinstance(raw_data, dict):
                log.warning("Event '%s' (COMBINATION) missing/invalid data: %r", event_id, raw_data)
                return None
            try:
                expression = _parse_expression(raw_data.get("expression", {}))
                combination_data = CombinationData(
                    dependent_events=raw_data.get("dependent_events", []),
                    expression=expression
                )
            except Exception as e:
                log.warning("Event '%s' (COMBINATION) invalid expression/data: %s", event_id, e)
                return None

            return CombinationEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=combination_data,
                **common_fields,
            )

        else:
            log.warning("Event '%s' unknown detection type: %s", event_id, detection_type)
            return None

    except Exception as e:
        log.exception("Unhandled exception while creating event '%s' (type=%s): %s", event_id, detection_type, e)
        return None


def _parse_expression(expr_dict: dict) -> ExpressionNode:
    """Recursively parse an expression dictionary into an ExpressionNode."""
    if not expr_dict or "type" not in expr_dict:
        raise ValueError("Invalid expression: missing 'type' field")

    node_type = expr_dict["type"]

    if node_type == "IDENTIFIER":
        if "id" not in expr_dict:
            raise ValueError("IDENTIFIER expression must have 'id' field")
        return ExpressionNode(type="IDENTIFIER", id=expr_dict["id"])

    elif node_type == "NOT":
        if "operand" not in expr_dict:
            raise ValueError("NOT expression must have 'operand' field")
        return ExpressionNode(
            type="NOT",
            operand=_parse_expression(expr_dict["operand"])
        )

    elif node_type in ("AND", "OR"):
        if "left" not in expr_dict or "right" not in expr_dict:
            raise ValueError(f"{node_type} expression must have 'left' and 'right' fields")
        return ExpressionNode(
            type=node_type,
            left=_parse_expression(expr_dict["left"]),
            right=_parse_expression(expr_dict["right"])
        )

    else:
        raise ValueError(f"Unknown expression type: {node_type}")


def _extract_language_code(source: Mapping[str, Any]) -> str:
    """
    Extract language_code from a dictionary, checking both direct fields and nested languageConfig.
    
    Args:
        source: Dictionary to extract language_code from
        
    Returns:
        Extracted language_code or DEFAULT_LANGUAGE_CODE if not found
    """
    # First check for languageCode directly (most common case)
    language_code = source.get("languageCode") or source.get("language_code") or DEFAULT_LANGUAGE_CODE
    
    # Then check for nested languageConfig dict
    if language_code == DEFAULT_LANGUAGE_CODE:
        language_config = source.get("languageConfig") or source.get("language_config")
        if isinstance(language_config, dict):
            language_code = language_config.get("language_code") or language_config.get("languageCode") or DEFAULT_LANGUAGE_CODE
    
    return language_code


def build_events_from_metadata(
        metadata: Mapping[str, Any],
        *,
        on_unknown: Literal["ignore", "warn", "error"] = "ignore",
        logger=None,
        embedding_client: Optional[BaseEmbeddingClient] = None,
) -> List[BaseEvent]:
    """
    Convert a scenario dict to a list of BaseEvent instances.

    This version is defensive and logs detailed reasons when events are skipped.
    """
    import logging
    events: List[BaseEvent] = []
    unknown_ids: list[str] = []
    reasons: Dict[str, str] = {}

    # ensure we have a logger
    log = logger if logger is not None else logging.getLogger(__name__)
    log.debug("build_events_from_metadata called")

    # Extract language_code from metadata
    # If metadata has a "scenario" key, extract from that section; otherwise metadata is the scenario itself
    scenario_section = metadata.get("scenario")
    if isinstance(scenario_section, dict):
        language_code = _extract_language_code(scenario_section)
    else:
        language_code = _extract_language_code(metadata)

    # normalize event list location: metadata may be {"scenario": {...}} or the raw scenario
    event_dicts = metadata.get("events") or []
    if not event_dicts:
        if isinstance(scenario_section, dict):
            event_dicts = scenario_section.get("events") or []

    log.debug("Found %d raw event entries in metadata", len(event_dicts))

    for raw_ev in event_dicts:
        # make a shallow copy so we can normalize keys without mutating caller data
        ev = dict(raw_ev or {})
        # normalize id: accept either 'event_id' or 'id'
        if "id" not in ev and "event_id" in ev:
            ev["id"] = ev["event_id"]

        event_id = ev.get("id", "") or ev.get("event_id", "")
        if not event_id:
            reason = "missing event id (no 'id' or 'event_id')"
            log.warning("Skipping event: %s", reason)
            unknown_ids.append("<missing-id>")
            reasons["<missing-id>"] = reason
            continue

        log.debug("Processing event id=%s raw_detectionType=%s", event_id, ev.get("detectionType"))

        # determine detection type (strict name lookup first)
        detection_type_str = ev.get("detectionType")
        detection_type = None
        if detection_type_str is None:
            # backward compatibility: old format with 'sentences' => SENTENCE_SIMILARITY
            if "sentences" in ev:
                detection_type = DetectionType.SENTENCE_SIMILARITY
                log.debug("Event %s: inferred detection type SENTENCE_SIMILARITY from legacy 'sentences' field", event_id)
            else:
                reason = "missing detectionType and no legacy 'sentences' field"
                log.warning("Skipping event '%s': %s", event_id, reason)
                unknown_ids.append(event_id)
                reasons[event_id] = reason
                continue
        else:
            # backend sends properly formatted enum values
            try:
                detection_type = DetectionType(detection_type_str)
            except (ValueError, KeyError):
                reason = f"invalid detectionType '{detection_type_str}'"
                log.warning("Skipping event '%s': %s", event_id, reason)
                unknown_ids.append(event_id)
                reasons[event_id] = reason
                continue

        # Create instance according to detection type
        try:
            instance = _create_event_by_detection_type(
                ev=ev,
                detection_type=detection_type,
                logger=log,
                embedding_client=embedding_client,
                language_code=language_code,
            )
            if instance is None:
                reason = "factory returned None (validation/parsing failed inside _create_event_by_detection_type)"
                log.warning("Event '%s' skipped: %s", event_id, reason)
                unknown_ids.append(event_id)
                reasons[event_id] = reason
                continue

            events.append(instance)
            log.info("Created event object: id=%s type=%s class=%s", event_id, detection_type.name, instance.__class__.__name__)

        except Exception as e:
            log.exception("Failed to create event '%s': %s", event_id, e)
            unknown_ids.append(event_id)
            reasons[event_id] = f"exception: {e}"
            if on_unknown == "error":
                raise

    # Summarize skipped events if requested
    if unknown_ids:
        if on_unknown == "warn":
            log.warning("Some events were skipped (%d): %s", len(unknown_ids), unknown_ids)
            for eid, r in reasons.items():
                log.debug("Skipped reason: %s -> %s", eid, r)
        elif on_unknown == "error":
            raise UnknownEventIdError(unknown_ids)

    log.info("build_events_from_metadata: built %d event objects, skipped %d", len(events), len(unknown_ids))
    return events
