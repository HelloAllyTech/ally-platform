from enum import Enum


class ReservedBranchingVariable(str, Enum):
    """
    Enum for all reserved branching instruction variables.

    These are special variables that have specific handling in the system.
    Some are truly dynamic (change during conversation), while others are
    computed once per branching instruction evaluation.
    """

    CHAT_SUMMARY = "chat_summary"
    LAST_HELPER_UTTERANCE = "last_helper_utterance"
    LLM_RESPONSE = "llm_response"


# List of variables that are truly dynamic and change during conversation
# These need to be re-evaluated each time the branching instruction is used
BRANCHING_DYNAMIC_VARIABLES = [
    ReservedBranchingVariable.CHAT_SUMMARY.value,
    ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value,
]

# Note: LLM_RESPONSE is NOT in BRANCHING_DYNAMIC_VARIABLES because:
# - It's computed once when the branching instruction is evaluated
# - It doesn't change during the conversation
# - It's substituted before being sent to the LLM
