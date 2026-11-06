"""File-system tools: listings hide deny paths, reads are ranged and numbered,
edit_file needs exactly one match, write_test_file never overwrites and only
writes to test locations."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.safety.paths import PathDenied
from bug_hunter.tools.fs import MAX_READ_LINES, FsError, Workspace


@pytest.fixture
def worktree(tmp_path: Path) -> Path:
    root = tmp_path / "wt"
    files = {
        "ally-be/src/user/user.service.ts": (
            "export class UserService {\n  find(id: string) {\n    return id;\n  }\n}\n"
        ),
        "ally-be/src/user/test/user.service.spec.ts": (
            "describe('UserService', () => {});\n"
        ),
        "ally-be/src/progress/big.ts": "\n".join(f"line {n}" for n in range(1, 1001))
        + "\n",
        "ally-be/.env": "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\n",
        "ally-be/package-lock.json": "{}\n",
        "ally-ai/app/main.py": "print('hi')  # contact ops@example.com\n",
    }
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    (root / "ally-be/node_modules/pkg").mkdir(parents=True)
    (root / "ally-be/node_modules/pkg/index.js").write_text("module.exports = 1;\n")
    return root


@pytest.fixture
def ws(worktree: Path, config: BugHunterConfig) -> Workspace:
    return Workspace(worktree, config, "ally-be")


def test_list_dir_hides_env_and_node_modules(ws: Workspace) -> None:
    out = ws.list_dir(".", depth=2)
    assert "src/user/" in out and "package-lock.json" in out
    assert ".env" not in out
    assert "node_modules" not in out


def test_glob(ws: Workspace) -> None:
    assert ws.glob("src/**/*.spec.ts") == "src/user/test/user.service.spec.ts"
    assert ws.glob("**/*.nothing") == "(no matches)"


@pytest.mark.parametrize("use_rg", [False, True])
def test_grep_with_and_without_ripgrep(
    ws: Workspace, monkeypatch: pytest.MonkeyPatch, use_rg: bool
) -> None:
    if use_rg and not shutil.which("rg"):
        pytest.skip("ripgrep not installed")
    if not use_rg:
        monkeypatch.setattr("bug_hunter.tools.fs.shutil.which", lambda _: None)
    out = ws.grep(r"find\(id", "src")
    assert out.startswith("src/user/user.service.ts:2:")
    assert ws.grep("sk-abcdefghijklmnopqrstuvwxyz") == "(no matches)"  # .env is skipped
    assert "node_modules" not in ws.grep("module.exports")


def test_grep_rejects_bad_regex(ws: Workspace) -> None:
    with pytest.raises(FsError, match="invalid regex"):
        ws.grep("(unclosed")


def test_read_file_has_line_numbers_and_ranges(ws: Workspace) -> None:
    out = ws.read_file("src/user/user.service.ts", 2, 3)
    assert out.splitlines()[0] == "src/user/user.service.ts lines 2-3 of 5"
    assert "2| " in out and "find(id: string)" in out
    assert "export class" not in out


def test_read_file_caps_at_400_lines(ws: Workspace) -> None:
    out = ws.read_file("src/progress/big.ts")
    assert f"lines 1-{MAX_READ_LINES} of 1000" in out
    assert "line 401" not in out
    assert ws.read_file("src/progress/big.ts", 900).count("\n") == 101


def test_read_other_app_is_allowed_and_scrubbed(ws: Workspace) -> None:
    out = ws.read_file("ally-ai/app/main.py")
    assert "print('hi')" in out
    assert "ops@example.com" not in out


def test_read_denied_paths(ws: Workspace) -> None:
    with pytest.raises(PathDenied):
        ws.read_file(".env")
    with pytest.raises(PathDenied):
        ws.read_file("../../outside")


def test_edit_file_exact_single_match(ws: Workspace, worktree: Path) -> None:
    assert ws.edit_file("src/user/user.service.ts", "return id;", "return id.trim();")
    assert (
        "return id.trim();"
        in (worktree / "ally-be/src/user/user.service.ts").read_text()
    )
    with pytest.raises(FsError, match="not found"):
        ws.edit_file("src/user/user.service.ts", "nope", "x")
    with pytest.raises(FsError, match="matches 2 times"):
        ws.edit_file("src/user/user.service.ts", "id", "x")
    with pytest.raises(FsError, match="must not be empty"):
        ws.edit_file("src/user/user.service.ts", "", "x")


def test_edit_file_refuses_other_app_and_lockfile(ws: Workspace) -> None:
    with pytest.raises(PathDenied):
        ws.edit_file("ally-ai/app/main.py", "hi", "bye")
    with pytest.raises(PathDenied, match="read-only"):
        ws.edit_file("package-lock.json", "{}", "{ }")


def test_write_test_file_rules(ws: Workspace, worktree: Path) -> None:
    out = ws.write_test_file(
        "src/user/test/user.repro.spec.ts", "it('fails', () => {});\n"
    )
    assert out.startswith("wrote src/user/test/user.repro.spec.ts")
    assert (worktree / "ally-be/src/user/test/user.repro.spec.ts").exists()
    with pytest.raises(FsError, match="never overwrites"):
        ws.write_test_file("src/user/test/user.repro.spec.ts", "x")
    with pytest.raises(FsError, match="not a test location"):
        ws.write_test_file("src/user/helper.ts", "x")
    with pytest.raises(PathDenied):
        ws.write_test_file("../ally-ai/tests/test_new.py", "x")
    with pytest.raises(PathDenied):
        ws.write_test_file(".env.test", "x")
