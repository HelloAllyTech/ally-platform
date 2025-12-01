from typing import Mapping, Any, Optional

from pydantic import BaseModel

from app.core.scenario.base import Scenario
from app.core.embeddings import BaseEmbeddingClient


class RoomMetadataEnvelope(BaseModel):
    """
    Lightweight wrapper for the top-level BE payload.
    Keeps `version` and a typed `scenario`.
    """
    version: str
    scenario: Scenario

    @classmethod
    def create(cls, payload: Mapping[str, Any], embedding_client: Optional[BaseEmbeddingClient] = None) -> "RoomMetadataEnvelope":
        """
        Parse from a full BE payload. If only a scenario dict is passed,
        default `version` to "1.0".
        
        Args:
            payload: Room metadata payload
            embedding_client: Optional shared embedding client for semantic similarity events
        """
        scenario = Scenario.create(payload, embedding_client=embedding_client)
        version = payload.get("version", "1.0")
        return cls(version=version, scenario=scenario)