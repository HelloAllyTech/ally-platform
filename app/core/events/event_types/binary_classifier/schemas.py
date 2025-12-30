from typing import List, Optional

from pydantic import BaseModel


# Only used for structured output
class ClassificationResultStrOp(BaseModel):
    is_class: bool


class Example(BaseModel):
    text: str


class BinaryClassifierData(BaseModel):
    class_name: str
    positive_examples: Optional[List[Example]] = None
    negative_examples: Optional[List[Example]] = None

    class Config:
        frozen = True
