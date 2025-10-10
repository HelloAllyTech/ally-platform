from typing import List, Optional

from pydantic import BaseModel, Field

from app.core.constants import VisibilityType


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


class LivekitMetadata(BaseModel):
    version: str
    scenario: Scenario

class ChatMessage(BaseModel):
    role: str = Field(..., description="The role of the sender (e.g., user, assistant, counselor)")
    content: str = Field(..., description="The content of the message")
    start_time: Optional[float] = Field(None, description="Start time of the message in seconds (relative position)")
    end_time: Optional[float] = Field(None, description="End time of the message in seconds (relative position)")

    class Config:
        json_schema_extra = {
            "example": {
                "role": "counselor",
                "content": "Hello, how are you?",
                "start_time": 0.5,
                "end_time": 5.7,
            }
        }
