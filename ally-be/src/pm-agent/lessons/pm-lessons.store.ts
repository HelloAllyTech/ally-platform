import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import { PmMemoryKind } from '../enum/pm-agent.enum';
import { PmEvidenceRef } from '../pipeline/pm-pipeline.types';
import { PmAgentCardRepository } from '../repository/pm-agent-card.repository';
import {
  PmAgentMemoryRepository,
  PmAgentSettingsRepository,
} from '../repository/pm-agent.repositories';
import { PmAgentBudgetService } from '../service/pm-agent-budget.service';
import { PmLessonDecisionRow } from './pm-lesson-data';
import { PmLessonsRunSummary, PmLessonsStore } from './pm-lessons-job';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = new Set(['improved', 'flat', 'worse']);

/**
 * The impact read-outs (+14/+30 d) are built separately and may add columns or rows to
 * `pm_agent_outcomes`; their exact shape is not this module's business. Any `*verdict*` field
 * holding improved/flat/worse (the +14 d one preferred) is taken; absent → null.
 */
export function findImpactVerdict(
  value: unknown,
): 'improved' | 'flat' | 'worse' | null {
  const found: { day14: boolean; verdict: string }[] = [];
  const visit = (obj: unknown, level: number, path: string) => {
    if (!obj || typeof obj !== 'object' || level > 3) return;
    const record = obj as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      const here = `${path}.${key}`;
      if (
        typeof item === 'string' &&
        /verdict/i.test(key) &&
        VERDICTS.has(item)
      ) {
        found.push({
          day14: /14/.test(here) || record.day === 14,
          verdict: item,
        });
      } else if (item && typeof item === 'object') {
        visit(item, level + 1, here);
      }
    }
  };
  visit(value, 0, '');
  if (!found.length) return null;
  return (found.find((f) => f.day14) ?? found[0]).verdict as
    | 'improved'
    | 'flat'
    | 'worse';
}

/** SQL side of the lessons job (PmLessonsStore). Reads only, except lesson rows and settings. */
@Injectable()
export class PmLessonsSqlStore implements PmLessonsStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: PmAgentSettingsRepository,
    private readonly memory: PmAgentMemoryRepository,
    private readonly cards: PmAgentCardRepository,
    private readonly budget: PmAgentBudgetService,
  ) {}

  getSettings(): Promise<PmAgentSettings> {
    return this.settings.getSingleton();
  }

  async decisionRows(lookbackDays: number): Promise<PmLessonDecisionRow[]> {
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT c.id AS "cardId", c.kind, c.category, c.title, c.payload, c."reasonChip",
              to_jsonb(o) AS outcome,
              (SELECT i.verdict FROM pm_agent_outcomes i
                WHERE i."cardId" = o."cardId" AND i.kind = 'impact'
                  AND i.day = 14 AND i.status = 'measured' LIMIT 1) AS "impactVerdict",
              (SELECT e.detail->>'lane' FROM pm_agent_card_events e
                WHERE e."cardId" = c.id AND e.type = 'created'
                ORDER BY e."createdAt" ASC LIMIT 1) AS lane
         FROM pm_agent_outcomes o
         JOIN pm_agent_cards c ON c.id = o."cardId"
        WHERE o.kind = 'decision'
          AND o."decidedAt" >= now() - ($1::int * interval '1 day')
          AND o.undone = false
        ORDER BY o."decidedAt" DESC
        LIMIT 2000`,
      [lookbackDays],
    );
    const byCard = new Map<string, PmLessonDecisionRow>();
    for (const row of rows) {
      const o = (row.outcome ?? {}) as Record<string, any>;
      const impact = VERDICTS.has(String(row.impactVerdict))
        ? (row.impactVerdict as 'improved' | 'flat' | 'worse')
        : findImpactVerdict(o);
      const prior = byCard.get(row.cardId);
      if (prior) {
        prior.impact = prior.impact ?? impact;
        continue;
      }
      if (!o.decision) continue;
      byCard.set(row.cardId, {
        cardId: row.cardId,
        kind: row.kind,
        category: row.category,
        lane: row.lane ?? null,
        size: typeof row.payload?.size === 'string' ? row.payload.size : null,
        risk: typeof row.payload?.risk === 'string' ? row.payload.risk : null,
        title: String(row.title ?? ''),
        decision: String(o.decision),
        reasonChip: row.reasonChip ?? o.reasonChip ?? null,
        feedbackChips: Array.isArray(o.feedbackChips) ? o.feedbackChips : [],
        decidedAt: new Date(o.decidedAt),
        merged: Boolean(o.merged),
        released: Boolean(o.released),
        buildFailed: Boolean(o.buildFailed),
        reverted: Boolean(o.reverted),
        impact,
        payload: row.payload ?? {},
      });
    }
    return [...byCard.values()];
  }

  lessons(): Promise<PmAgentMemory[]> {
    return this.memory.listAll(PmMemoryKind.LESSON);
  }

  activeFacts(): Promise<PmAgentMemory[]> {
    return this.memory.find({
      where: { kind: PmMemoryKind.FACT, active: true },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
  }

  async evidence(ids: string[]): Promise<PmEvidenceRef[]> {
    const valid = ids.filter((id) => UUID.test(id)).slice(0, 400);
    if (!valid.length) return [];
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT id, source, kind, label, "fetchedAt", snapshot
         FROM pm_agent_evidence WHERE id = ANY($1::uuid[])`,
      [valid],
    );
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      label: row.label,
      fetchedAt: new Date(row.fetchedAt),
      excerpt: JSON.stringify(row.snapshot ?? '').slice(0, 800),
    }));
  }

  async insertLesson(row: Partial<PmAgentMemory>): Promise<void> {
    await this.memory.insert(row as never);
  }

  async updateLesson(id: string, patch: Partial<PmAgentMemory>): Promise<void> {
    await this.memory.update({ id, kind: PmMemoryKind.LESSON }, patch as never);
  }

  monthCommittedUsd(now: Date): Promise<number> {
    return this.budget.committedThisMonthUsd(now);
  }

  tenantNames(): Promise<string[]> {
    return this.cards.listTenantNames();
  }

  async saveLastRun(summary: PmLessonsRunSummary): Promise<void> {
    await this.settings.update(
      { id: 1 },
      {
        lessonsLastRun: summary as unknown as Record<
          string,
          string | number | null
        >,
      },
    );
  }
}
