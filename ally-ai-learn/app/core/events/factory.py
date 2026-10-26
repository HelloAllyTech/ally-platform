from typing import Any, Dict, List, Literal, Mapping, Optional

from app.core.branching_instructions.base import BranchingInstruction
from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, DetectionType, VisibilityType
from app.core.embeddings import BaseEmbeddingClient
from app.core.events.base import BaseEvent, DetectionConfig
from app.core.events.event_types.binary_classifier.binary_classifier_event import (
    BinaryClassifierEvent,
)
from app.core.events.event_types.binary_classifier.schemas import (
    BinaryClassifierData,
    Example,
)
from app.core.events.event_types.combination.combination_event import (
    CombinationData,
    CombinationEvent,
    ExpressionNode,
)
from app.core.events.event_types.helper_paraphrased.helper_paraphrased_event import (
    HelperParaphrasedData,
    HelperParaphrasedEvent,
)
from app.core.events.event_types.interruption.interruption_event import (
    InterruptionData,
    InterruptionEvent,
)
from app.core.events.event_types.score.score_event import ScoreData, ScoreEvent
from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (
    SemanticSimilarityEvent,
)
from app.core.events.event_types.similarity_based.similarity_event import (
    SimilarityEvent,
)
from app.core.events.event_types.time.time_event import TimeData, TimeEvent
from app.core.events.event_types.utterance_length.utterance_length_event import (
    UtteranceLengthData,
    UtteranceLengthEvent,
)
from app.core.logger import get_logger


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
    metadata: Optional[Mapping[str, Any]] = None,
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
    raw_config = ev.get("detectionConfig") or ev.get("detection_config") or {}

    start_time_val = raw_config.get("startTime")
    end_time_val = raw_config.get("endTime")
    min_score_val = raw_config.get("minScore")
    max_score_val = raw_config.get("maxScore")
    min_gap_val = raw_config.get("minGapTime")
    max_occ_val = raw_config.get("maxOccurrences")
    occurrence_interval_val = raw_config.get("occurrenceInterval")

    #  Create the Pydantic model instance
    detection_config = DetectionConfig(
        start_time=float(start_time_val) if start_time_val is not None else None,
        end_time=float(end_time_val) if end_time_val is not None else None,
        min_score=int(min_score_val) if min_score_val is not None else None,
        max_score=int(max_score_val) if max_score_val is not None else None,
        min_gap_time=float(min_gap_val) if min_gap_val is not None else None,
        max_occurrences=int(max_occ_val) if max_occ_val is not None else None,
        occurrence_interval=(
            float(occurrence_interval_val)
            if occurrence_interval_val is not None
            else None
        ),
    )

    # Parse branching instruction if present
    branching_instruction_str = ev.get("branchInstruction")
    branching_instruction_obj = None

    if branching_instruction_str:

        prompt_data = metadata.get("promptData")

        branching_instruction_obj = BranchingInstruction.create(
            branching_instruction_str, prompt_data
        )

    common_fields = {
        "score": ev.get("score"),
        "emoji": ev.get("emoji"),
        "emoji_message": ev.get("message"),
        "branching_instruction": branching_instruction_obj,
        "show_feedback": ev.get("feedbackStatus", True),
        "detection_config": detection_config,
    }

    try:
        if detection_type == DetectionType.SENTENCE_SIMILARITY:
            if not settings.SENTENCE_SIMILARITY_DETECTION_ENABLED:
                log.warning(
                    "Event '%s' (SENTENCE_SIMILARITY) skipped: detection disabled "
                    "(SENTENCE_SIMILARITY_DETECTION_ENABLED=False)",
                    event_id,
                )
                return None

            sentences = []
            if raw_data and isinstance(raw_data, dict) and "sentences" in raw_data:
                sentences = raw_data.get("sentences", [])
            elif "sentences" in ev:
                sentences = ev.get("sentences", [])
            if not isinstance(sentences, list):
                log.warning(
                    "Event '%s' (SENTENCE_SIMILARITY) invalid 'sentences' field: %r",
                    event_id,
                    raw_data,
                )
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
                log.warning(
                    "Event '%s' (TIME) missing/invalid data: %r", event_id, raw_data
                )
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
                log.warning(
                    "Event '%s' (SCORE) missing/invalid data: %r", event_id, raw_data
                )
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
            if not settings.SEMANTIC_SIMILARITY_DETECTION_ENABLED:
                log.warning(
                    "Event '%s' (SEMANTIC_SIMILARITY) skipped: detection disabled "
                    "(SEMANTIC_SIMILARITY_DETECTION_ENABLED=False)",
                    event_id,
                )
                return None

            sentences = []
            similarity_threshold = None
            if raw_data and isinstance(raw_data, dict):
                sentences = raw_data.get("sentences", [])
                similarity_threshold = raw_data.get("threshold")
            elif "sentences" in ev:
                sentences = ev.get("sentences", [])

            if not isinstance(sentences, list):
                log.warning(
                    "Event '%s' (SEMANTIC_SIMILARITY) invalid 'sentences' field: %r",
                    event_id,
                    raw_data,
                )
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
                log.warning(
                    "Event '%s' (COMBINATION) missing/invalid data: %r",
                    event_id,
                    raw_data,
                )
                return None
            try:
                expression = _parse_expression(raw_data.get("expression", {}))
                combination_data = CombinationData(
                    dependent_events=raw_data.get("dependent_events", []),
                    expression=expression,
                )
            except Exception as e:
                log.warning(
                    "Event '%s' (COMBINATION) invalid expression/data: %s", event_id, e
                )
                return None

            return CombinationEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=combination_data,
                **common_fields,
            )

        elif detection_type == DetectionType.BINARY_CLASSIFIER:
            if not raw_data or not isinstance(raw_data, dict):
                log.warning(
                    "Event '%s' (BINARY_CLASSIFIER) missing/invalid data: %r",
                    event_id,
                    raw_data,
                )
                return None

            classifier_data = _parse_binary_classifier_data(raw_data, event_id, log)
            if not classifier_data:
                return None

            return BinaryClassifierEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=classifier_data,
                prompt_data=(metadata or {}).get("promptData"),
                **common_fields,
            )

        elif detection_type == DetectionType.HELPER_UTTERANCE_LENGTH:
            if raw_data is None or not isinstance(raw_data, dict):
                log.warning(
                    "Event '%s' (HELPER_UTTERANCE_LENGTH) missing/invalid data: %r",
                    event_id,
                    raw_data,
                )
                return None

            try:
                utterance_length_data = UtteranceLengthData(**raw_data)
            except Exception as e:
                log.warning(
                    "Event '%s' (HELPER_UTTERANCE_LENGTH) invalid data: %s", event_id, e
                )
                return None

            return UtteranceLengthEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=utterance_length_data,
                **common_fields,
            )

        elif detection_type == DetectionType.HELPER_INTERRUPTED:
            # Interruption events don't require data, but we accept it if provided
            try:
                interruption_data = InterruptionData()
                if raw_data and isinstance(raw_data, dict):
                    # Allow empty dict or no data for interruption events
                    interruption_data = InterruptionData(**raw_data)
            except Exception as e:
                log.warning(
                    "Event '%s' (HELPER_INTERRUPTED) invalid data: %s", event_id, e
                )
                return None

            return InterruptionEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=interruption_data,
                **common_fields,
            )

        elif detection_type == DetectionType.HELPER_PARAPHRASED:
            # HelperParaphrasedData has no required fields, so data is optional
            try:
                helper_paraphrased_data = HelperParaphrasedData()
                if raw_data and isinstance(raw_data, dict):
                    helper_paraphrased_data = HelperParaphrasedData(**raw_data)
            except Exception as e:
                log.warning(
                    "Event '%s' (HELPER_PARAPHRASED) invalid data: %s",
                    event_id,
                    e,
                )
                return None

            return HelperParaphrasedEvent.create(
                event_id=event_id,
                visibility_type=visibility_type,
                detection_type=detection_type,
                data=helper_paraphrased_data,
                embedding_client=embedding_client,
                prompt_data=(metadata or {}).get("promptData"),
                **common_fields,
            )

        else:
            log.warning(
                "Event '%s' unknown detection type: %s", event_id, detection_type
            )
            return None

    except Exception as e:
        log.exception(
            "Unhandled exception while creating event '%s' (type=%s): %s",
            event_id,
            detection_type,
            e,
        )
        return None


