"""PHI and secret scrubber. Runs on every string that enters a prompt or memory.

Two layers:

* **Patterns** (``scrub_patterns``): emails, phone numbers (Indian and international
  forms), JWTs and bearer tokens, API-key shapes (OpenAI, AWS, Google, GitHub,
  Deepgram ``Token`` headers), IP addresses and secret-bearing URL query params.
  The email and phone regexes are ported from ally-be's ``redactPii`` and the guide's
  ``redactText``; the rest have no source in the repo and are new here.
* **Fields** (``scrub_fields``): for data-shaped text (logs, issue bodies, test
  output, stack traces) the *value* of any user field or secret field is redacted,
  in JSON, ``key=value`` and ``key: value`` forms. Key matching is case- and
  style-insensitive (``first_name`` = ``firstName`` = ``FirstName``). ``error`` and
  ``message`` get only the pattern layer: they hold the log line and stack trace the
  agent needs.

``scrub`` applies both layers (use it for data); ``scrub_code`` applies only the
patterns (use it for source files, where redacting every ``name:`` would blind the
agent).
"""

from __future__ import annotations

import re
from typing import Callable, Iterable

# --- field lists -----------------------------------------------------------------

# Keys whose values are PHI. Normalised form (lowercase, separators removed) is what
# gets compared, so write them however reads best. Sources: ally-be entity columns,
# ally-ai / ally-ai-learn Pydantic schemas, the ally-ai PHI audit DTO, plus date of
# birth, address, session/case notes and WhatsApp numbers added by request.
USER_FIELDS: tuple[str, ...] = (
    # identity
    "name",
    "first_name",
    "last_name",
    "full_name",
    "display_name",
    "username",
    "verified_name",
    "author_name",
    "counselor_name",
    "learner_name",
    "speaker",
    "age",
    "gender",
    "gender_identity",
    "date_of_birth",
    "dob",
    # contact
    "email",
    "source_email",
    "source_email_lower",
    "phone",
    "phone_number",
    "mobile",
    "whatsapp",
    "whatsapp_number",
    "wa_id",
    "wa_contact_id",
    "display_phone_number",
    "contact_id",
    "supervisor_contact",
    "address",
    "city",
    "location",
    "current_location",
    # request metadata (ally-ai PHI audit DTO)
    "ip",
    "ip_address",
    "ip_hash",
    "user_agent",
    "request_id",
    # user-tied identifiers
    "user_id",
    "chat_id",
    "audit_id",
    "client_id",
    "caller_id",
    "counselor_id",
    "learner_id",
    # conversation and clinical content
    "transcript",
    "transcription",
    "interview_transcript",
    "message_content",
    "chat_message",
    "counselor_message",
    "agent_message",
    "user_content",
    "summary",
    "summary_md",
    "session_summary",
    "rolling_summary",
    "previous_summary",
    "note",
    "notes",
    "session_notes",
    "case_notes",
    "progress_note",
    "supervisor_note",
    "guide_notes",
    "team_notes",
    "review_note",
    "decision_note",
    "outcome_note",
    "resolution_note",
    # ally-ai PHI audit `details` keys: S3 paths and URLs that embed chat ids
    "audio_url",
    "file_path",
    "segment_path",
    "wav_file_path",
    "input_path",
)

SECRET_FIELDS: tuple[str, ...] = (
    "password",
    "password_hash",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "authorization",
    "aws_secret_access_key",
    "aws_access_key_id",
    "private_key",
    "client_secret",
    "jwt_secret",
    "cookie",
    "set_cookie",
)

# Keys that get the pattern layer only (never whole-value redaction).
PATTERN_ONLY_FIELDS: tuple[str, ...] = ("error", "message", "msg", "stack", "trace")


def normalise_key(key: str) -> str:
    return re.sub(r"[\s_\-.]", "", key).lower()


_USER_KEYS = frozenset(normalise_key(k) for k in USER_FIELDS)
_SECRET_KEYS = frozenset(normalise_key(k) for k in SECRET_FIELDS)
_PATTERN_ONLY_KEYS = frozenset(normalise_key(k) for k in PATTERN_ONLY_FIELDS)


def classify_key(key: str) -> str | None:
    """``"user"``, ``"secret"`` or None for a raw key in any casing or style."""
    norm = normalise_key(key)
    if norm in _PATTERN_ONLY_KEYS:
        return None
    if norm in _SECRET_KEYS:
        return "secret"
    if norm in _USER_KEYS:
        return "user"
    return None


# --- patterns ----------------------------------------------------------------------

