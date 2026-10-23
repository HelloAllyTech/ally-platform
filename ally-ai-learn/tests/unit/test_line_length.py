"""Guard flake8's E501 (line too long) without waiting for CI to say so.

The lint job is repo-wide and blocking, so a single over-long line anywhere in
`app/` or `tests/` turns the whole gate red. This reads the limit and the
exemptions out of `.flake8` rather than restating them, so the test cannot
drift from the linter's own configuration.
"""

import configparser
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKED_TREES = ("app", "tests")

# `# noqa` on its own silences everything on that line; `# noqa: X,Y` only
# silences the codes it names.
NOQA = re.compile(r"#\s*noqa(?P<codes>\s*:\s*[A-Z]+[0-9]+(?:[,\s]+[A-Z]+[0-9]+)*)?")


def _flake8_config():
    parser = configparser.ConfigParser()
    parser.read(REPO_ROOT / ".flake8")
    return parser["flake8"]


def _max_line_length():
    return int(_flake8_config()["max-line-length"])


def _excluded_dir_names():
    raw = _flake8_config().get("exclude", "")
    return {part.strip() for part in raw.replace("\n", ",").split(",") if part.strip()}


def _paths_exempt_from_e501():
    """Files `.flake8`'s per-file-ignores lets off E501."""
    raw = _flake8_config().get("per-file-ignores", "")
    exempt = set()
    for entry in raw.replace("\n", " ").split():
        pattern, _, codes = entry.partition(":")
        if "E501" in codes:
            exempt.add(pattern)
    return exempt


def _is_exempt(path: Path, exempt_patterns):
    rel = path.relative_to(REPO_ROOT).as_posix()
    return any(
        rel == pattern or rel.endswith("/" + pattern) for pattern in exempt_patterns
    )


def _e501_suppressed(line: str) -> bool:
    match = NOQA.search(line)
    if match is None:
        return False
    codes = match.group("codes")
    return codes is None or "E501" in codes


def _over_long_lines():
    limit = _max_line_length()
    excluded = _excluded_dir_names()
    exempt_patterns = _paths_exempt_from_e501()

    offenders = []
    for tree in CHECKED_TREES:
        for path in sorted((REPO_ROOT / tree).rglob("*.py")):
            if any(part in excluded for part in path.relative_to(REPO_ROOT).parts):
                continue
            if _is_exempt(path, exempt_patterns):
                continue
            text = path.read_text(encoding="utf-8")
            for number, line in enumerate(text.splitlines(), start=1):
                if len(line) > limit and not _e501_suppressed(line):
                    rel = path.relative_to(REPO_ROOT).as_posix()
                    offenders.append(
                        f"{rel}:{number}: {len(line)} > {limit} characters"
                    )
    return offenders


def test_no_source_line_exceeds_the_configured_max_length():
    offenders = _over_long_lines()
    assert not offenders, "flake8 E501 (line too long):\n" + "\n".join(offenders)
