from typing import Mapping, Any

from pydantic import BaseModel

from app.core.scenario.base import Scenario


class RoomMetadataEnvelope(BaseModel):
    """
    Lightweight wrapper for the top-level BE payload.
    Keeps `version` and a typed `scenario`.
    """
    version: str
    scenario: Scenario

    @classmethod
    def create(cls, payload: Mapping[str, Any]) -> "RoomMetadataEnvelope":
        """
        Parse from a full BE payload. If only a scenario dict is passed,
        default `version` to "1.0".
        """
        scenario = Scenario.create(payload)
        version = payload.get("version", "1.0")
        return cls(version=version, scenario=scenario)