_SAFE_IPS = {"127.0.0.1", "0.0.0.0"}


def _ip_replacement(match: re.Match[str]) -> str:
    return match.group(0) if match.group(0) in _SAFE_IPS else "[ip]"


def _phone_replacement(match: re.Match[str]) -> str:
    text = match.group(0)
    digits = re.sub(r"\D", "", text)
    # Dates, timestamps and epoch values are not phone numbers.
    if re.match(r"\d{4}-\d{2}-\d{2}", text) or len(digits) > 15:
        return text
    return "[phone]"


Pattern = tuple[re.Pattern[str], str | Callable[[re.Match[str]], str]]

PATTERNS: tuple[Pattern, ...] = (
    # tokens and keys first, so their digits are not later mistaken for phones
    (
        re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"),
        "[jwt]",
    ),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"), "Bearer [token]"),
    (re.compile(r"(?i)\btoken\s+[0-9a-f]{40}\b"), "Token [deepgram-key]"),
    (re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}"), "[openai-key]"),
    (re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "[aws-key]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35,}\b"), "[google-key]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "[github-token]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"), "[github-token]"),
    (
        re.compile(
            r"([?&](?:token|key|api_key|apikey|access_token|signature|sig|secret)=)"
            r"[^&\s\"']+",
            re.IGNORECASE,
        ),
        r"\1[secret]",
    ),
    # ally-be redactPii / guide redactText
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    # phones: international with +, Indian 10-digit mobiles (optionally 0/+91), US-style
    (re.compile(r"\+\d[\d\s().-]{7,}\d"), _phone_replacement),
    (re.compile(r"(?<![\d.])(?:\+?91[\s-]?|0)?[6-9]\d{9}(?![\d.])"), "[phone]"),
    (re.compile(r"(?<!\d)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)"), _phone_replacement),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), _ip_replacement),
)


def scrub_patterns(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# --- fields ------------------------------------------------------------------------

_KEY = r"[A-Za-z][A-Za-z0-9_\-.]*"
# "key": "value"  |  'key': 'value'  |  "key": value   (JSON and Python dict reprs).
# An unquoted value may not open a nested object or list, so the pair for a parent
# key never swallows its children.
_JSON_PAIR = re.compile(
    rf"(?P<q>[\"'])(?P<key>{_KEY})(?P=q)\s*:\s*"
    rf"(?P<value>\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|[^,}}\]\n{{\[]+)"
)
# key=value  |  key: value  (an unquoted value runs to the end of the line, a comma,
# a closing bracket, or the next `key=` / `key:` pair on the same line)
_UNQUOTED = r"(?:(?!\s+[A-Za-z][\w.\-]*\s*[=:])[^,;}\]\n])+"
_KV_PAIR = re.compile(
    rf"(?P<key>\b{_KEY})(?P<sep>\s*[=:]\s*)"
    rf"(?P<value>\"(?:[^\"\\]|\\.)*\"|'[^'\n]*'|{_UNQUOTED})"
)


def _redact_value(kind: str, key: str, quote: str) -> str:
    label = "[secret]" if kind == "secret" else f"[redacted:{normalise_key(key)}]"
    return f"{quote}{label}{quote}" if quote else label


def _value_quote(value: str) -> str:
    return value[0] if value[:1] in ('"', "'") else ""


def _json_replacement(match: re.Match[str]) -> str:
    quote, key, value = match.group("q"), match.group("key"), match.group("value")
    kind = classify_key(key)
    if kind is None:
        return match.group(0)
    return f"{quote}{key}{quote}: {_redact_value(kind, key, _value_quote(value))}"


def _kv_replacement(match: re.Match[str]) -> str:
    key, sep, value = match.group("key"), match.group("sep"), match.group("value")
    kind = classify_key(key)
    if kind is None:
        return match.group(0)
    return f"{key}{sep}{_redact_value(kind, key, _value_quote(value))}"


def scrub_fields(text: str) -> str:
    text = _JSON_PAIR.sub(_json_replacement, text)
    text = _KV_PAIR.sub(_kv_replacement, text)
    return text


# --- entry points ------------------------------------------------------------------


def scrub(text: str) -> str:
    """Full scrub for data-shaped text: logs, issue bodies, test output, traces."""
    if not text:
        return text
    return scrub_patterns(scrub_fields(text))


def scrub_code(text: str) -> str:
    """Pattern-only scrub for source code and file listings."""
    if not text:
        return text
    return scrub_patterns(text)


def scrub_all(items: Iterable[str]) -> list[str]:
    return [scrub(item) for item in items]
