import random

_OPENING_LINES = [
    "Hi, I’m calling Ally Helpline and I’d like to speak with a counselor.",
    "Hello, I’m reaching out to the Ally Helpline for support.",
    "Hi, I’m calling the helpline to talk to someone about how I’m feeling.",
    "Hello, I’d like to speak with a counselor through the Ally Helpline.",
    "Hi there, I’m seeking support and calling the Ally Helpline.",
    "Hello, I’m looking for someone to talk to at the Ally Helpline.",
    "Hi, I need to talk to a counselor and I’m calling the Ally Helpline.",
    "Hello, I’m calling the helpline because I’d like to talk to someone now.",
    "Hi, I’m reaching out for support through the Ally Helpline today.",
    "Hello, I’m calling to speak with a counselor from the helpline.",
    "Hi, I’m contacting the Ally Helpline to get some support.",
    "Hello, I’d like to talk to someone from the helpline about what I’m going through.",
    "Hi, I’m calling because I could use some support right now.",
    "Hello, I’d appreciate speaking with a counselor at the Ally Helpline.",
    "Hi, I’m reaching out to talk to someone at the Ally Helpline.",
    "Hello, I’m calling the helpline to ask for support today.",
    "Hi, I’d like to connect with a counselor through the Ally Helpline.",
    "Hello, I’m calling to speak with someone who can help.",
    "Hi, I’m reaching out to the helpline and would like to talk with a counselor.",
    "Hello, I’m calling Ally Helpline to get support with what I’m feeling right now."
]

def get_opening_line() -> str:
    """Return a random opening line from the predefined list of helpline greetings.

    Returns:
        str: A randomly selected opening line for starting a helpline conversation.
    """

    return random.choice(_OPENING_LINES)