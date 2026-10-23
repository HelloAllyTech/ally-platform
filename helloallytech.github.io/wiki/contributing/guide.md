---
title: Contributing Guide
tags: [contributing, sdlc, workflow, standards]
summary: Branch naming, commit conventions, code standards, and the pull-request process shared across all Ally repositories.
last_reconciled: 2026-07-28
---

# Contributing Guide

Thank you for contributing to Ally! This guide covers the shared SDLC rules — branch naming, commits, code standards, and the PR process. For per-repo setup, see [Developer Setup](dev-setup.md) and each [repo page](../index.md#repositories).

## Branch Naming

```
<type>/<short-description>
```

**Branch types:** `feat` (new feature), `fix` (bug fix), `chore` (maintenance/deps), `refactor`, `docs`, `test`, `style` (formatting), `perf`, `build`, `ci`, `revert`, `hotfix`.

Examples: `feat/add-user-authentication`, `fix/login-error-handling`, `docs/update-setup-guide`.

**Rules:** hyphens (not underscores) between words, lowercase, short and descriptive. Do **not** embed a ticket id in the branch name — reference the ticket in the PR description instead. This is the single canonical statement of the convention for every repo; `commitlint`/Husky enforce the matching commit format in the TypeScript repos.

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>: short summary
```

- Use imperative mood ("add", not "added"/"adds").
- Lowercase first letter after the type; no trailing period.
- Keep the summary ≤ 50 characters and specific.

Examples: `feat: add user profile page`, `fix: handle null pointer in login flow`, `docs: update contributing guidelines`.

Commitlint / Husky hooks enforce this in the TypeScript repos.

## Development Workflow

0. **Get Stacks context — before you plan, and again whenever a product judgement comes up.** Search the library and incorporate relevant returned guidance, citing chunk titles — see [Working with the Stacks MCP](planning-with-stacks.md). An agent calls `search_chunks` on its own initiative, so you do not have to fetch context for it; `/stacks:planning_context` is there for when *you* want the context in front of you. Planning is the most important moment, not the only one: reach for it mid-implementation too, whenever you would otherwise invent an empty or failure state, a user-facing label, a threshold or a cadence. This is where product guidance now comes from; the in-wiki [Product Management Best Practices](../product/best-practices.md) section was deprecated on 2026-08-07. Trivial mechanical changes (rename, dependency bump, typo) skip this.
1. **Create a feature branch** following the naming convention.
2. **Make your changes** following the code standards for that repo.
3. **Test thoroughly** — run tests (`npm test` / `poetry run pytest`) and linters (`npm run lint` / `poetry run flake8 app/`).
4. **Commit** using Conventional Commits.
5. **Push** your branch and **open a Pull Request** on GitHub.
6. **Reference the issue** in your PR description (e.g. "Closes #123").

### Working on Issues
- Browse issues in the relevant repository; look for `good first issue` or `help wanted` labels.
- Comment to express interest and wait for maintainer approval before starting.
- Reference the issue in your PR.

## Code Standards

**General principles:** write clean, self-documenting code; comment only where logic isn't self-evident; follow existing style; write tests for new functionality; update docs when adding features. All repos run pre-commit hooks (formatting, linting, import ordering, trailing whitespace, secret scanning via gitleaks).

### JavaScript / TypeScript (ally-be, ally-web, ally-mobile)
- **Import order:** built-in Node modules → external deps (React first) → internal modules (`@` alias) → parent/sibling (relative) → type imports. Separate groups with newlines, alphabetize within groups.
- Prettier + ESLint enforced; Husky + lint-staged on staged files.
- Conventions (ally-web): semicolons required, double quotes, 2-space tabs, 100-char print width.

### Python (ally-ai, ally-ai-learn)
- **Import order (isort):** standard library → third-party → local application.
- **Style:** Black (88-char line length), type hints for all functions, Google-style docstrings.
- flake8 + pre-commit hooks enforced; all tests must pass.

## Pull Request Process

### PR Title
Same format as commit messages: `<type>: short summary`.

### PR Description
Include: a **Summary**, a **Changes** list, **Testing** notes (unit/integration/manual), **Related Issues** (`Closes #123`), and screenshots for UI changes. Use a checklist (style, self-review, comments, docs updated, no new warnings, tests pass).

For user-facing PRs, name the Stacks guidance the plan applied (by chunk title) so a reviewer can trace the product decisions — see [Planning with the Stacks MCP](planning-with-stacks.md).

### Review
1. Submit the PR with a clear title and description.
2. Automated checks run (tests, linting).
3. Address reviewer feedback with new commits.
4. Get at least one approval; maintainers handle the merge.

### Best Practices
- Keep PRs focused on a single feature/fix and reasonably sized (< 500 lines when possible).
- Write clear commit messages; update tests and docs; respond to feedback promptly.

## Code of Conduct

We are committed to a welcoming, inclusive environment. Be respectful, inclusive, collaborative, professional, and patient. Harassment, discrimination, trolling, personal attacks, and publishing others' private information are not tolerated.

## License

All Ally projects are licensed under the **MIT License**. By contributing, you agree your contributions are licensed under the same terms.

---

*See also: [Developer Setup](dev-setup.md), [Cross-Repo Agent Guide](../platform/agent-guide.md).*
