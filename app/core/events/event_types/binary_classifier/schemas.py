from pydantic import BaseModel
from typing import Optional, List

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
