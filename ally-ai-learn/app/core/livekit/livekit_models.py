from typing import Any, Dict, Mapping, Optional

from pydantic import BaseModel

from app.core.embeddings import BaseEmbeddingClient
from app.core.scenario.base import Scenario


class RoomMetadataEnvelope(BaseModel):
    """
    Lightweight wrapper for the top-level BE payload.
    Keeps `version` and a typed `scenario`.
    """

    version: str
    scenario: Scenario

    @classmethod
    def create(
        cls,
        payload: Mapping[str, Any],
        embedding_client: Optional[BaseEmbeddingClient] = None,
        branching_llm_config: Optional[Dict[str, Any]] = None,
    ) -> "RoomMetadataEnvelope":
        """
        Parse from a full BE payload. If only a scenario dict is passed,
        default `version` to "1.0".

        Args:
            payload: Room metadata payload
            embedding_client: Optional shared embedding client for
                semantic similarity events
            branching_llm_config: Optional LLM config for branching instruction
                resolution (structured output support)
        """
        scenario = Scenario.create(
            payload,
            embedding_client=embedding_client,
            branching_llm_config=branching_llm_config,
        )
        version = payload.get("version", "1.0")
        return cls(version=version, scenario=scenario)
