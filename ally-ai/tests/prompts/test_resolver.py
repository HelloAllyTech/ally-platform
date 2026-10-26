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
