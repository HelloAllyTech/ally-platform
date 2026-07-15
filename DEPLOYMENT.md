# learn-core (ally-ai-learn) — production deployment topology

> ⚠️ **Read before changing the deploy workflow or the ECS service.** Parts of this
> setup were configured directly in AWS (no Terraform/IaC for the ECS layer), so the
> repo alone does not reflect it. A careless change can silently move learn-core back
> onto the shared cluster.

## Where prod learn-core runs (AWS, ap-south-1)

learn-core runs on a **dedicated ECS capacity provider + ASG**, isolated from the other
platform services (core/web/redis/metabase/core-ai), which share a separate ASG.

| Thing | Value |
|---|---|
| ECS cluster | `ally-prd-mb-ecs-cluster` (shared by all services) |
| ECS service | `ally-prd-svc-learn-core` |
| **Capacity provider** | **`learn-core-cp`** (dedicated to learn-core) |
| **ASG** | **`ally-prd-mb-ecs-cluster-asg-learn`** (min 4 / max 12) |
| **Launch template** | **`ally-prd-mb-ecs-cluster-lt-learn`** (clone of the shared LT, instance type swapped) |
| **Instance type** | **`r6i.xlarge`** (4 vCPU / 32 GB) |
| Task def family | `ally-prd-td-learn-core` — container **CPU 1024, memory 3500, stopTimeout 120** |
| Worker | `num_idle_processes=2` (2 warm job processes; see app/worker.py) |
| Placement | `binpack` by MEMORY |
| Service desired | 16 (autoscaler pinned min=max) |

The other 5 services stay on capacity provider **`ondemand`** (ASG
`ally-prd-mb-ecs-cluster-asg-od-v2`, t3.medium). Do **not** move learn-core back to
`ondemand`.

## Why this exists
- `learn-core-cp` isolates learn-core so its deploys / scaling / any join-timeout churn
  cannot disrupt the backend, web, or Redis (which share the other ASG).
- Bigger `r6i.xlarge` instances give memory + warm-process headroom; `num_idle=2` keeps
  a warm job process ready so sessions are assigned instantly (fixes the intermittent
  `AssignmentTimeoutError` / "agent did not join").
- CPU reservation was lowered `1536 → 1024` because the worker is I/O-bound (~0.5% CPU
  used), so tasks pack denser per instance.

## Does a normal deploy still target this fleet? YES.
Both `learn-core.yml` and `production-release.yaml` use `.github/actions/deploy-ecs`,
which:
1. `describe-task-definition` on the **family** → inherits the latest revision (so the
   CPU/memory above carry forward automatically), renders the new image, registers a new
   revision;
2. `amazon-ecs-deploy-task-definition@v2` updates the service with **only** the new task
   def — no `--launch-type`, no `--capacity-provider-strategy`, no `--desired-count`.

Because `UpdateService` with only a task def **preserves** the service's
`capacityProviderStrategy`, deploys stay on **`learn-core-cp` (r6i)** and keep the CPU/mem.

**It would REVERT to the shared t3.medium fleet if someone:**
- adds `--launch-type EC2` or an explicit `--capacity-provider-strategy ondemand` to the
  deploy action / an `update-service` call, or
- registers a task-def revision out-of-band with the old CPU (1536) / memory (2560).

## Sizing is provisional
`r6i.xlarge` + CPU 1024 + 16 tasks is a conservative first cut, **not load-tested**. Open
items: confirm the instance family (r6i vs the more balanced m6i), the CPU reservation /
tasks-per-instance density, and the task count, via a concurrency load test. Tune the
capacity provider's `instanceWarmupPeriod` (currently 0) to avoid managed-scaling
over-shoot during rollouts.

## Rollback (to the shared fleet)
`aws ecs update-service --cluster ally-prd-mb-ecs-cluster --service ally-prd-svc-learn-core --capacity-provider-strategy capacityProvider=ondemand,base=1,weight=1 --task-definition <a-revision-with-cpu-1536> --force-new-deployment`
