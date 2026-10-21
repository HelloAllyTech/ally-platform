---
title: Release Process
tags: [contributing, release, versioning, ci, deployment]
summary: The shared production-release process for every Ally service — semantic versioning policy, the automated pipeline, release-draft review, and troubleshooting.
last_reconciled: 2026-09-17
---

# Release Process

Every Ally service releases the same way: you pick a version, trigger one workflow, and
review the draft it produces. This page is the **shared** half of that process.

Each repo keeps a short `.github/RELEASE_GUIDE.md` for the half that genuinely differs — <!-- docs-path-lint: ignore -->
its workflow name, runtime, and deployment target names. Those stay in the private repos;
this site is public, so it carries no infrastructure identifiers.

| Repo | Its guide |
|---|---|
| ally-be | [`ally-be/.github/RELEASE_GUIDE.md`](https://github.com/HelloAllyTech/ally-be/blob/main/.github/RELEASE_GUIDE.md) |
| ally-ai | [`ally-ai/.github/RELEASE_GUIDE.md`](https://github.com/HelloAllyTech/ally-ai/blob/main/.github/RELEASE_GUIDE.md) |
| ally-ai-learn | [`ally-ai-learn/.github/RELEASE_GUIDE.md`](https://github.com/HelloAllyTech/ally-ai-learn/blob/main/.github/RELEASE_GUIDE.md) |
| ally-web | [`ally-web/.github/RELEASE_GUIDE.md`](https://github.com/HelloAllyTech/ally-web/blob/main/.github/RELEASE_GUIDE.md) — three independently versioned services |

---

## 1. Before you release

- All changes merged to the release branch.
- CI green.
- Code review complete.

**"CI green" became enforceable on 2026-09-17.** Until then `master` on `ally-be` and
`ally-web` required exactly one status check, so every other check was advisory and
anyone could merge past a red one. Two pull requests did, three hours apart, and left a
type error on `master` that the test job does not catch — `ts-jest` does not type-check
the whole programme the way the production build does. Nothing could be released in
between: the build job failed, and migration, deploy and the release draft were all
skipped.

Both repos now require every check that gates correctness — tests, lint-and-typecheck,
secret scanning, and on `ally-be` the runner-harness and workflow-lint jobs — with
`enforce_admins` on, so no role can merge past a red one.

**`docs-guard` is deliberately NOT in that set.** It runs and it shows red, but it does
not block. It enforces a documentation policy rather than correctness, its escape is a
label rather than a fix, and measuring the last twenty merges showed it was the one
required check that would have stopped work someone had every reason to ship. Keeping it
advisory retains the nag without the standoff.

The practical consequences:

- A branch must be current with `master` before it merges, for everyone. Expect more
  update-branch cycles, and note that an update dismisses existing approvals.
- **There is no emergency override any more.** If `master` breaks such that the required
  checks cannot pass, the route out is to lift enforcement, fix, and restore it:
  `gh api -X DELETE repos/<org>/<repo>/branches/master/protection/enforce_admins`, then
  `-X POST` the same path afterwards. Worth knowing the command exists before you need
  it rather than during an incident.

## 2. Pick a version

We follow [Semantic Versioning 2.0.0](https://semver.org/): `vMAJOR.MINOR.PATCH`.

| Bump | When | Example |
|---|---|---|
| **MAJOR** | Breaking API change, removed endpoint, major architecture change | `v1.5.3` → `v2.0.0` |
| **MINOR** | New feature or endpoint, backward compatible | `v1.5.3` → `v1.6.0` |
| **PATCH** | Bug fixes, performance, security patches only | `v1.5.3` → `v1.5.4` |

```bash
git tag -l "v*" --sort=-v:refname | head -1   # current version
git log <that-tag>..<release-branch> --oneline   # what's going out
```

No pre-release suffixes — `v1.2.3-rc1` is rejected by the tag validator.

## 3. Trigger the workflow

GitHub Actions → the repo's production-release workflow → **Run workflow** → pick the
release branch, enter the version tag, run.

**You do not create the git tag yourself.** The workflow validates the format, checks the
tag doesn't already exist, confirms it is newer than the latest tag, then creates and
pushes it.

## 4. What the pipeline does

1. **Validate version, create tag** — format, uniqueness, ordering; handles first release.
2. **Prepare environment** — credentials and deployment target configuration.
3. **Run tests** — pipeline fails if any fail.
4. **Build and push the image** — tagged five ways (see below).
5. **Run migrations** — where the service has them, using the versioned image.
6. **Deploy** — update the task definition, wait for stability.
7. **Create a release draft** — changelog generated from commits since the last tag.

### Image tag scheme

For release `v1.2.3`:

| Tag | Purpose | Moves? |
|---|---|---|
| `1.2.3` | exact version | never |
| `1.2` | major.minor | with patch releases |
| `1` | major | with minor and patch releases |
| `latest` | most recent release | every release |
| `{sha}-{run}` | unique build id | never |

## 5. Publish the draft

The workflow leaves a **draft** release. Review it, then publish:

- Check the generated changelog against what you expected to ship.
- Add **Highlights**, and for a major, **Breaking Changes** and a **Migration Guide**.
- Note API changes and any known issues.
- Publish — this notifies watchers.

Then verify the deployment and exercise the critical flows. The per-repo guide has the
exact commands for that service.

---

## Troubleshooting

**"Tag v1.2.3 already exists"** — pick a different version, or delete the tag if it was
created by mistake: `git tag -d v1.2.3 && git push origin :refs/tags/v1.2.3`.

**"Tag v1.2.0 is not newer than the latest tag v1.5.0"** — the validator enforces
monotonic versions so you cannot accidentally ship backwards. Use a higher number.

**"Tag must be in format v{major}.{minor}.{patch}"** — no missing `v`, no two-part
versions, no pre-release suffixes.

**Tests fail** — reproduce locally, fix on the release branch, re-run. If the tag was
already created, delete it first (`git push origin :refs/tags/vX.Y.Z`) or the re-run will
fail validation.

**Build fails** — check the Dockerfile, dependency availability, and that the image
registry exists with the right permissions.

**Deploy fails** — verify the repository variables for the production role, region and
registry are set; confirm the cluster and service exist; read the container logs and
deployment events; check task-definition CPU/memory and IAM permissions.

**"Deployment not found after stabilization. The deployment was likely rolled back"** —
often it was not rolled back. A second release of the same service supersedes the first
deployment, and the action watching the earlier one then cannot find it and reports this.
Check the service's deployment list and the image tag actually running before believing
the message: a superseded deployment leaves a *newer* image live, a real rollback leaves
an older one. This happened twice in one day while two people released in parallel.

**A green deploy that is not live yet** — the workflow reporting success does not mean
every task is running the new image. Until the old tasks drain they keep serving, and
anything that picks one replica to act — a scheduled job holding a database advisory
lock, for instance — may still be running the previous release for several minutes.
Confirm by task start time and task-definition revision, not by the workflow's verdict.

**The version validator rejects a tag that was computed automatically** — in a repo where
several independently-released apps share one tag namespace, scanning "the tags" can miss
a prefix entirely if it only reads the first page of results. The scan then looks like a
repo that has never been released and proposes a first version, which the validator
rejects for not being newer. The validator refusing it is the good outcome; the versions
would otherwise walk backwards.

**Migration fails** — check the migration itself, database connectivity, and user
permissions, then read the migration task's logs. Fix forward and redeploy.

**Rollback** — either select the previous task-definition revision on the service, or
re-run the release workflow with the previous version tag.

---

## Practices worth keeping

- Release regularly and in small batches; a release nobody can read the changelog of is a
  release nobody can debug.
- Group related features; don't let one risky change ride along with ten safe ones.
- Document breaking changes prominently, with the migration steps.
- After publishing: watch logs and error rates, verify the critical flows, tell the team.

---

*See also: [Contributing Guide](guide.md) · [Developer Setup](dev-setup.md) · [Documentation System](docs-system.md)*
