"""Scripted agent steps and a fake model for the conversational agent's tests.

`FakeLLM` stands in for `generate_structured` in agent_runtime/conversation.py
(patch `CONVERSATION.generate_structured`) and returns the next scripted step.
"""

CONVERSATION = "app.core.agent_runtime.conversation"
META = {"provider": "openai", "model": "gpt-5-mini"}


def reply(
    intent="answer",
    answer="Here you go.",
    citations=(),
    language="en",
    turn_type="question",
):
    return {
        "action": "reply",
        "turn_type": turn_type,
        "intent": intent,
        "answer": answer,
        "citations": list(citations),
        "language": language,
    }


def chat(answer="Hi! How can I help?", turn_type="smalltalk", **kw):
    return reply("smalltalk", answer, turn_type=turn_type, **kw)


def search(query, language="en"):
    return {
        "action": "search_knowledge",
        "turn_type": "question",
        "search_knowledge": {"query": query},
        "language": language,
    }


class FakeLLM:
    """Stands in for generate_structured; records every call's schema and prompt."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.calls = []

    async def __call__(self, *, schema, prompt, **kwargs):
        self.calls.append({"schema": schema, "prompt": prompt, **kwargs})
        return schema.model_validate(self.steps.pop(0)), META


def nodes(state):
    return [step["node"] for step in state["trace"]]
