# Release Guide — ally-ai

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger the workflow, the image tag
scheme, publishing the draft, and troubleshooting. This file carries only what is specific
to this service.

## This service

| | |
|---|---|
| Workflow | `production-release-ally-ai.yaml` in the monorepo's root `.github/workflows/` |
| Release branch | `master` |
| Tag | `ai-vX.Y.Z` |
| Runtime in CI | Python 3.12 |
| Package manager | Poetry (venv cached on `poetry.lock`) |
| Deployment | Ansible playbook via the `deploy-metal01` action (production stack, since the 2026-11-07 cutover) |
| Runs migrations | Weaviate schema migrations (`app/migrations/`), run inside the playbook |

## Deployment

The release workflow's deploy job runs the `ally_ai.yml` playbook from the private infra repo
through `.github/actions/deploy-metal01`, then polls the service's health endpoint until it answers. Its
inputs are repository secrets (the deploy SSH key, the infra deploy key and the Ansible
vault password) — see the comment at the top of that action. Container logs, restarts and
recovery are in the infra repo's runbook, not here: this repository is public.

The ECS cluster, service and task-definition names this guide used to list belong to the
pre-cutover stack and no longer receive production releases.

## Notes specific to this service

- **Weaviate migrations are ordered and immutable.** Follow the `NNN-description.py`
  convention in `app/migrations/`; never renumber or edit one that has shipped.
- **A release pushes the prompt defaults itself.** The image's start command (`Dockerfile`
  `CMD`) runs `scripts/sync_prompts.py` before the API starts, so every deploy publishes
  this repo's default prompts to ally-be's prompt management — `v1.21.0` brought the new
  helpline prompts to production with no manual step. In that default command the chain is
  `&&` and the script exits 1 when `ALLY_CORE__ENDPOINT`/`ALLY_CORE__API_KEY` are unset or
  ally-be rejects the sync, so a failed sync stops the API from starting (production's
  container command is set by the infra playbook, not here — check it before relying on that). Local compose
  (`docker-compose.local.yml`) continues past a failed sync instead, which is why a local
  ally-be can hold older prompts than the code. `make sync-prompts` pushes defaults
  without a deploy.
