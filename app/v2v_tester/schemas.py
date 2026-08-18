"""Pydantic schemas for the V2V tester API."""

from pydantic import BaseModel, Field


class StartV2VTesterRequest(BaseModel):
    roomName: str = Field(..., description="LiveKit room name to join")
    testerToken: str = Field(
        ..., description="LiveKit participant JWT for the tester bot"
    )
    maxExchanges: int = Field(
        default=12, ge=1, le=50, description="Max learner→counselor turns"
    )
    language: str = Field(
        default="en", description="BCP 47 language code, e.g. 'en' or 'hi-IN'"
    )
    scenarioTitle: str = Field(default="", description="Scenario title for LLM context")
    scenarioContext: str = Field(
        default="", description="Character/scenario description for LLM"
    )
    scenarioSessionId: str = Field(
        ..., description="Session ID so the bot can end the session when done"
    )
    counselorId: int = Field(
        ..., description="User ID of the session owner (counselorId in ally-be)"
    )


class StartV2VTesterResponse(BaseModel):
    status: str = "started"
    roomName: str
