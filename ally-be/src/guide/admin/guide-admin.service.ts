import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { GuideCrisisResponse } from '../entity/guide-crisis-response.entity';
import { GuideMessage } from '../entity/guide-message.entity';
import {
  GuideOrgProfile,
  GuideOrgProfileValue,
  GuideSupportLine,
} from '../entity/guide-org-profile.entity';
import { GuideCrisisScope, GuideMessageRole } from '../enum/guide.enum';
import { ALLY_GUIDE_AGENT_KEY } from '../release/guide-release.bundle';
import { CRISIS_SIGNAL_KIND } from '../safety/guide-crisis.service';
import { reviewableText } from '../safety/redaction';

/** Guide languages a support line or crisis copy may be written for. */
export const GUIDE_LANGUAGES = ['en', 'hi', 'mr', 'ta', 'kn'] as const;

const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

/**
 * The Ally Console's read models and the organisation layer's editors
 * (plans/ally-guide/plan.md §10.5): live health, the conversation list, the
 * redacted transcript, the org's Ally profile and the fixed crisis copy.
 * Health numbers are platform aggregates; nothing here names a learner.
 */
@Injectable()
export class GuideAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    @InjectRepository(GuideMessage)
    private readonly messages: Repository<GuideMessage>,
    @InjectRepository(GuideOrgProfile)
    private readonly orgProfiles: Repository<GuideOrgProfile>,
    @InjectRepository(GuideCrisisResponse)
    private readonly crisisResponses: Repository<GuideCrisisResponse>,
  ) {}

  /** Overview tab: the last `days` days of turns, safety and cost. */
  async overview(days: number) {
    const window = Math.min(90, Math.max(1, Math.floor(days)));
    const [turns, byChannel, traces, crises, ga] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE "status" = 'completed') AS completed,
                count(*) FILTER (WHERE "status" = 'failed') AS failed,
                count(*) FILTER (WHERE "status" = 'interrupted') AS interrupted,
                count(DISTINCT "threadId") AS threads,
                COALESCE(sum("costUsd"), 0) AS cost
           FROM "agent_turns"
          WHERE "agentKey" = $1 AND "createdAt" >= now() - ($2::int * interval '1 day')`,
        [ALLY_GUIDE_AGENT_KEY, window],
      ),
      this.dataSource.query(
        `SELECT "channel",
                count(*) AS turns,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY "ttftMs") AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY "ttftMs") AS p95
           FROM "agent_turns"
          WHERE "agentKey" = $1 AND "ttftMs" IS NOT NULL
            AND "createdAt" >= now() - ($2::int * interval '1 day')
          GROUP BY "channel"`,
        [ALLY_GUIDE_AGENT_KEY, window],
      ),
      this.dataSource.query(
        `SELECT count(*) FILTER (WHERE "summary"->>'replyKind' = 'refusal') AS refusals,
                count(*) FILTER (WHERE "summary"->>'replyKind' = 'crisis') AS "crisisReplies",
                count(*) FILTER (WHERE "summary"->>'modeAfter' = 'CARE'
                                   AND COALESCE("summary"->>'modeBefore', '') <> 'CARE') AS "careEntries",
                count(*) FILTER (WHERE ("summary"->>'restarted')::boolean) AS restarts,
                COALESCE(sum(("summary"->'usage'->>'input')::bigint), 0) AS input,
                COALESCE(sum(("summary"->'usage'->>'cacheRead')::bigint), 0) AS "cacheRead",
                COALESCE(sum(("summary"->'usage'->>'output')::bigint), 0) AS output
           FROM "agent_turn_traces"
          WHERE "agentKey" = $1 AND "createdAt" >= now() - ($2::int * interval '1 day')`,
        [ALLY_GUIDE_AGENT_KEY, window],
      ),
      this.dataSource.query(
        `SELECT count(*) AS crises FROM "guide_signals"
          WHERE "kind" = $1 AND "occurredAt" >= now() - ($2::int * interval '1 day')`,
        [CRISIS_SIGNAL_KIND, window],
      ),
      this.releases.getGa(ALLY_GUIDE_AGENT_KEY),
    ]);
    const t = turns[0] ?? {};
    const tr = traces[0] ?? {};
    const input = num(tr.input);
    const cacheRead = num(tr.cacheRead);
    const total = num(t.total);
    return {
      days: window,
      turns: {
        total,
        completed: num(t.completed),
        failed: num(t.failed),
        interrupted: num(t.interrupted),
        successRate: total ? num(t.completed) / total : null,
      },
      threads: num(t.threads),
      timeToFirstTokenMs: byChannel.map((row: any) => ({
        channel: row.channel,
        turns: num(row.turns),
        p50: row.p50 === null ? null : Math.round(Number(row.p50)),
        p95: row.p95 === null ? null : Math.round(Number(row.p95)),
      })),
      safety: {
        crises: num(crises[0]?.crises),
        crisisReplies: num(tr.crisisReplies),
        careEntries: num(tr.careEntries),
        refusals: num(tr.refusals),
        restarts: num(tr.restarts),
      },
      cache: {
        readTokens: cacheRead,
        uncachedInputTokens: input,
        ratio: input + cacheRead ? cacheRead / (input + cacheRead) : null,
      },
      cost: {
        totalUsd: Number(num(t.cost).toFixed(4)),
        perThreadUsd: num(t.threads)
          ? Number((num(t.cost) / num(t.threads)).toFixed(4))
          : null,
      },
      release: ga
        ? { id: ga.id, version: ga.version, promotedAt: ga.promotedAt }
        : null,
    };
  }

  /** Conversations tab: threads, newest activity first. No content. */
  async listThreads(query: {
    limit?: number;
    before?: string;
    tenantId?: string;
    mode?: string;
  }) {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const params: unknown[] = [limit];
    const where: string[] = [];
    if (query.before) {
      params.push(new Date(query.before));
      where.push(`th."updatedAt" < $${params.length}`);
    }
    if (query.tenantId) {
      params.push(query.tenantId);
      where.push(`th."tenant_id" = $${params.length}`);
    }
    if (query.mode) {
      params.push(query.mode);
      where.push(`th."mode" = $${params.length}`);
    }
    const rows = await this.dataSource.query(
      `SELECT th."id", th."trackId", t."title" AS "trackTitle", th."tenant_id" AS "tenantId",
              th."mode", th."status", th."epoch", th."updatedAt",
              (SELECT count(*) FROM "agent_turns" a WHERE a."threadId" = th."id") AS turns,
              (SELECT COALESCE(sum(a."costUsd"), 0) FROM "agent_turns" a WHERE a."threadId" = th."id") AS cost,
              (SELECT count(*) FROM "guide_signals" s WHERE s."threadId" = th."id" AND s."kind" = '${CRISIS_SIGNAL_KIND}') AS crises
         FROM "guide_threads" th
         LEFT JOIN "tracks" t ON t."id" = th."trackId"
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY th."updatedAt" DESC
        LIMIT $1`,
      params,
    );
    return rows.map((row: any) => ({
      id: row.id,
      trackId: row.trackId,
      trackTitle: row.trackTitle,
      tenantId: row.tenantId,
      mode: row.mode,
      status: row.status,
      epoch: row.epoch,
      updatedAt: row.updatedAt,
      turns: num(row.turns),
      costUsd: Number(num(row.cost).toFixed(4)),
      crises: num(row.crises),
    }));
  }

  /** A redacted transcript (transcripts permission only). */
  async transcript(threadId: string) {
    const rows = await this.messages.find({
      where: {
        threadId,
        role: In([GuideMessageRole.LEARNER, GuideMessageRole.ALLY]),
      },
      order: { seq: 'ASC' },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      role: row.role,
      kind: row.kind,
      turnId: row.turnId ?? null,
      text: reviewableText(row),
      flags: row.flags ?? null,
      createdAt: (row as any).createdAt ?? null,
    }));
  }

  async orgProfile(tenantId: string) {
    const row = await this.orgProfiles.findOne({ where: { tenantId } });
    return {
      tenantId,
      version: row?.version ?? 0,
      profile: row?.profile ?? {},
      updatedBy: row?.updatedBy ?? null,
      updatedAt: (row as any)?.updatedAt ?? null,
    };
  }

  async saveOrgProfile(tenantId: string, input: unknown, userId: number) {
    const profile = normaliseOrgProfile(input);
    const existing = await this.orgProfiles.findOne({ where: { tenantId } });
    const saved = await this.orgProfiles.save({
      ...(existing ? { id: existing.id } : {}),
      tenantId,
      profile,
      version: (existing?.version ?? 0) + 1,
      updatedBy: userId,
    });
    return this.orgProfile(saved.tenantId);
  }

  listCrisisResponses(tenantId: string | null) {
    return this.crisisResponses.find({
      where: {
        active: true,
        ...(tenantId
          ? { scope: GuideCrisisScope.TENANT, tenantId }
          : { scope: GuideCrisisScope.PLATFORM, tenantId: IsNull() }),
      },
      order: { languageCode: 'ASC' },
    });
  }

  /**
   * A new version of the fixed crisis copy for one language. The previous
   * version is kept, inactive, so what learners were shown stays auditable.
   */
  async saveCrisisResponse(input: {
    tenantId: string | null;
    languageCode: string;
    body: string;
    userId: number;
  }) {
    if (!(GUIDE_LANGUAGES as readonly string[]).includes(input.languageCode)) {
      throw new BadRequestException(
        `languageCode must be one of ${GUIDE_LANGUAGES.join(', ')}`,
      );
    }
    const body = input.body.trim();
    if (body.length < 40 || body.length > 1500) {
      throw new BadRequestException(
        'Crisis copy must be between 40 and 1,500 characters.',
      );
    }
    const scope = input.tenantId
      ? GuideCrisisScope.TENANT
      : GuideCrisisScope.PLATFORM;
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GuideCrisisResponse);
      const current = await repo.findOne({
        where: {
          scope,
          languageCode: input.languageCode,
          active: true,
          tenantId: input.tenantId ?? IsNull(),
        },
      });
      if (current) await repo.update(current.id, { active: false });
      return repo.save(
        repo.create({
          scope,
          tenantId: input.tenantId,
          languageCode: input.languageCode,
          body,
          version: (current?.version ?? 0) + 1,
          active: true,
          approvedBy: input.userId,
          approvedAt: new Date(),
        }),
      );
    });
  }

  async removeCrisisResponse(id: string) {
    const row = await this.crisisResponses.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Crisis copy not found');
    await this.crisisResponses.update(id, { active: false });
    return { id, active: false };
  }
}

const str = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** Accept only the profile's known fields, trimmed and bounded. */
export function normaliseOrgProfile(input: unknown): GuideOrgProfileValue {
  if (!input || typeof input !== 'object') {
    throw new BadRequestException('profile must be an object');
  }
  const raw = input as Record<string, unknown>;
  const supportLines: Record<string, GuideSupportLine[]> = {};
  const lines = raw.supportLines;
  if (lines && typeof lines === 'object') {
    for (const [language, list] of Object.entries(
      lines as Record<string, unknown>,
    )) {
      if (!(GUIDE_LANGUAGES as readonly string[]).includes(language)) {
        throw new BadRequestException(
          `Unknown support-line language "${language}"`,
        );
      }
      if (!Array.isArray(list)) continue;
      supportLines[language] = list.slice(0, 10).map((line, i) => {
        const name = str(line?.name, 120);
        const phone = str(line?.phone, 40);
        if (!name || !phone) {
          throw new BadRequestException(
            `Support line ${i + 1} (${language}) needs a name and a phone number`,
          );
        }
        if (!/^[+\d][\d\s().-]{2,}$/.test(phone)) {
          throw new BadRequestException(`"${phone}" is not a phone number`);
        }
        return {
          name,
          phone,
          hours: str(line?.hours, 80),
          url: str(line?.url, 300),
          isCrisis: Boolean(line?.isCrisis),
        };
      });
    }
  }
  return {
    supportLines,
    supervisorContact: str(raw.supervisorContact, 200),
    supervisorWording: str(raw.supervisorWording, 400),
    protocols: str(raw.protocols, 4000),
    toneNotes: str(raw.toneNotes, 1000),
    avoidTopics: Array.isArray(raw.avoidTopics)
      ? raw.avoidTopics
          .map((topic) => str(topic, 80))
          .filter((topic): topic is string => Boolean(topic))
          .slice(0, 20)
      : [],
    outreachEnabled: raw.outreachEnabled !== false,
    emailEnabled: raw.emailEnabled !== false,
  };
}
