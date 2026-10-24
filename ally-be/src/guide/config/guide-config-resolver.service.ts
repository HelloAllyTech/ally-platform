import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'util';
import { Repository } from 'typeorm';
import { AgentConfigOverrideService } from 'src/llm-agent/harness/config/agent-config-override.service';
import {
  PolicyChainLink,
  PolicyIgnored,
  PolicyKeySpec,
  PolicyLayer,
  PolicyValue,
  PolicyValues,
} from 'src/llm-agent/harness/config/policy-schema';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { GuideLearnerPrefs } from '../entity/guide-learner-prefs.entity';
import { GuideEpochConfig, GuideThread } from '../entity/guide-thread.entity';
import { GuideMode } from '../enum/guide.enum';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from '../release/policy.schema';
import {
  GuideConfigRuntime,
  ResolvedGuideConfig,
  resolveGuidePolicy,
} from './guide-config';

export interface GuideConfigExplainEntry {
  key: string;
  group: string;
  value: PolicyValue;
  source: PolicyLayer;
  /** Every layer that set it, lowest first; the last one won. */
  chain: PolicyChainLink[];
  /** The release's value, before any layer. */
  releaseValue: PolicyValue;
  unit: string | null;
  description: string;
  overridableBy: PolicyKeySpec['overridableBy'];
  pinned: boolean;
  learnerLever: string | null;
  /** Saved since this epoch began: the value the next epoch will use. */
  pending: { value: PolicyValue; source: PolicyLayer } | null;
}

export interface GuideConfigExplanation {
  threadId: string;
  epoch: number;
  epochStartedAt: string | null;
  releaseId: string | null;
  releaseVersion: number | null;
  /** GA has moved on: the next epoch runs this release instead. */
  nextReleaseId: string | null;
  /** True when the org or course overrides changed after this epoch began. */
  overridesPending: boolean;
  runtime: {
    mode: string;
    tier: string | null;
    model: string | null;
    guidance: string;
    visitor: boolean;
  };
  entries: GuideConfigExplainEntry[];
  /** Stored values the schema refused (stale rows); never applied. */
  ignored: PolicyIgnored[];
}

/**
 * `ConfigResolver` (plan §7.5): resolves Ally's policy for a thread through
 * release defaults → org → course → learner prefs → runtime, and explains
 * where each value came from.
 *
 * Cached per epoch by construction: `freezeEpoch` reads the override rows
 * once, when an epoch begins, and the turn service stores the result in the
 * epoch snapshot; every later turn of that epoch resolves from the snapshot
 * without touching the database. That is also what makes an override take
 * effect "from the next epoch" on every instance at once.
 */
@Injectable()
export class GuideConfigResolverService {
  constructor(
    private readonly overrides: AgentConfigOverrideService,
    private readonly releases: AgentReleaseService,
    @InjectRepository(GuideThread)
    private readonly threads: Repository<GuideThread>,
    @InjectRepository(GuideLearnerPrefs)
    private readonly prefs: Repository<GuideLearnerPrefs>,
  ) {}

  /** The org and course overrides for a new epoch. A visitor has no org layer. */
  async freezeEpoch(scope: {
    tenantId: string | null;
    trackId: string;
  }): Promise<GuideEpochConfig> {
    const rows = await this.overrides.forScopes(ALLY_GUIDE_AGENT_KEY, scope);
    return {
      org: (rows.org?.values ?? {}) as PolicyValues,
      course: (rows.course?.values ?? {}) as PolicyValues,
      versions: {
        org: rows.org?.version ?? null,
        course: rows.course?.version ?? null,
      },
    };
  }

  /** One turn's policy (pure; see `resolveGuidePolicy`). */
  resolve(threadContext: {
    bundle: GuideReleaseBundle;
    epochConfig: GuideEpochConfig | null | undefined;
    prefs: GuideLearnerPrefs['prefs'] | null | undefined;
    runtime: GuideConfigRuntime;
  }): ResolvedGuideConfig {
    return resolveGuidePolicy({
      releasePolicy: threadContext.bundle.policy ?? GUIDE_DEFAULT_POLICY,
      epochConfig: threadContext.epochConfig,
      prefs: threadContext.prefs,
      runtime: threadContext.runtime,
    });
  }

  /** The Effective config explainer: every value with its source. */
  async explain(threadId: string): Promise<GuideConfigExplanation> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    const snapshot = thread.epochSnapshot ?? null;
    const visitor = !thread.userId;

    const [pinned, ga, prefsRow, current] = await Promise.all([
      snapshot?.releaseId ? this.releaseOrNull(snapshot.releaseId) : null,
      this.releases.getGa(ALLY_GUIDE_AGENT_KEY),
      visitor || !thread.tenantId
        ? null
        : this.prefs.findOne({
            where: { userId: thread.userId!, tenantId: thread.tenantId },
          }),
      this.freezeEpoch({
        tenantId: visitor ? null : (thread.tenantId ?? null),
        trackId: thread.trackId,
      }),
    ]);
    const release = pinned ?? ga;
    const bundle = (release?.bundle ?? {
      policy: GUIDE_DEFAULT_POLICY,
    }) as GuideReleaseBundle;
    const runtime: GuideConfigRuntime = {
      mode: (thread.mode as GuideMode) ?? GuideMode.NORMAL,
      visitor,
    };
    const prefs = prefsRow?.prefs ?? null;
    const now = this.resolve({
      bundle,
      epochConfig: snapshot?.config ?? null,
      prefs,
      runtime,
    });
    const next = this.resolve({
      bundle,
      epochConfig: current,
      prefs,
      runtime,
    });
    const releaseOnly = this.resolve({
      bundle,
      epochConfig: null,
      prefs: null,
      runtime: { mode: GuideMode.NORMAL, visitor: false },
    });

    const entries: GuideConfigExplainEntry[] = Object.entries(
      GUIDE_POLICY_SCHEMA,
    ).map(([key, spec]) => {
      const entry = now.resolved.entries[key];
      const upcoming = next.resolved.entries[key];
      return {
        key,
        group: spec.group,
        value: entry.value,
        source: entry.source,
        chain: entry.chain,
        releaseValue: releaseOnly.resolved.entries[key].value,
        unit: spec.unit ?? null,
        description: spec.description,
        overridableBy: spec.overridableBy,
        pinned: Boolean(spec.pinned),
        learnerLever: spec.learnerLever ?? null,
        pending:
          isDeepStrictEqual(upcoming.value, entry.value) &&
          upcoming.source === entry.source
            ? null
            : { value: upcoming.value, source: upcoming.source },
      };
    });

    const frozen = snapshot?.config?.versions ?? { org: null, course: null };
    return {
      threadId: thread.id,
      epoch: thread.epoch,
      epochStartedAt: snapshot?.startedAt ?? null,
      releaseId: release?.id ?? null,
      releaseVersion: release?.version ?? null,
      nextReleaseId: ga && release && ga.id !== release.id ? ga.id : null,
      overridesPending:
        frozen.org !== current.versions.org ||
        frozen.course !== current.versions.course,
      runtime: {
        mode: runtime.mode,
        tier: snapshot?.tier ?? null,
        model: snapshot?.model ?? null,
        guidance: prefs?.guidance ?? 'walk',
        visitor,
      },
      entries,
      ignored: now.resolved.ignored,
    };
  }

  private async releaseOrNull(id: string): Promise<AgentRelease | null> {
    try {
      return await this.releases.getById(id);
    } catch {
      return null;
    }
  }
}