def _parse_binary_classifier_data(
    raw_data: dict, event_id: str, log
) -> Optional[BinaryClassifierData]:
    """
    Parse raw binary classifier data from metadata into BinaryClassifierData.
    Handles camelCase keys from backend.

    Args:
        raw_data: Raw data dictionary from metadata
        event_id: Event ID for logging
        log: Logger instance

    Returns:
        BinaryClassifierData instance or None if parsing fails
    """
    class_name = raw_data.get("className")
    if not class_name:
        log.warning(
            "Event '%s' (BINARY_CLASSIFIER) missing 'className' field: %r",
            event_id,
            raw_data,
        )
        return None

    positive_examples = None
    negative_examples = None

    pos_examples_raw = raw_data.get("positiveExamples")
    if pos_examples_raw and isinstance(pos_examples_raw, list):
        positive_examples = [
            Example(text=ex["text"]) if isinstance(ex, dict) else Example(text=str(ex))
            for ex in pos_examples_raw
        ]

    neg_examples_raw = raw_data.get("negativeExamples")
    if neg_examples_raw and isinstance(neg_examples_raw, list):
        negative_examples = [
            Example(text=ex["text"]) if isinstance(ex, dict) else Example(text=str(ex))
            for ex in neg_examples_raw
        ]

    try:
        return BinaryClassifierData(
            class_name=class_name,
            positive_examples=positive_examples,
            negative_examples=negative_examples,
        )
    except Exception as e:
        log.warning("Event '%s' (BINARY_CLASSIFIER) invalid data: %s", event_id, e)
        return None


