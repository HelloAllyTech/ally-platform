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
| **ASG** | **`ally-prd-mb-ecs-cluster-asg-learn`** (min 4 / max 36) |
| **Launch template** | **`ally-prd-mb-ecs-cluster-lt-learn`** (clone of the shared LT, instance type swapped). Default/`$Latest` = **version 2 = t3.medium**. |
| **Instance type** | **`t3.medium`** (2 vCPU / 4 GB) — see "Why t3.medium, not bigger" below |
| Task def family | `ally-prd-td-learn-core` — container **CPU 1024, memory 3500, stopTimeout 120** |
| Worker | `num_idle_processes=2` (2 warm job processes; see app/worker.py) → **64 warm job slots across 32 tasks** |
| Placement | `binpack` by MEMORY (moot — 1 task/instance, port-bound; see below) |
| Service desired | 32 (autoscaler pinned min=max=32) |

The other 5 services stay on capacity provider **`ondemand`** (ASG
`ally-prd-mb-ecs-cluster-asg-od-v2`, t3.medium). Do **not** move learn-core back to
`ondemand`.

## Why this exists
- `learn-core-cp` isolates learn-core so its deploys / scaling / any join-timeout churn
  cannot disrupt the backend, web, or Redis (which share the other ASG).
- `num_idle=2` keeps warm job processes ready so incoming sessions are assigned instantly.
  This — **not** instance size — is what fixes the intermittent `AssignmentTimeoutError` /
  "agent did not join": cold-start of a job process (~6s) was racing LiveKit's ~7.5s
  assignment window; a pre-warmed process is assigned in milliseconds.

## Why t3.medium, not bigger
The task binds a **fixed `hostPort: 8000` on bridge networking**, so **exactly one task
runs per instance** regardless of instance size. A bigger box (r6i.xlarge etc.) therefore
runs the *same single task* — you pay ~4× for zero extra density. We tried r6i.xlarge and
it was pure waste. The correct capacity lever is **horizontal**: more t3.medium instances =
more tasks = more warm slots. CPU reservation (1024) is likewise moot for packing — with
one task per instance nothing else competes for the box; the exact value only needs to fit
under the instance's vCPU (t3.medium = 2048 units) so the task schedules.

> To ever get >1 task/instance you must switch to **dynamic host ports** (`hostPort: 0`) +
> an SG ephemeral-range rule + ALB dynamic target registration. That is deferred as
> high-risk; do **not** attempt it under load.

## Does a normal deploy still target this fleet? YES.
Both `learn-core.yml` and `production-release.yaml` use `.github/actions/deploy-ecs`,
which:
1. `describe-task-definition` on the **family** → inherits the latest revision (so the
   CPU/memory above carry forward automatically), renders the new image, registers a new
   revision;
2. `amazon-ecs-deploy-task-definition@v2` updates the service with **only** the new task
   def — no `--launch-type`, no `--capacity-provider-strategy`, no `--desired-count`.

Because `UpdateService` with only a task def **preserves** the service's
`capacityProviderStrategy`, deploys stay on **`learn-core-cp`** and keep the CPU/mem.

**It would REVERT to the shared `ondemand` fleet if someone:**
- adds `--launch-type EC2` or an explicit `--capacity-provider-strategy ondemand` to the
  deploy action / an `update-service` call, or
- registers a task-def revision out-of-band with a different CPU / memory (e.g. the shared
  fleet's old memory 2560).

## Session-based autoscaling
The built-in ECS metrics can't scale learn-core: the worker is I/O-bound (~0.5% CPU, so CPU
target-tracking never moves) and container memory is baseline-dominated (prewarmed VAD/BVC +
idle job processes), so both are flat regardless of session load. The only usable signal is
**active sessions**, which the worker publishes to CloudWatch itself.

**How it works**
- Each task emits its `AgentServer.active_jobs` count to CloudWatch custom metric
  **`Ally/LearnCore` → `ActiveSessions`** (dimension `Service=ally-prd-svc-learn-core`), via
  the `load_fnc` hook (`app/core/worker_metrics.py`). The hook returns LiveKit's *exact*
  default worker load (dispatch behaviour unchanged) and side-emits the metric — best-effort,
  throttled to once/60s, PROD-only, and fully guarded so it can never break a session.
