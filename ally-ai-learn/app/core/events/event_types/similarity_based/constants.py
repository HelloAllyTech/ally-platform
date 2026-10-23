from typing import Final

DEFAULT_STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "you",
        "your",
        "youre",
        "to",
        "the",
        "this",
        "that",
        "is",
        "are",
        "am",
        "be",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "of",
        "on",
        "in",
        "at",
        "it",
        "a",
        "an",
        "and",
        "or",
        "for",
        "with",
        "from",
        "as",
        "by",
        "about",
    }
)
MATCH_THRESHOLD: Final[float] = 0.6
MIN_MATCH_TOKENS: Final[int] = 2