def _expand_combination_expression(
    expression: ExpressionNode,
    combination_events_map: Dict[str, ExpressionNode],
    visited: Optional[set] = None,
) -> ExpressionNode:
    """
    Recursively expand an expression by replacing IDENTIFIER nodes that reference
    combination events with the referenced event's expression.

    This ensures that combination event expressions only contain references to
    simple (non-combination) events.

    Args:
        expression: The expression node to expand
        combination_events_map: Map of combination event IDs to their expressions
        visited: Set of event IDs already visited (for cycle detection)

    Returns:
        A new ExpressionNode with all combination event references expanded
    """
    if visited is None:
        visited = set()

    if expression.type == "IDENTIFIER":
        event_id = expression.id
        if event_id and event_id in combination_events_map:
            # Check for circular reference
            if event_id in visited:
                # Return the identifier as-is to avoid infinite recursion
                # The circular dependency check in EventOrchestrator will handle this
                return expression
            # Recursively expand the referenced combination event's expression
            visited.add(event_id)
            return _expand_combination_expression(
                combination_events_map[event_id], combination_events_map, visited.copy()
            )
        # Not a combination event, return as-is
        return expression

    elif expression.type == "NOT":
        if expression.operand:
            expanded_operand = _expand_combination_expression(
                expression.operand, combination_events_map, visited.copy()
            )
            return ExpressionNode(type="NOT", operand=expanded_operand)
        return expression

    elif expression.type in ("AND", "OR"):
        expanded_left = None
        expanded_right = None
        if expression.left:
            expanded_left = _expand_combination_expression(
                expression.left, combination_events_map, visited.copy()
            )
        if expression.right:
            expanded_right = _expand_combination_expression(
                expression.right, combination_events_map, visited.copy()
            )
        return ExpressionNode(
            type=expression.type, left=expanded_left, right=expanded_right
        )

    # Unknown type, return as-is
    return expression


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
            type="NOT", operand=_parse_expression(expr_dict["operand"])
        )

    elif node_type in ("AND", "OR"):
        if "left" not in expr_dict or "right" not in expr_dict:
            raise ValueError(
                f"{node_type} expression must have 'left' and 'right' fields"
            )
        return ExpressionNode(
            type=node_type,
            left=_parse_expression(expr_dict["left"]),
            right=_parse_expression(expr_dict["right"]),
        )

    else:
        raise ValueError(f"Unknown expression type: {node_type}")


