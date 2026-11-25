"""TF1 round 2 (Saathi B-1): whole-message greetings and introductions."""

import pytest

from app.core.agent_runtime.greeting import is_greeting_or_intro


@pytest.mark.parametrize(
    "text",
    [
        "hi",
        "Hello!",
        "namaste ji",
        "Hi, I'm Asha",
        "hey, I am Asha Rao",
        "my name is Asha",
        "mera naam Asha hai",
        "Good evening",
        "नमस्ते",
        "मेरा नाम आशा है",
    ],
)
def test_a_greeting_or_an_introduction(text):
    assert is_greeting_or_intro(text)


@pytest.mark.parametrize(
    "text",
    [
        "Hi, I'm Asha, are you open now?",
        "I'm 16",
        "I'm scared",
        "I'm pregnant",
        "I'm stressed",
        "I'm feeling low",
        "Hi, I'm looking for a counsellor",
        "hi can someone call me back",
        "What are your hours?",
        "I'm so tired of everything",
        "call me tomorrow",
        "it's urgent",
        "this is serious",
        "main thak gayi hoon",
        "I'm homeless",
        "I'm hopeless",
        "",
    ],
)
def test_not_only_a_greeting(text):
    assert not is_greeting_or_intro(text)
