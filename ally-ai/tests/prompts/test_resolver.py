from pathlib import Path

from app.prompts import resolver


def test_every_shipped_prompt_resolves_by_path():
    base = Path(resolver.prompt_manager.base_dir)
    files = sorted(base.glob("*/*.txt"))
    assert files
    for f in files:
        internal_path = f"{f.parent.name}/{f.stem}"
        assert resolver._get_local_template(internal_path), internal_path


def test_a_path_without_a_category_resolves_to_nothing():
    assert resolver._get_local_template("nudge") == ""
