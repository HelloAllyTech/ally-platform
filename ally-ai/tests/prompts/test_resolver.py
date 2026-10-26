import os

from app.prompts.resolver import _prompt_code_to_path


def test_prompt_code_to_path_simple():
    prompt_code = "ally_ai_category_promptname"
    expected = ("category", "promptname")
    assert _prompt_code_to_path(prompt_code) == expected


def test_prompt_code_to_path_nested():
    prompt_code = "ally_ai_category_subcategory_promptname"
    expected = ("category", "subcategory/promptname".replace("/", os.sep))
    assert _prompt_code_to_path(prompt_code) == expected


def test_prompt_code_to_path_deeply_nested():
    prompt_code = "ally_ai_a_b_c_d_e"
    expected = ("a", "b/c/d/e".replace("/", os.sep))
    assert _prompt_code_to_path(prompt_code) == expected


def test_prompt_code_to_path_no_prefix():
    prompt_code = "category_promptname"
    expected = ("category", "promptname")
    assert _prompt_code_to_path(prompt_code) == expected


def test_prompt_code_to_path_invalid():
    prompt_code = "ally_ai_invalid"
    expected = ("", "")
    assert _prompt_code_to_path(prompt_code) == expected


def test_prompt_code_to_path_empty():
    prompt_code = ""
    expected = ("", "")
    assert _prompt_code_to_path(prompt_code) == expected


def test_local_template_by_code_finds_flat_files_with_underscores(
    tmp_path, monkeypatch
):
    from app.prompts import resolver

    (tmp_path / "summary").mkdir()
    (tmp_path / "summary" / "dictation_summary.txt").write_text("flat")
    monkeypatch.setattr(resolver.prompt_manager, "base_dir", tmp_path)
    resolver.prompt_manager.clear_cache()

    assert resolver._get_local_template("ally_ai_summary_dictation_summary") == "flat"


def test_local_template_by_code_still_finds_nested_files(tmp_path, monkeypatch):
    from app.prompts import resolver

    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "c.txt").write_text("nested")
    monkeypatch.setattr(resolver.prompt_manager, "base_dir", tmp_path)
    resolver.prompt_manager.clear_cache()

    assert resolver._get_local_template("ally_ai_a_b_c") == "nested"


def test_every_shipped_prompt_resolves_by_code():
    from pathlib import Path

    from app.prompts import resolver

    resolver.prompt_manager.clear_cache()
    base = Path(resolver.prompt_manager.base_dir)
    files = sorted(base.glob("*/*.txt"))
    assert files
    for f in files:
        code = f"ally_ai_{f.parent.name}_{f.stem}"
        assert resolver._get_local_template(code), code
