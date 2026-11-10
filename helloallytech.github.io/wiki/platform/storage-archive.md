---
title: Storage Archive — Moving Aged S3 Objects to a Hetzner Storage Box
tags: [platform, storage, s3, hetzner, archive, cost, infra, decision]
summary: The plan and recorded decisions for cutting the AWS storage bill — a weekly job in the ally-archiver app copies every private S3 object older than 30 days to a VPN-only Hetzner Storage Box, verifies it, then deletes it from S3.
last_reconciled: 2026-10-28
---

# Storage Archive — Moving Aged S3 Objects to a Hetzner Storage Box

Every week, a small Go + htmx app, [`ally-archiver`](../repos/ally-archiver.md), moves every
private S3 object older than 30 days to a Hetzner Storage Box and deletes it from S3. Moved
objects become **archive only**: Ally no longer reads them, and an operator restores one through the
archiver when it is needed.

Tracking issue: [ally-platform#116](https://github.com/HelloAllyTech/ally-platform/issues/116).

## Why

The AWS bill's storage line keeps growing because nothing removes old private objects. No S3
lifecycle rules exist in code or infra, and ally-be's `DATA_SCHEMA.md` says nothing sweeps the
buckets. Roleplay session recordings are never deleted, and agent traces accumulate. A Storage Box
costs a fraction of S3 Standard per GB.

An earlier version of this plan was lost because it lived only in a chat session. This page is now
its home: update it when the plan changes.

## Decisions (2026-10-28)

| Decision | Choice | Consequence |
|---|---|---|
| Scope | Every private bucket, **including PHI** (roleplay recordings, agent traces, chat audio) | PHI leaves AWS, which has a BAA, for Hetzner, which has none. This is an **accepted compliance risk**, owned by the platform lead. |
| Encryption | **No app-layer encryption.** Protection is the network: the archiver VM is VPN-only, and the Storage Box accepts only the archiver's named host and SSH key. | Anyone holding the Storage Box key reads plaintext, so the key lives only in Ansible Vault and on the VM. |
| Read-back | **Archive only.** Ally doesn't read moved objects. | A roleplay recording older than 30 days stops playing in the session logs, because its presigned URL points at a deleted key. Restores go through the archiver. |
| Public media | **Stays on S3.** | Logos, covers, badges and knowledge-base files are stored in Postgres as full S3 URLs and stay in use regardless of age. |
| Backfill | **One-time backfill** of everything older than 30 days, then weekly runs | One-off AWS egress, about $0.09/GB, which pays back in about 4 months of S3 Standard storage. |

## What moves

| Bucket (ally-be env var) | Contents | Moves |
|---|---|---|
| `SCENARIO_SESSION_AUDIO_STORAGE_S3_BUCKET` | LiveKit egress recordings, `recordings/YYYY/MM/DD/<room>.ogg`, never deleted today | Yes. Likely the largest. It has its own credentials. |
| `AGENT_TRACE_S3_BUCKET` (falls back to the audio bucket) | `agent-traces/<agent>/<yyyy>/<mm>/<turn>.json` | Yes |
| `AUDIO_STORAGE_S3_BUCKET` | Counselor call audio (`microphone-chat/`, `audio-upload/`, `.checkpoint` copies), mostly deleted after the summary | Yes. What remains after 30 days is orphans and checkpoints. |
| `ASSETS_S3_BUCKET`, `LEARN_MEDIA_PUBLIC_S3_BUCKET` | Public media stored as full URLs | No |
| `CLIP_STORE_BUCKET` (ally-ai-learn) | Live TTS clip cache | No |
| Env-file, dashboard and credential buckets | CI and ops | No |
| Buckets not referenced in code | Unknown | Found by the inventory; each is opt-in |

Real bucket names are never written here; they live in the deploy env and Vault.

## How one object moves

1. **Plan.** List objects whose `LastModified` is more than 30 days ago, skipping keys already in
   the archiver's ledger.
2. **Copy.** Stream the object from S3 to `<bucket>/<key>.part` on the Storage Box over SFTP,
   computing SHA-256 as it streams, then rename it into place.
3. **Verify.** Run `sha256sum` on the Storage Box and compare the hash and size with the streamed
   values. The ledger marks the object `copied`.
4. **Delete, one run later.** The next weekly run re-verifies the remote hash, deletes the S3
   object and all its versions, and marks it `deleted`. Everything is still on S3 for a week, so
   mistakes can be caught before data leaves.

**Guardrails.** Buckets start disabled and unarmed, and dry runs are the default. A run has a byte
cap and a rate limit, and only one runs at a time. Any verify failure stops deletes for that
bucket. A copy of the ledger is written to the Storage Box after every run.

## Rollout

0. **Measure and quick wins.**
   1. Split the S3 cost by bucket and usage type in Cost Explorer.
   2. Check each bucket for versioning and incomplete multipart uploads. ally-be streams mic audio
      as multipart uploads, and abandoned parts are billed but invisible to a plain listing.
   3. Add lifecycle rules: abort incomplete multipart uploads after 7 days, and expire noncurrent
      versions after 7 days. **Without the versions rule, a delete on a versioned bucket only adds a
      delete marker and saves nothing.**
   4. Run `archiver inventory` to get the eligible GB per bucket and the backfill egress cost, and
      size the Storage Box from it.
1. **Provision.**
   - The smallest Hetzner Cloud VM in the Storage Box's location, with a cloud firewall that allows
     **no inbound traffic**. WireGuard dials out to the hub; SSH and the UI are reachable only over
     the VPN.
   - The VPN peer is registered through the operator portal (see [infra](../repos/infra.md)).
   - The Storage Box has external reachability off and SFTP only, with a sub-account limited to the
     archive directory.
   - A least-privilege IAM user can list, get, delete and (for restores) put on the in-scope buckets only.
   - Provisioning code lives in the infra repo: the first Hetzner Cloud Terraform there, plus an
     Ansible role and a systemd unit.
2. **Build** the [ally-archiver](../repos/ally-archiver.md) app.
3. **Backfill**, one bucket at a time, smallest first: agent traces, then chat audio, then
   recordings. Each bucket gets a dry run that is reviewed in the UI, then it is armed, then a
   throttled overnight run follows. Deletes land one run later.
4. **Steady state.** The weekly run is Sunday 02:00 UTC and posts a summary to Slack. Check the
   storage line on the AWS bill monthly.

## Open questions

- Which buckets actually drive the bill? Phase 0 answers this.
- Does the scenario-recordings bucket belong to a separate AWS account? It has its own credentials,
  and a separate account would need a second IAM user.
- Should ally-be show "archived" instead of a broken player for recordings older than 30 days? This
  is a possible follow-up and is not in scope.