- IAM: the app's identity (`smtp-user-prd`, creds from the S3 env file — NOT the task role)
  has `cloudwatch:PutMetricData` scoped to the `Ally/LearnCore` namespace via managed policy
  **`ally-prd-learn-core-cw-metrics`**.
- Because every task reports its *own* `active_jobs`, the CloudWatch **Average** statistic
  across tasks IS sessions-per-task directly — no `RunningTaskCount` metric (and no Container
  Insights) needed. An ECS **target-tracking** policy holds that average at a target, scaling
  the pinned task count between **min 12 and max 40** (adding tasks pulls the average down as
  fresh tasks report ~0 sessions — the inverse-proportional-to-capacity property target
  tracking needs). Managed scaling then launches/drains t3.mediums to match (1 task/instance).

**Bounds (conservative first cut, tune after a load test):** floor 12 tasks (24 warm slots
always ready to absorb an instant burst while scale-out catches up), target ~3 sessions/task,
ceiling 40 tasks. ASG `max-size` is 44 (40 + rolling-deploy headroom); CP
`instanceWarmupPeriod` is 180s (was 0 — with 0 it over/undershot, e.g. ASG bounced 29↔36).

**Activation is gated on the metric existing** (i.e. the worker build carrying
`worker_metrics.py` must be deployed first). Until then the scalable target stays pinned at
`min=max=32`. To activate once the metric is confirmed flowing in CloudWatch:
```
# 1. widen the pin to autoscaling bounds
aws application-autoscaling register-scalable-target --service-namespace ecs \
  --resource-id service/ally-prd-mb-ecs-cluster/ally-prd-svc-learn-core \
  --scalable-dimension ecs:service:DesiredCount --min-capacity 12 --max-capacity 40
# 2. attach the target-tracking policy (customized sessions-per-task metric-math)
#    see scripts/scaling/learn-core-target-tracking.json
# 3. smooth managed scaling
aws ecs update-capacity-provider --name learn-core-cp \
  --auto-scaling-group-provider managedScaling='{status=ENABLED,targetCapacity=100,minimumScalingStepSize=1,maximumScalingStepSize=100,instanceWarmupPeriod=180}'
```
**Rollback the autoscaler** (re-pin to a flat, safe count) at any time:
```
aws application-autoscaling register-scalable-target --service-namespace ecs \
  --resource-id service/ally-prd-mb-ecs-cluster/ally-prd-svc-learn-core \
  --scalable-dimension ecs:service:DesiredCount --min-capacity 32 --max-capacity 32
```

**Load-test findings (2026-07-15, partial):** a bounded synthetic test via
`scripts/load-test-agent.py` (pin fleet to 1–2 tasks, ramp fake users) did NOT yield a
clean per-task ceiling — the driver's OpenAI calls (Whisper/TTS) hit heavy
`APIConnectionError` from the container at 7–12 concurrent bots, so sessions were mostly
*held idle* rather than actively conversing, and load concentration onto one task was
imperfect. What IS defensible:
- The metric pipeline works under real load (a live session shows as `ActiveSessions`).
- **Idle baseline memory ≈ 2.15 GB** of the 3500 limit (prewarmed VAD/BVC + `num_idle=2`).
- Roughly **~190 MB per held (idle-ish) session** → memory headroom allows only ~5–6
  idle sessions/task; *active* sessions cost more (LLM context, audio buffers), so the real
  ceiling is lower. CPU stayed low (~0.6 vCPU at ~4 sessions) — **memory is the tighter
  constraint**, not CPU.
- Conclusion: the **target of 3 sessions/task is a reasonable-to-conservative** setting
  against a rough ~5 ceiling; no retune made. A clean number still needs either a
  **reliably-connected load driver** (not this container) or **observing real sessions** via
  the now-live `ActiveSessions` metric as organic concurrency grows.

## Rollback (to the shared fleet)
`aws ecs update-service --cluster ally-prd-mb-ecs-cluster --service ally-prd-svc-learn-core --capacity-provider-strategy capacityProvider=ondemand,base=1,weight=1 --task-definition <a-learn-core-revision> --force-new-deployment`
