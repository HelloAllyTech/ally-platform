"""Golden-case schema (``evals/golden/cases.yaml``) and candidate records."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

Kind = Literal["bug", "clean"]
Expected = Literal["fix", "escalate", "no_bug"]


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=3)
    kind: Kind
    app: str
    parent: str = Field(
        min_length=7,
        description="commit under test (bug present / clean diff's parent)",
    )
    commit: str = Field(
        min_length=7, description="the fix commit (bug) or the clean commit"
    )
    expected: Expected
    layout: Literal["monorepo", "root"] = "monorepo"
    risk: bool = False
    description: str = Field(min_length=10)
    src_files: list[str] = Field(default_factory=list, description="app-relative")
    oracle_tests: list[str] = Field(
        default_factory=list, description="app-relative; bug cases only"
    )
    src_lines: int = 0
    lockfile_blob: str | None = None
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _consistent(self) -> "Case":
        if self.kind == "bug":
            if not self.oracle_tests:
                raise ValueError(f"{self.id}: a bug case needs oracle_tests")
            if self.expected == "no_bug":
                raise ValueError(f"{self.id}: a bug case cannot expect no_bug")
            if self.risk and self.expected != "escalate":
                raise ValueError(f"{self.id}: a risk-path bug must expect escalate")
        else:
            if self.expected != "no_bug":
                raise ValueError(f"{self.id}: a clean case must expect no_bug")
        return self


class CaseFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cases: list[Case] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> "CaseFile":
        ids = [c.id for c in self.cases]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate case ids: {', '.join(dupes)}")
        return self

    def select(self, filter_text: str | None) -> list[Case]:
        """``CASES=ally-be`` or ``CASES=bug`` or ``CASES=<id>``; comma-separated."""
        if not filter_text:
            return list(self.cases)
        wanted = {w.strip() for w in filter_text.split(",") if w.strip()}
        return [
            c
            for c in self.cases
            if c.app in wanted or c.kind in wanted or c.id in wanted
        ]

    def by_app(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for c in self.cases:
            out.setdefault(c.app, {"bug": 0, "clean": 0})[c.kind] += 1
        return out


def load_cases(path: Path) -> CaseFile:
    if not path.exists():
        return CaseFile()
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return CaseFile.model_validate(data)


def save_cases(path: Path, cases: CaseFile) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"cases": [c.model_dump(exclude_none=True) for c in cases.cases]}
    header = (
        "# Golden cases for the bug-hunter evals. Curated by hand from candidates in\n"
        "# evals/golden/candidates/ (bug-hunter eval mine, then eval accept <ids>).\n"
        "# Bug cases: `parent` has the bug, `commit` is the real fix, `oracle_tests`\n"
        "# are its tests (hidden from the agent). Clean cases: `commit` is a\n"
        "# feat/chore\n"
        "# no fix touched\n"
        "# within 30 days; the agent should report no bug.\n"
    )
    path.write_text(
        header
        + yaml.safe_dump(payload, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )
