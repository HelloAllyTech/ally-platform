"""Scrubber: every fixture's leaks are gone and its useful text survives; key
matching is style-insensitive; error/message keep their content."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from bug_hunter.safety.phi import (
    PATTERN_ONLY_FIELDS,
    SECRET_FIELDS,
    USER_FIELDS,
    classify_key,
    normalise_key,
    scrub,
    scrub_code,
)

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "phi_fixtures.json").read_text()
)


@pytest.mark.parametrize("case", FIXTURES, ids=[c["name"] for c in FIXTURES])
def test_fixture_leaks_are_removed_and_context_kept(case: dict) -> None:
    out = scrub(case["text"])
    for leak in case["leaks"]:
        assert leak not in out, f"leaked {leak!r} in:\n{out}"
    for keep in case["keeps"]:
        assert keep in out, f"lost {keep!r} in:\n{out}"


@pytest.mark.parametrize(
    "key",
    ["first_name", "firstName", "FirstName", "FIRST_NAME", "first-name", "First Name"],
)
def test_key_matching_is_case_and_style_insensitive(key: str) -> None:
    assert classify_key(key) == "user"
    assert normalise_key(key) == "firstname"


@pytest.mark.parametrize("key", ["error", "message", "Message", "ERROR", "stack"])
def test_error_and_message_are_pattern_only(key: str) -> None:
    assert classify_key(key) is None
    text = f'{{"{key}": "TypeError at user.service.ts:12 for a@b.com"}}'
    out = scrub(text)
    assert "TypeError at user.service.ts:12" in out
    assert "a@b.com" not in out


def test_secret_fields_are_redacted_without_naming_the_key_value() -> None:
    out = scrub("password=hunter2 api_key: abc token=xyz")
    assert "hunter2" not in out and "xyz" not in out and "abc" not in out
    assert out.count("[secret]") == 3


def test_safe_ips_and_dates_survive() -> None:
    text = (
        "0.0.0.0:8000 127.0.0.1 2026-11-06 22:30:15 epoch 1762448400 ts 1699999999999"
    )
    assert scrub(text) == text


def test_public_ip_and_phones_are_redacted() -> None:
    out = scrub("from 203.0.113.9 call +1 415-555-0100 or 9876543210 or 098765 43210")
    assert "203.0.113.9" not in out
    assert "415-555-0100" not in out
    assert "9876543210" not in out
    assert out.count("[phone]") >= 2


def test_scrub_code_keeps_name_values_but_strips_secrets() -> None:
    code = (
        'const name = "ValidationPipe";\n'
        'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";\n'
        'const email = "ops@example.com";'
    )
    out = scrub_code(code)
    assert 'const name = "ValidationPipe"' in out
    assert "sk-abcdefghijklmnopqrstuvwxyz123456" not in out
    assert "ops@example.com" not in out


def test_field_lists_have_no_duplicates_after_normalisation() -> None:
    for fields in (USER_FIELDS, SECRET_FIELDS, PATTERN_ONLY_FIELDS):
        norm = [normalise_key(f) for f in fields]
        assert len(norm) == len(set(norm))
    assert not set(map(normalise_key, USER_FIELDS)) & set(
        map(normalise_key, PATTERN_ONLY_FIELDS)
    )


def test_empty_input() -> None:
    assert scrub("") == ""
    assert scrub_code("") == ""
