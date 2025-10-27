from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field

from app.core.constants import VisibilityType
from app.core.scenario.base import ScenarioVoice, VoicePromptData


class ScenarioEvent(BaseModel):
    id: str
    name: Optional[str] = None
    score: int
    emoji: str
    message: str
    conversationInstruction: str
    visibilityType: Optional[VisibilityType] = Field(default=None, description="Optional visibility type for backward compatibility")

class Scenario(BaseModel):
    id: str
    scenarioName: Optional[str] = None
    learningObjective: Optional[str] = None
    prompt: Optional[str] = None
    lifeHistory: Optional[str] = None
    events: List[ScenarioEvent]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    voice: ScenarioVoice = Field(default_factory=ScenarioVoice)
    prompt_data : VoicePromptData = Field(default_factory=VoicePromptData)


class LivekitMetadata(BaseModel):
    version: str
    scenario: Scenario
