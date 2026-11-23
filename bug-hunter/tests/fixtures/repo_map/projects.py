"""Tiny per-language projects for repo-map tests, laid out like the real apps so
``build_map`` (which lists files with git) can index them from a temp repo."""

from __future__ import annotations

import subprocess
from pathlib import Path

TS_PROJECT = {
    "src/user/user.service.ts": (
        "import { Injectable } from '@nestjs/common';\n"
        "@Injectable()\n"
        "export class UserService {\n"
        "  findOne(id: string) { return lookup(id); }\n"
        "  findByEmail(email: string) { return this.findOne(email); }\n"
        "}\n"
        "function lookup(id: string) { return id; }\n"
    ),
    "src/auth/auth.service.ts": (
        "import { Injectable } from '@nestjs/common';\n"
        "import { UserService } from '../user/user.service';\n"
        "import { helper, MAX } from '../util';\n"
        "@Injectable()\n"
        "export class AuthService {\n"
        "  constructor(private readonly userService: UserService, "
        "private readonly jwt: JwtService) {}\n"
        "  @Post('login')\n"
        "  async login(dto: Dto) {\n"
        "    const user = await this.userService.findByEmail(dto.email);\n"
        "    this.validate(user);\n"
        "    return helper(user, MAX);\n"
        "  }\n"
        "  private validate(user: unknown) { return this.jwt.sign(user); }\n"
        "}\n"
    ),
    "src/util.ts": (
        "export function helper(x: unknown, max: number) { return [x, max]; }\n"
        "export const MAX = 3;\n"
        "const internal = () => 1;\n"
    ),
    "src/auth/test/auth.service.spec.ts": (
        "import { AuthService } from '../auth.service';\n"
        "describe('AuthService', () => { it('logs in', () => { "
        "new AuthService(); }); });\n"
    ),
    "src/user/user.service.spec.ts": (
        "import { UserService } from './user.service';\n"
        "describe('UserService', () => { it('finds', () => { "
        "new UserService().findOne('x'); }); });\n"
    ),
}

TSX_PROJECT = {
    "apps/app/src/utils/fmt.ts": "export const fmt = (x: number) => String(x);\n",
    "apps/app/src/components/Card.tsx": (
        "import { fmt } from '../utils/fmt';\n"
        "export const Card = ({ n }: { n: number }) => <div>{fmt(n)}</div>;\n"
    ),
    "apps/app/src/utils/__tests__/fmt.test.ts": (
        "import { fmt } from '../fmt';\n"
        "describe('fmt', () => { it('works', () => { fmt(1); }); });\n"
    ),
}

PY_PROJECT = {
    "app/core/util.py": "def util_fn(x):\n    return x\n\nMAX_ITEMS = 3\n",
    "app/core/service.py": (
        "from app.core.util import util_fn\n\n\n"
        "class Service:\n"
        "    def run(self, x):\n"
        "        return self.helper(x) + util_fn(x)\n\n"
        "    def helper(self, x):\n"
        "        return x\n\n\n"
        "@router.post('/run')\n"
        "def run_endpoint(x):\n"
        "    return Service().run(x)\n"
    ),
    "tests/core/test_service.py": (
        "from app.core.service import Service\n\n\n"
        "def test_run():\n    assert Service().run(1) == 2\n"
    ),
}

DART_PROJECT = {
    "lib/core/api.dart": (
        "class Api {\n  Future<int> fetch(int id) async { return id; }\n}\n"
    ),
    "lib/features/home.dart": (
        "import 'package:ally_mobile_flutter/core/api.dart';\n\n"
        "class Home {\n"
        "  final Api api;\n"
        "  Home(this.api);\n"
        "  Future<void> load() async { await api.fetch(1); helper(); }\n"
        "}\n\n"
        "void helper() { print('x'); }\n"
        "const int kMax = 3;\n"
    ),
    "test/features/home_test.dart": (
        "import 'package:ally_mobile_flutter/features/home.dart';\n"
        "void main() { test('loads', () { helper(); }); }\n"
    ),
}

PROJECTS = {
    "ally-be": TS_PROJECT,
    "ally-web": TSX_PROJECT,
    "ally-ai": PY_PROJECT,
    "ally-mobile": DART_PROJECT,
}


def make_repo(root: Path, projects: dict[str, dict[str, str]] | None = None) -> Path:
    """A git repo at ``root`` with one commit holding the given app projects."""
    projects = projects or PROJECTS
    root.mkdir(parents=True, exist_ok=True)
    for app, files in projects.items():
        for rel, content in files.items():
            path = root / app / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q", "-b", "master"], cwd=root, check=True)
    subprocess.run([*git, "add", "."], cwd=root, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "feat: fixture"], cwd=root, check=True)
    return root
