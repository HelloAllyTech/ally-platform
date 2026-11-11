"""A fake model for the builder: scripted outputs per sub-task schema.

Patch `TASKS.generate_structured` with a `FakeLLM`; each call pops the next output
scripted for that call's schema, so one step can run several sub-tasks.
"""

TASKS = "app.core.builder.tasks"
META = {"provider": "openai", "model": "gpt-5-mini"}


class FakeLLM:
    def __init__(self, **scripts):
        self.scripts = {name: list(outputs) for name, outputs in scripts.items()}
        self.calls = []

    async def __call__(self, *, schema, prompt, **kwargs):
        self.calls.append({"schema": schema.__name__, "prompt": prompt, **kwargs})
        outputs = self.scripts.get(schema.__name__)
        if not outputs:
            raise AssertionError(f"No scripted output for {schema.__name__}")
        return schema.model_validate(outputs.pop(0)), META

    def schemas(self):
        return [call["schema"] for call in self.calls]

    def prompts(self):
        return [call["prompt"] for call in self.calls]


def fact(section, text, url="https://sunrise.example/", by_owner=False, n=0):
    return {
        "id": f"f{n}-{section}",
        "section": section,
        "text": text,
        "sourceUrl": "owner" if by_owner else url,
        "byOwner": by_owner,
    }


LEARNED = {
    "facts": [
        fact("about", "Sunrise Mind Clinic offers therapy for adults in Pune.", n=1),
        fact("services", "Individual sessions cost ₹2,000 for 50 minutes.", n=2),
        fact("location", "Call us on 98200 12345.", n=3),
    ],
    "dropped": 0,
}

PAGES = [
    {"url": "https://sunrise.example/", "title": "Sunrise Mind Clinic"},
    {"url": "https://sunrise.example/fees", "title": "Fees"},
]


def request(step, **overrides):
    body = {
        "step": step,
        "learned": LEARNED,
        "pages": PAGES,
        "draft": {"name": "Sunrise Mind Clinic"},
        "safety_pack": {"id": "mental_health", "name": "Mental health safety"},
    }
    body.update(overrides)
    return body
