"""Constants for guardrail event detection."""

# Similarity threshold for cosine similarity (0-1 range).
# Slightly lower than semantic similarity default (0.75) to cast a wider net
# since counselors can phrase boundary-crossing statements many ways.
GUARDRAIL_SIMILARITY_THRESHOLD = 0.72
