"""
Schemas for scenario operations.
"""
from typing import List, Optional

from pydantic import BaseModel, Field


class Scenario(BaseModel):
    """Schema for a scenario."""
    
    unique_id: str = Field(..., description="Unique identifier for the scenario")
    title: str = Field(..., description="Title of the scenario")
    short_description: str = Field(..., description="Short description of the scenario")
    long_description: str = Field(..., description="Long description of the scenario")
    cover_image: Optional[str] = Field(default=None, description="URL to the cover image for the scenario")


class ScenarioList(BaseModel):
    """Schema for a list of scenarios."""
    
    scenarios: List[Scenario] = Field(..., description="List of scenarios")
