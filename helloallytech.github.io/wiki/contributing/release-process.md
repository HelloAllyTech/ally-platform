---
title: Release Process
tags: [contributing, release, versioning, ci, deployment]
summary: The shared production-release process for every Ally service in the ally-platform monorepo — per-service tags, semantic versioning, the automated pipeline (Ansible deploy to the production stack), release-draft review, and troubleshooting.
last_reconciled: 2026-11-18
---

# Release Process

Every Ally service releases the same way: you pick a version, trigger one workflow, and
review the draft it produces. This page is the **shared** half of that process.

**`master` is not live until it is tagged.** A merge only lands code; a release workflow
puts it in production.

All release workflows live in the `ally-platform` monorepo's `.github/workflows/`, one per
deployable, each with its own tag prefix:

| Deployable | Workflow | Tag | Its guide |
|---|---|---|---|
| ally-be | `production-release-ally-be.yaml` | `be-vX.Y.Z` | `ally-be/.github/RELEASE_GUIDE.md` |
| ally-ai | `production-release-ally-ai.yaml` | `ai-vX.Y.Z` | `ally-ai/.github/RELEASE_GUIDE.md` |
| ally-ai-learn | `production-release-ally-ai-learn.yaml` | `learn-vX.Y.Z` | `ally-ai-learn/.github/RELEASE_GUIDE.md` |
| helpline + admin dashboards | `production-release-frontends.yaml` | `frontend-vX.Y.Z` (one tag for both; choose `both`, `helpline` or `admin`) | `ally-web/.github/RELEASE_GUIDE.md` |
| ally-archiver | `release-ally-archiver.yml` | `archiver-vX.Y.Z` | [ally-archiver](../repos/ally-archiver.md) |
| ally-mobile | `scheduled-mobile-release.yml` and the build/promote/submit workflows | store versions | [ally-mobile](../repos/ally-mobile.md) |

`admin-v*` and `helpline-v*` tags are legacy from before the frontends shared one pipeline.
Each per-app guide carries only what differs for that service.

---

## 1. Before you release

- All changes merged to `master`.
- CI green **for the app you are releasing**.
- Code review complete.

**Nothing enforces "CI green" for you.** `master` in `ally-platform` has no branch
protection: no required checks, no required review, and CI is path-filtered per app
(`test-ally-<app>.yml`), so a PR that touched another app never ran yours. Before
releasing, look at the latest `master` run of the release's own test workflow; the release
workflow re-runs the tests, but finding out there wastes a version.

`docs-guard` is advisory by design: it shows red but enforces a documentation policy, not
correctness (see [Documentation System](docs-system.md)).

## 2. Pick a version

We follow [Semantic Versioning 2.0.0](https://semver.org/): `vMAJOR.MINOR.PATCH`.

| Bump | When | Example |
|---|---|---|
| **MAJOR** | Breaking API change, removed endpoint, major architecture change | `v1.5.3` → `v2.0.0` |
| **MINOR** | New feature or endpoint, backward compatible | `v1.5.3` → `v1.6.0` |
| **PATCH** | Bug fixes, performance, security patches only | `v1.5.3` → `v1.5.4` |

Versions are per deployable, so always filter by its prefix:

```bash
git tag -l "be-v*" --sort=-v:refname | head -1    # current ally-be version
git log <that-tag>..origin/master --oneline -- ally-be/   # what's going out
```

No pre-release suffixes — `be-v1.2.3-rc1` is rejected by the tag validator.

## 3. Trigger the workflow

GitHub Actions in `ally-platform` → the deployable's production-release workflow → **Run
workflow** → enter the version tag (with its prefix), run. Releases are cut from `master`.

**You do not create the git tag yourself.** The workflow validates the format, checks the
tag doesn't already exist, confirms it is newer than the latest tag, then creates and
pushes it.

## 4. What the pipeline does

1. **Validate version, create tag** — prefix and format, uniqueness, ordering against that
   prefix's latest tag; handles first release.
2. **Prepare environment** — credentials and build-time configuration.
3. **Run tests** — pipeline fails if any fail.
4. **Build and push the image** — to the container registry, tagged five ways (see below).
   The dashboards build static assets instead.
5. **Deploy** — the `deploy-metal01` composite action runs the service's Ansible playbook
   from the private infra repo against the production stack (Incus containers on Hetzner
   baremetal, since the 2026-11-07 cutover). **Database migrations run inside the
   playbook**; there is no separate migration job.
6. **Verify health** — polls the service's public health endpoint (or the site, for the
   dashboards) and fails the run if it never comes up.
7. **Create a release draft** — changelog generated from commits since the last tag with
   the same prefix.

### Image tag scheme

For release `be-v1.2.3` (version `1.2.3`):

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

**"Tag be-v1.2.3 already exists"** — pick a different version, or delete the tag if it was
created by mistake: `git tag -d be-v1.2.3 && git push origin :refs/tags/be-v1.2.3`.

**"Tag be-v1.2.0 is not newer than the latest tag be-v1.5.0"** — the validator enforces
monotonic versions so you cannot accidentally ship backwards. Use a higher number.

**"Tag must be in format be-v{major}.{minor}.{patch}"** — include the deployable's prefix;
no two-part versions, no pre-release suffixes.

**Tests fail** — reproduce locally, fix on `master`, re-run. If the tag was already
created, delete it first (`git push origin :refs/tags/<prefix>-vX.Y.Z`) or the re-run will
fail validation.

**Build fails** — check the Dockerfile, dependency availability, and that the image
registry exists with the right permissions.

**Deploy fails** — read the `deploy-metal01` step's Ansible output first: it names the
failing task. A failure before any task ran is usually access (the deploy SSH key, the infra
deploy key or the vault password secret). Container-level logs and recovery are in the
private infra repo's runbook.

**Health check fails after a green deploy** — the playbook finished but the service never
answered. Check whether a migration in the playbook failed or hung, then the container's
logs.

*Pre-cutover (ECS) notes, kept for anyone reading old run logs:* "Deployment not found after
stabilization" usually meant a second release had superseded the first, not a rollback; and
a green ECS deploy could keep old tasks serving for minutes while they drained.

**The version validator rejects a tag that was computed automatically** — in a repo where
several independently-released apps share one tag namespace, scanning "the tags" can miss
a prefix entirely if it only reads the first page of results. The scan then looks like a
repo that has never been released and proposes a first version, which the validator
rejects for not being newer. The validator refusing it is the good outcome; the versions
would otherwise walk backwards.

**Migration fails** — check the migration itself, database connectivity, and user
permissions, then read the playbook's migration step output. Fix forward and release again.

**Rollback** — revert the bad change on `master` and release a new patch version (the
validator refuses an older version number). A migration that already ran is not
undone by a rollback: fix forward.

---

## Practices worth keeping

- Release regularly and in small batches; a release nobody can read the changelog of is a
  release nobody can debug.
- Group related features; don't let one risky change ride along with ten safe ones.
- Document breaking changes prominently, with the migration steps.
- After publishing: watch logs and error rates, verify the critical flows, tell the team.

---

*See also: [Contributing Guide](guide.md) · [Developer Setup](dev-setup.md) · [Documentation System](docs-system.md)*
