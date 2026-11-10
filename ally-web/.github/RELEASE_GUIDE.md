# Release Guide — ally-web

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger a workflow, publishing the draft,
and general troubleshooting. This file carries what is specific to this repo.

## One pipeline, two dashboards

Both dashboards release through **one** workflow, `production-release-frontends.yaml`
("Production Release - Frontends"), with **one shared version series**: `frontend-vX.Y.Z`.

```bash
gh workflow run "Production Release - Frontends" --ref master \
  -f version_tag=frontend-vX.Y.Z -f apps=both     # or apps=helpline / apps=admin
```

Check the latest tag first — the new one must be strictly newer:

```bash
git ls-remote --tags origin | grep -oE "frontend-v[0-9.]+" | sort -V | tail -1
```

The apps themselves stay fully separate — own code, own tests, own build-time env, own
login. They only share the pipeline and the production domain:

| App | Served at | App path | Build | Tests |
|---|---|---|---|---|
| Helpline Dashboard | `app.helloally.ai` | `apps/ally-helpline-dashboard` | `npm run build` (app dir) → `apps/ally-helpline-dashboard/dist/` | `npm run test:helpline`, `npm run test:ui-shared` |
| Admin Dashboard | `app.helloally.ai/admin/` | `apps/ally-admin-dashboard` | `npx nx build ally-admin-dashboard` with `VITE_BASE_PATH=/admin/` → `dist/apps/ally-admin-dashboard/` | `npx nx test ally-admin-dashboard` |

`admin.helloally.ai` permanently redirects to `app.helloally.ai/admin/` (paths preserved).

### What one run does

1. Validates the tag and creates it.
2. Per selected app, in parallel: tests, then a build in its **own job** with its own
   build-time env (so neither app's `.env` can leak into the other's build). Helpline also
   syncs and publishes translations first.
3. **Nothing deploys unless every selected app tested and built.** Then helpline deploys,
   then admin, each followed by a live check.
4. One draft release with a per-app changelog.

Two frontend releases never run at once (the workflow has a concurrency guard).

Runtime in CI is **Node.js 20** for both.

## Notes specific to this repo

- **A `libs/ui-shared` change ships in both.** Prefer `apps=both` when one is in the release.
- **Users with an open tab during a deploy** get one automatic reload on their next screen
  (hashed chunk files are replaced on every deploy) — expected, not a bug.
- The old per-app workflows (`production-release-admin-dashboard.yaml`,
  `production-release-helpline-dashboard.yaml`, tags `admin-v*` / `helpline-v*`) are kept
  briefly as a fallback and will be removed. Don't mix: once you release with
  `frontend-v*`, keep using it.
- CI and deployment workflow details: [`WORKFLOWS.md`](WORKFLOWS.md).
