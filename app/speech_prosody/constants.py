"""
Constants for speech prosody generation.
"""

# Default number of conversation messages to include in prosody generation
DEFAULT_CONVERSATION_HISTORY_LIMIT = 7

# Maximum allowed percentage change per turn for prosody parameters
# 0.03 = 3% max change per turn (aligns with prompt: pace/speed 3%, pitch 5%)
# Prevents wild swings and speech speeding up over conversation
MAX_TURN_DELTA_PERCENT = 0.03

# Safe defaults for fallback
SAFE_SPEAKING_RATE = 1.0
SAFE_PITCH = 0.0
SAFE_VOLUME_GAIN_DB = 0.0
