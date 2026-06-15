from typing import List, Optional

from pydantic import BaseModel


# Only used for structured output
class ClassificationResultStrOp(BaseModel):
    is_class: bool


# Structured output for batched classification: one entry per event/class.
class BatchClassificationItem(BaseModel):
    event_id: str
    is_class: bool


class BatchClassificationResultStrOp(BaseModel):
    results: List[BatchClassificationItem]


class Example(BaseModel):
    text: str


class BinaryClassifierData(BaseModel):
    class_name: str
    positive_examples: Optional[List[Example]] = None
    negative_examples: Optional[List[Example]] = None

    class Config:
        frozen = True
