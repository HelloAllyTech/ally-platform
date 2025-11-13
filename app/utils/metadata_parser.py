"""Room metadata parsing utilities."""
import json

from app.core.config import settings
from app.core.constants import Environment
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.utils.logger import get_logger

logger = get_logger(__name__)


def parse_room_metadata(metadata) -> RoomMetadataEnvelope:
    """
    Parse room metadata JSON into RoomMetadataEnvelope.
    Returns empty envelope on error.
    """
    try:
        parsed = json.loads(metadata or "")
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        if settings.ENV == Environment.LOCAL:
            logger.warning("Missing/invalid metadata in local; using SCENARIO_SAMPLE.")
            from scenario_sample import SCENARIO_SAMPLE
            parsed = SCENARIO_SAMPLE
        else:
            raise ValueError("Metadata missing or invalid.")

    return RoomMetadataEnvelope.create(parsed)