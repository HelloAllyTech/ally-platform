"""Every prompt this service renders must come from the Skills Store.

The session's prompt data carries each prompt's live version. A render call
that leaves it out silently runs the local default instead, and the defaults
in Git are minimal bases, not the tuned text. So every `load_and_format` /
`load_template` call in app/ must pass the prompt data.
"""

import ast
from pathlib import Path

from app.core.events.event_types.binary_classifier.prompts import (
    get_batch_binary_classifier_prompt,
    get_binary_classifier_prompt,
)
from app.core.events.event_types.binary_classifier.schemas import BinaryClassifierData
from app.core.events.event_types.helper_paraphrased.prompts import (
    get_paraphrase_evaluation_prompt,
)

APP_DIR = Path(__file__).resolve().parents[2] / "app"
RENDERERS = {"load_and_format", "load_template"}


def _calls_without_prompt_data() -> list[str]:
    found = []
    for path in sorted(APP_DIR.rglob("*.py")):
        if path.parent.name == "prompts" and path.parent.parent == APP_DIR:
            continue  # the resolver itself
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name not in RENDERERS:
                continue
            passes_data = len(node.args) >= 2 or any(
                kw.arg == "prompt_data" for kw in node.keywords
            )
            if not passes_data:
                found.append(f"{path.relative_to(APP_DIR.parent)}:{node.lineno}")
    return found


def test_every_render_passes_the_sessions_prompt_data():
    missing = _calls_without_prompt_data()
    assert not missing, (
        f"These render calls don't pass prompt_data, so they ignore the Skills "
        f"Store and run the local default: {missing}"
    )


def _store(code: str, text: str) -> dict:
    return {"prompts": {code: {"prompt": text}}}


def test_binary_classifier_renders_the_store_text():
    data = _store("ally_ai_learn_events_binary_classifier_system", "STORE {class_name}")
    data["prompts"]["ally_ai_learn_events_binary_classifier_user"] = {
        "prompt": "STORE USER {message}"
    }
    system, user = get_binary_classifier_prompt("Empathy", "hi", prompt_data=data)
    assert system.startswith("STORE Empathy")
    assert user == "STORE USER hi"


def test_batch_binary_classifier_renders_the_store_text():
    data = _store(
        "ally_ai_learn_events_binary_classifier_batch_system", "STORE {classes_block}"
    )
    system, _ = get_batch_binary_classifier_prompt(
        [("e1", BinaryClassifierData(class_name="Empathy"))], "hi", prompt_data=data
    )
    assert system.startswith("STORE")


def test_helper_paraphrased_renders_the_store_text():
    data = _store("ally_ai_learn_events_helper_paraphrased_system", "STORE SYSTEM")
    system, _ = get_paraphrase_evaluation_prompt("a", "b", prompt_data=data)
    assert system == "STORE SYSTEM"


def test_bad_session_data_keeps_the_store_prompts():
    from app.core.scenario.base import Scenario

    prompts = {"ally_ai_learn_system_main_agent_prompt": {"prompt": "STORE MAIN"}}
    data = Scenario._build_prompt_data(
        {
            "promptData": {
                "title": "A scenario",
                # One malformed field: opening statements must be strings.
                "openingStatements": [None, {"not": "a string"}],
                "prompts": prompts,
            }
        }
    )
    assert data.prompts == prompts
    assert data.title == "A scenario"
    assert data.opening_statements == []


def test_selected_variant_prefers_store_text_over_local_files():
    from app.prompts.resolver import load_and_format_by_code

    # The selected variant is missing from the store; the main prompt's store
    # text must win over the variant's (minimal) local file.
    data = {
        "prompts": {
            "ally_ai_learn_system_main_agent_prompt": {"prompt": "STORE MAIN"},
        }
    }
    text = load_and_format_by_code(
        "ally_ai_learn_system_main_agent_prompt_full",
        data,
        fallback_internal_path="system/main_agent_prompt",
    )
    assert text == "STORE MAIN"


def test_selected_variant_runs_its_store_text_when_present():
    from app.prompts.resolver import load_and_format_by_code

    data = {
        "prompts": {
            "ally_ai_learn_system_main_agent_prompt_full": {"prompt": "STORE FULL"},
            "ally_ai_learn_system_main_agent_prompt": {"prompt": "STORE MAIN"},
        }
    }
    text = load_and_format_by_code(
        "ally_ai_learn_system_main_agent_prompt_full",
        data,
        fallback_internal_path="system/main_agent_prompt",
    )
    assert text == "STORE FULL"
