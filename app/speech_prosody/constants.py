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

# Param names that control speech rate (pace/speed); cap at safe default to avoid
# LLM generating excessively fast speech (e.g. pace 1.455)
RATE_PARAM_NAMES = frozenset({"pace", "speed", "speaking_rate"})

# Skip runtime prosody when under pressure (reduces latency, keeps last params)
PROSDY_SKIP_ENABLED = True
# MIN: skip short responses where prosody impact is low
PROSDY_SKIP_MIN_RESPONSE_LENGTH = 50
# MAX: skip very long responses to avoid compounding latency (0 = disabled)
PROSDY_SKIP_MAX_RESPONSE_LENGTH = 0
# Skip when events detected this turn (prioritize responsiveness)
PROSDY_SKIP_WHEN_EVENTS_DETECTED = True
