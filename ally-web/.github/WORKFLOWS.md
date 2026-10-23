# GitHub Actions workflows for ally-web

Since the move into the `ally-platform` monorepo (2026-10-23), every workflow that runs for
ally-web lives at the **monorepo root**, under `.github/workflows/`. Nothing under
`ally-web/.github/` is registered with GitHub Actions; this directory only carries this
guide, the release guide, CODEOWNERS, the PR template and Dependabot config.

Releases are covered in [`RELEASE_GUIDE.md`](RELEASE_GUIDE.md) and the wiki
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md). This
file maps the remaining workflows and the composite actions they share.

## Workflows (monorepo root)

| Workflow | File | Trigger | What it does |
|---|---|---|---|
| Tests (ally-web) | `.github/workflows/test-ally-web.yml` | PR / push to `master`, `ally-web/**` paths only | Installs, lints and runs the Vitest suites |
| Production Release - Admin Dashboard | `.github/workflows/production-release-admin-dashboard.yaml` | `workflow_dispatch` | Tags `admin-vX.Y.Z`, builds the Nx app, uploads to S3, invalidates CloudFront, drafts the release |
| Production Release - Helpline Dashboard | `.github/workflows/production-release-helpline-dashboard.yaml` | `workflow_dispatch` | Same as above for the helpline dashboard, tagging `helpline-vX.Y.Z` |
| Deploy Ally Admin Dashboard to CDN | `.github/workflows/deploy-ally-admin-dashboard-cdn.yml` | `workflow_dispatch` | Ad-hoc CDN deploy without cutting a release |
| Deploy Ally Helpline Dashboard to CDN | `.github/workflows/deploy-ally-helpline-dashboard-cdn.yml` | `workflow_dispatch` | Ad-hoc CDN deploy without cutting a release |

Shared, cross-service workflows (Docs guard, secret scan, changelog notify, Builder and Bug
Hunter) also run from the root and are not ally-web specific.

## Composite actions

The CDN deploy and release workflows share two composite actions:

- `.github/actions/ally-web/aws/set-environment-vars/action.yml` — resolves the AWS role,
  region and project prefix for the chosen environment from repository variables.
- `.github/actions/ally-web/aws/set-cdn-vars/action.yml` — resolves the S3 bucket and
  CloudFront distribution for the app being deployed.

## Required repository settings

Settings → Secrets and variables → Actions:

```
PRD_AWS_ROLE          # secret: AWS IAM role ARN assumed via OIDC
PRD_AWS_REGION        # variable
```

Bucket and distribution names are derived from the project prefix inside the composite
actions; there is nothing per-app to configure.

## What was removed

An earlier, unused ECS deployment system (a reusable `deploy-ecs-service` workflow, a
`manual-deploy` workflow, a deploy-app template and Docker build/push, ECS deploy and
service-vars composite actions) was deleted during the monorepo cleanup. Both dashboards
are static builds served from S3 and CloudFront; nothing in ally-web deploys to ECS.

## Adding a workflow

Add it at the monorepo root under `.github/workflows/`, scope its triggers with
`paths: [ally-web/**]`, and set `defaults.run.working-directory: ally-web` so `npm`
commands resolve against this app. Do not add files under `ally-web/.github/workflows/`:
GitHub Actions never reads them.
