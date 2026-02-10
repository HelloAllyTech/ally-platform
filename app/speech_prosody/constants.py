"""
Constants for speech prosody generation.
"""

# Default number of conversation messages to include in prosody generation
DEFAULT_CONVERSATION_HISTORY_LIMIT = 7

# Maximum allowed percentage change per turn for prosody parameters
# 0.10 = 10% max change per turn. This prevents wild swings like 1.0 -> 2.5
MAX_TURN_DELTA_PERCENT = 0.10

# Safe defaults for fallback
SAFE_SPEAKING_RATE = 1.0
SAFE_PITCH = 0.0
SAFE_VOLUME_GAIN_DB = 0.0
