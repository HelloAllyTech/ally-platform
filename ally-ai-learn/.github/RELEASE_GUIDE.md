# Release Guide — ally-ai-learn (Learn Core)

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger the workflow, the image tag
scheme, publishing the draft, and troubleshooting. This file carries only what is specific
to this service.

## This service

| | |
|---|---|
| Workflow | **Production Release** (monorepo root `.github/workflows/production-release-ally-ai-learn.yaml`) |
| Release branch | `master` |
| Runtime in CI | Python 3.12 (`TEST_RUNTIME_VERSION`) |
| Package manager | Poetry |
| Deployment | AWS ECS |

## Deployment target

- **Service**: `learn-core`
- **Cluster**: `ally-prd-mb-ecs-cluster`
- **ECS service**: `ally-prd-svc-learn-core`
- **Task definition**: `ally-prd-td-learn-core`
- **Container**: `ally-prd-cntr-learn-core`

## Required repository variables

Settings → Secrets and variables → Actions → Variables:

```
PRD_AWS_ROLE          # AWS IAM role ARN for production
PRD_AWS_REGION
PRD_ECR_REPOSITORY
```

## Verify a deployment

```bash
aws ecs describe-services \
  --cluster ally-prd-mb-ecs-cluster \
  --services ally-prd-svc-learn-core

aws ecs list-tasks \
  --cluster ally-prd-mb-ecs-cluster \
  --service-name ally-prd-svc-learn-core

aws logs tail /ecs/ally-prd-cntr-learn-core --follow
```

## Notes specific to this service

- **This service joins LiveKit rooms created by ally-be.** After a release, verify against
  a real session rather than a health check — the worker can start cleanly and still fail
  to join.
- Deployment mechanics beyond the release pipeline are in [`DEPLOYMENT.md`](../DEPLOYMENT.md).
