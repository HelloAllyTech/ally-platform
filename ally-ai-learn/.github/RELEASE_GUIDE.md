# Release Guide — ally-ai-learn (Learn Core)

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger the workflow, the image tag
scheme, publishing the draft, and troubleshooting. This file carries only what is specific
to this service.

## This service

| | |
|---|---|
| Workflow | `production-release-ally-ai-learn.yaml` in the monorepo's root `.github/workflows/` |
| Release branch | `master` |
| Tag | `learn-vX.Y.Z` |
| Runtime in CI | Python 3.12 (`TEST_RUNTIME_VERSION`) |
| Package manager | Poetry |
| Deployment | Ansible playbook via the `deploy-metal01` action (production stack, since the 2026-11-07 cutover) |
| Runs migrations | None |

## Deployment

The release workflow's deploy job runs the `ally_learn.yml` playbook from the private infra repo
through `.github/actions/deploy-metal01`, then polls the service's health endpoint until it answers. Its
inputs are repository secrets (the deploy SSH key, the infra deploy key and the Ansible
vault password) — see the comment at the top of that action. Container logs, restarts and
recovery are in the infra repo's runbook, not here: this repository is public.

The ECS cluster, service and task-definition names this guide used to list belong to the
pre-cutover stack and no longer receive production releases.

## Notes specific to this service

- **This service joins LiveKit rooms created by ally-be.** After a release, verify against
  a real session rather than a health check — the worker can start cleanly and still fail
  to join.
- Deployment mechanics beyond the release pipeline are in [`DEPLOYMENT.md`](../DEPLOYMENT.md).
