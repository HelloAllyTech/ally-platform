#!/usr/bin/env python3
"""
Generate language dialogue samples for linguistic style instruction.

Run this script to generate 10 sample counselor-client dialogues in the target
language. Copy the output into scenario metadata.linguisticStyleSamples (via
ally-be UI or API). ally-ai-learn uses samples when present.

Usage:
    python scripts/generate_language_samples.py -s SCENARIO_SAMPLE_MALAYALAM_AUTO
    python scripts/generate_language_samples.py -s SCENARIO_SAMPLE -l ml-IN
    python scripts/generate_language_samples.py -s SCENARIO_SAMPLE_HINDI -l hi-IN

Requires: OPENAI_API_KEY (or appropriate LLM env) for generation.
"""

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List

# Add project root to path (before app imports)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import HumanMessage  # noqa: E402

from app.core.constants import get_language_name_from_code  # noqa: E402
from app.core.embeddings import OpenAIEmbeddingClient  # noqa: E402
from app.core.logger import get_logger  # noqa: E402
from app.core.scenario.base import PromptData, Scenario  # noqa: E402
from app.llms import BaseLLMClient, create_llm_client  # noqa: E402

logger = get_logger(__name__)

# Inline prompt for language sample generation (self-contained, no external file)
_LANGUAGE_SAMPLE_GENERATION_PROMPT = """# Role
You are an expert Dialogue Writer for realistic South Asian urban cinema.
Your specialty is "Naturalism"—writing exactly how people speak in real life,
not how they write in books or newspapers.

# Task
Generate 10 sample CLIENT utterances for a counseling scenario.
These are things the person seeking help would say in a therapy session.

# Language & Persona
- Language: {language_name} ({language_code})
- Location/Dialect: {location} (Use the natural urban rhythm of this city)
- Speaker: {name}, {age}, {gender}
- Character/Challenge context: {emotional_state}

# Core Guidelines for Authenticity

1. THE SCRIPT RULE (CRITICAL)
- Use the **Native Script** (e.g., Devanagari, Malayalam, Tamil) for vernacular.
- Use **English (Latin) script** ONLY for loanwords (e.g., "stress", "result").
- DO NOT transliterate the entire sentence into Roman/English characters.
- Example (Malayalam): "എനിക്ക് ഭയങ്കര stress തോന്നുന്നു."
  (NOT "Enikku bhayankara stress thonnunnu").

2. THE "EXPERIENCE" RULE (Dative Logic)
In {language_name}, feelings are things that "happen to" a person.
- AVOID "Nominative" starts: Don't start every sentence with "I" (Njan/Naan/Main).
- PREFER "Experiencer" starts: Start with "To me" (Enikku/Enakku/Mujhe).

3. THE "URBAN REALITY" RULE (Code-Mixing)
Do NOT translate modern terminology into pure {language_name}.
Use English loanwords naturally as they are used in {location}.
- Use English script for: Stress, feel, pressure, result, exam, career, etc.
- If it sounds like a textbook, it is WRONG.

4. GENDER AGREEMENT
The speaker is {gender}.
- Indo-Aryan (Hindi/etc.): Use correct feminine/masculine markers.
- Dravidian (Tamil/Malayalam): Use colloquial pronouns/endings for {gender}.

5. SPOKEN STYLE
- Use fragments and repetitions. Use colloquial contractions
  (e.g., "illa" instead of "aagrahikkunnilla").

# Output
Return ONLY a JSON array of 10 strings. No intro, no outro."""


def _parse_samples(response_text: str) -> List[str]:
    """Parse LLM response. Expects JSON array of strings (sample utterances)."""
    text = response_text.strip()

    # Strip markdown code blocks if present
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    try:
        data = json.loads(text)
        if not isinstance(data, list):
            logger.warning("Language sample response is not a list: %s", type(data))
            return []
        samples = []
        for item in data:
            if isinstance(item, str) and item.strip():
                samples.append(item.strip())
        return samples
    except json.JSONDecodeError as e:
        logger.warning("Language sample generation: JSON parse failed: %s", e)
        return []


