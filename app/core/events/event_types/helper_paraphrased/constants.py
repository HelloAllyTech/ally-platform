"""Constants for helper paraphrased event detection."""

from pydantic import BaseModel


class HelperParaphrasedData(BaseModel):
    """Data structure for HELPER_PARAPHRASED detection type."""

    class Config:
        frozen = True
