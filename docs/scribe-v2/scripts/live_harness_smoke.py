"""Live smoke test of the Scribe v2 harness on a synthetic (made-up) session."""
import asyncio, json, os, sys, time
from pathlib import Path
from langchain_openai import ChatOpenAI
from app.core.note_harness.harness import NoteHarness
from app.core.note_harness.pipeline import run_note_pipeline
from app.core.note_harness.models import NoteHarnessRequest

ROOT = Path("app/prompts")
SCRIPT = [
 ("COUNSELOR", "Hello, thank you for calling. What would you like to talk about today?"),
 ("CLIENT", "I found your number through a poster at my college. I haven't been sleeping for about two weeks."),
 ("COUNSELOR", "Two weeks without proper sleep sounds exhausting. What has been keeping you up?"),
 ("CLIENT", "My exams start next month and I keep thinking I will fail. My father shouts when my marks are low."),
 ("COUNSELOR", "So the exams and your father's reaction are both weighing on you."),
 ("CLIENT", "Yes. Last week I thought about running away to my aunt's house in Pune."),
 ("COUNSELOR", "Thank you for telling me that. Have you had any thoughts of hurting yourself?"),
 ("CLIENT", "No, nothing like that. I just want to get away from the shouting."),
 ("COUNSELOR", "Is there someone at home you feel safe talking to?"),
 ("CLIENT", "My older sister. She listens to me."),
 ("COUNSELOR", "Let's try one thing for sleep: no phone for thirty minutes before bed, and write your worries in a notebook."),
 ("CLIENT", "I can try the notebook. The phone will be hard."),
 ("COUNSELOR", "Could you talk to your sister this week about how the shouting affects you?"),
 ("CLIENT", "Okay, I will talk to her on Saturday."),
 ("COUNSELOR", "Would you like to call again next week so we can see how it went?"),
 ("CLIENT", "Yes, next Thursday evening is good."),
]
# STT-style lines with no speaker labels: the roles call has to work them out.
SEGMENTS_TEXT = "\n".join(f"{i*30:.2f}-{i*30+25:.2f}: {t}" for i, (_, t) in enumerate(SCRIPT))
request = NoteHarnessRequest.model_validate({
  "note_spec": {"fields": [
    {"id": "f-referral", "label": "Referral source", "type": "SINGLE_SELECT",
     "options": [{"id": "o-poster", "label": "Poster or flyer"}, {"id": "o-friend", "label": "Friend"}, {"id": "o-web", "label": "Website"}]},
    {"id": "f-concerns", "label": "Key concerns", "type": "MULTILINE_TEXT"},
    {"id": "f-topics", "label": "Topics", "type": "MULTI_SELECT",
     "options": [{"id": "t-sleep", "label": "Sleep"}, {"id": "t-family", "label": "Family conflict"}, {"id": "t-academic", "label": "Academic stress"}, {"id": "t-money", "label": "Money"}]},
    {"id": "f-age", "label": "Client age", "type": "NUMBER"},
    {"id": "f-followup", "label": "Follow-up agreed", "type": "BOOLEAN"},
  ]},
  "context": {"session_date": "2026-11-18"},
})

llm = ChatOpenAI(model="gpt-4o-mini-2024-07-18", temperature=0, api_key=os.environ["OPENAI__API_KEY"])

def render(path, **v):
    return (ROOT / f"{path}.txt").read_text().format(**v)

async def invoke(prompt, schema, path, max_tokens):
    return await llm.with_structured_output(schema).ainvoke(prompt)

async def main():
    small = len(sys.argv) > 1  # force map-reduce
    h = NoteHarness(render, invoke, **({"single_pass_words": 50, "segment_words": 60} if small else {}))
    t = time.time()
    r = await run_note_pipeline(render, invoke, request, "SCRIBE", segments_text=SEGMENTS_TEXT, harness=h)
    truth = [s for s, _ in SCRIPT]
    got = [t["speaker"] for t in r.transcript]
    print("roles correct:", sum(a == b for a, b in zip(truth, got)), "/", len(truth))
    print(json.dumps(r.model_dump(), indent=1)[:6000])
asyncio.run(main())