async def _generate_language_samples(
    prompt_data: PromptData,
    language_code: str,
    llm_client: BaseLLMClient,
) -> List[str]:
    """
    Generate 10 sample utterances in the target language (generic, not topic-specific).

    Uses age, gender, location for register/style. Output is suitable for
    promptData.languageDialogueSamples (used instead of longer language instruction).
    """
    if not llm_client:
        logger.warning("No LLM client provided for language sample generation.")
        return []

    language_name = get_language_name_from_code(language_code)
    # Build emotional_state from prompt_data (aligns with ally-be metadata).
    # `character_profile_text` is the free-text successor to the removed
    # structured tone / personality / starting_state / emotional_needs /
    # life_history_summary fields and is the canonical source of
    # emotional context for downstream LLM calls.
    emotional_parts = [
        prompt_data.context,
        prompt_data.character_profile_text,
    ]
    emotional_state = (
        " ".join(p for p in emotional_parts if p and str(p).strip()).strip()
        or "Not specified"
    )

    prompt = _LANGUAGE_SAMPLE_GENERATION_PROMPT.format(
        language_code=language_code,
        language_name=language_name,
        name=prompt_data.name or "Client",
        age=prompt_data.age or "",
        gender=prompt_data.gender or "",
        location=prompt_data.current_location or "",
        emotional_state=emotional_state,
    )

    logger.info("Language sample generation prompt length: %d chars", len(prompt))

    messages = [HumanMessage(content=prompt)]
    response = await llm_client.achat(messages)
    response_text = response.content.strip()

    samples = _parse_samples(response_text)
    logger.info("Generated %d language samples for %s", len(samples), language_code)
    return samples


def _save_language_samples(
    samples: List[str],
    language_code: str,
    scenario_name: str,
    output_dir: Path,
) -> Path:
    """Save samples to JSON file."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    safe_lang = language_code.replace("-", "_")
    filepath = output_dir / f"{safe_lang}.json"

    data = {
        "scenario_name": scenario_name,
        "language_code": language_code,
        "samples": samples,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return filepath


def _format_for_prompt_data(samples: List[str]) -> str:
    """
    Format samples as Python list literal for copy-paste into scenario_sample.py.

    Returns a string like:
        "languageDialogueSamples": ["utterance 1", "utterance 2", ...]
    """
    items = [json.dumps(s, ensure_ascii=False) for s in samples]
    inner = ",\n    ".join(items)
    return f'"languageDialogueSamples": [\n    {inner}\n]'


async def main():
    parser = argparse.ArgumentParser(
        description="Generate language dialogue samples (Malayalam or other languages)"
    )
    parser.add_argument(
        "-l",
        "--language",
        default="ml-IN",
        help="BCP-47 language code (default: ml-IN)",
    )
    parser.add_argument(
        "--output-dir",
        default="data/language_samples",
        type=Path,
        help="Directory to save JSON output",
    )
    parser.add_argument(
        "-s",
        "--scenario",
        default="SCENARIO_SAMPLE_MALAYALAM_AUTO",
        help=(
            "Name of scenario variable from scenario_sample.py "
            "(e.g. SCENARIO_SAMPLE, SCENARIO_SAMPLE_MALAYALAM_AUTO)"
        ),
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Override LLM model (e.g. gpt-4o, gpt-4o-mini). Uses default if not set.",
    )
    args = parser.parse_args()

    # Load scenario from scenario_sample module
    import scenario_sample as scenario_module

    if not hasattr(scenario_module, args.scenario):
        available = [x for x in dir(scenario_module) if x.startswith("SCENARIO_SAMPLE")]
        print(
            f"Error: Scenario '{args.scenario}' not found in scenario_sample.py.",
            file=sys.stderr,
        )
        print(f"Available: {', '.join(available)}", file=sys.stderr)
        sys.exit(1)

    payload = getattr(scenario_module, args.scenario)

    embedding_client = OpenAIEmbeddingClient()
    scenario = Scenario.create(
        payload,
        embedding_client=embedding_client,
    )
    prompt_data = scenario.prompt_data
    scenario_name = scenario.name

    if not prompt_data:
        print("Error: Could not load prompt data from scenario.", file=sys.stderr)
        sys.exit(1)

    print(f"Generating samples for {scenario_name} in {args.language}...")
    llm_config = {"model": args.model} if args.model else None
    llm_client = create_llm_client(
        llm_config=llm_config,
        language_code=args.language,
    )
    samples = await _generate_language_samples(
        prompt_data=prompt_data,
        language_code=args.language,
        llm_client=llm_client,
    )

    if not samples:
        print("Error: No samples generated.", file=sys.stderr)
        sys.exit(1)

    # Save to JSON
    filepath = _save_language_samples(
        samples=samples,
        language_code=args.language,
        scenario_name=scenario_name,
        output_dir=args.output_dir,
    )
    print(f"\nSaved to {filepath}\n")

    # Print for copy-paste
    print("=" * 60)
    print(f"Copy into {args.scenario} promptData.languageDialogueSamples:")
    print("=" * 60)
    print(_format_for_prompt_data(samples))
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