def _extract_language_code(source: Mapping[str, Any]) -> str:
    """
    Extract language_code from a dictionary, checking both direct fields
    and nested languageConfig.

    Args:
        source: Dictionary to extract language_code from

    Returns:
        Extracted language_code or DEFAULT_LANGUAGE_CODE if not found
    """
    # First check for languageCode directly (most common case)
    language_code = (
        source.get("languageCode")
        or source.get("language_code")
        or DEFAULT_LANGUAGE_CODE
    )

    # Then check for nested languageConfig dict
    if language_code == DEFAULT_LANGUAGE_CODE:
        language_config = source.get("languageConfig") or source.get("language_config")
        if isinstance(language_config, dict):
            language_code = (
                language_config.get("language_code")
                or language_config.get("languageCode")
                or DEFAULT_LANGUAGE_CODE
            )

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

    Args:
        metadata: Scenario metadata from backend
        on_unknown: How to handle unknown events ("ignore", "warn", or "error")
        logger: Optional logger instance
        embedding_client: Optional embedding client for semantic similarity events
    """
    import logging

    events: List[BaseEvent] = []
    unknown_ids: list[str] = []
    reasons: Dict[str, str] = {}

    # ensure we have a logger
    log = logger if logger is not None else logging.getLogger(__name__)
    log.debug("build_events_from_metadata called")

    # Extract language_code from metadata
    # If metadata has a "scenario" key, extract from that section;
    # otherwise metadata is the scenario itself
    scenario_section = metadata.get("scenario")
    if isinstance(scenario_section, dict):
        language_code = _extract_language_code(scenario_section)
    else:
        language_code = _extract_language_code(metadata)

    # normalize event list location: metadata may be {"scenario": {...}} or
    # the raw scenario
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

        log.debug(
            "Processing event id=%s raw_detectionType=%s",
            event_id,
            ev.get("detectionType"),
        )

        # determine detection type (strict name lookup first)
        detection_type_str = ev.get("detectionType")
        detection_type = None
        if detection_type_str is None:
            # backward compatibility: old format with 'sentences' => SENTENCE_SIMILARITY
            if "sentences" in ev:
                detection_type = DetectionType.SENTENCE_SIMILARITY
                log.debug(
                    "Event %s: inferred detection type SENTENCE_SIMILARITY "
                    "from legacy 'sentences' field",
                    event_id,
                )
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
                metadata=metadata,
            )
            if instance is None:
                reason = (
                    "factory returned None (validation/parsing failed "
                    "inside _create_event_by_detection_type)"
                )
                log.warning("Event '%s' skipped: %s", event_id, reason)
                unknown_ids.append(event_id)
                reasons[event_id] = reason
                continue

            events.append(instance)
            log.info(
                "Created event object: id=%s type=%s class=%s",
                event_id,
                detection_type.name,
                instance.__class__.__name__,
            )

        except Exception as e:
            log.exception("Failed to create event '%s': %s", event_id, e)
            unknown_ids.append(event_id)
            reasons[event_id] = f"exception: {e}"
            if on_unknown == "error":
                raise

    # Summarize skipped events if requested
    if unknown_ids:
        if on_unknown == "warn":
            log.warning(
                "Some events were skipped (%d): %s", len(unknown_ids), unknown_ids
            )
            for eid, r in reasons.items():
                log.debug("Skipped reason: %s -> %s", eid, r)
        elif on_unknown == "error":
            raise UnknownEventIdError(unknown_ids)

    # Expand combination event expressions to only reference simple events
    # Build a map of combination event IDs to their expressions
    combination_events_map: Dict[str, ExpressionNode] = {}
    for event in events:
        if event.detection_type == DetectionType.COMBINATION:
            if hasattr(event, "data") and hasattr(event.data, "expression"):
                combination_events_map[event.event_id] = event.data.expression

    # Expand each combination event's expression
    if combination_events_map:
        for event in events:
            if event.detection_type == DetectionType.COMBINATION:
                if hasattr(event, "data") and hasattr(event.data, "expression"):
                    expanded_expression = _expand_combination_expression(
                        event.data.expression, combination_events_map
                    )
                    event.data.expression = expanded_expression
        log.debug(
            "Expanded %d combination event expressions to reference only simple events",
            len(combination_events_map),
        )

    log.info(
        "build_events_from_metadata: built %d event objects, skipped %d",
        len(events),
        len(unknown_ids),
    )
    return events
