"""Room metadata parsing utilities."""
import json
from typing import Mapping,Any
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.utils.logger import get_logger

logger = get_logger(__name__)


def parse_room_metadata(metadata) -> RoomMetadataEnvelope:
    """
    Parse room metadata JSON into RoomMetadataEnvelope.
    Returns empty envelope on error.
    """
    try:
        logger.debug("Parsing job metadata: %s", metadata)
        metadata_dict = json.loads(metadata) if metadata else {}
        return RoomMetadataEnvelope.create(metadata_dict)

    except json.JSONDecodeError as e:
        logger.error("Invalid JSON in metadata: %s", e)
        return RoomMetadataEnvelope.create({})

    except Exception as e:
        logger.exception("Unexpected error parsing metadata")
        return RoomMetadataEnvelope.create({})