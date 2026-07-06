"""Room-metadata parsing for roleplay v2 (mirrors app.core.agent.factory)."""

import json

from app.core.config import settings
from app.core.constants import Environment
from app.core.logger import get_logger
from app.roleplay_v2.spec.models import RoleplaySpecEnvelope

logger = get_logger(__name__)


def parse_spec_metadata(metadata) -> RoleplaySpecEnvelope:
    """Parse v2 room metadata JSON into a RoleplaySpecEnvelope.

    Mirrors ``parse_room_metadata`` in app/core/agent/factory.py (lines 48-60):
    when the metadata is missing/invalid AND we are running LOCAL, fall back to
    the checked-in sample spec so a bare `python -m app.worker_v2 dev` session
    just works; anywhere else a bad payload is a hard error.

    Note: when the envelope carries ``specFetch`` instead of an inline spec,
    the caller must still ``await envelope.ensure_spec()``.
    """
    try:
        parsed = json.loads(metadata or "")
    except json.JSONDecodeError:
        parsed = None

    if parsed is None:
        if settings.ENV == Environment.LOCAL:
            logger.warning(
                "Missing/invalid v2 metadata in local; using SCENARIO_SPEC_SAMPLE."
            )
            from scenario_spec_sample import SCENARIO_SPEC_SAMPLE

            parsed = SCENARIO_SPEC_SAMPLE
        else:
            raise ValueError("roleplay_v2 metadata missing or invalid.")

    return RoleplaySpecEnvelope.model_validate(parsed)
