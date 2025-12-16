"""Data models for combination events."""

from typing import List, Optional

from pydantic import BaseModel, Field


class ExpressionNode(BaseModel):
    """Node in a logical expression tree for COMBINATION events."""

    type: str = Field(..., description="Node type: 'AND', 'OR', 'NOT', or 'IDENTIFIER'")
    id: Optional[str] = Field(None, description="Event ID for IDENTIFIER type")
    left: Optional["ExpressionNode"] = Field(
        None, description="Left operand for AND/OR"
    )
    right: Optional["ExpressionNode"] = Field(
        None, description="Right operand for AND/OR"
    )
    operand: Optional["ExpressionNode"] = Field(None, description="Operand for NOT")


# Allow forward references for recursive model
ExpressionNode.model_rebuild()


class CombinationData(BaseModel):
    """Data structure for COMBINATION detection type."""

    dependent_events: List[str] = Field(
        default_factory=list, description="List of event IDs this depends on"
    )
    expression: ExpressionNode = Field(..., description="Logical expression tree")
