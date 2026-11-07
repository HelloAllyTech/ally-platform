import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { In, IsNull, MoreThan, Not } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { loadPromptTemplate } from 'src/common/util/prompt-template.util';
import {
  BUILDER_RULE_DRAFT_SYSTEM,
  BUILDER_RULE_MATCH_SYSTEM,
  renderPrompt,
} from 'src/prompt/contracts';
import {
  BUILDER_RULE_AREAS,
  BuilderRule,
  BuilderRuleEffect,
  BuilderRuleMatch,
} from '../entity/builder-rule.entity';
import { BuilderHistoryEntry } from '../entity/builder-history.entity';
import { BuilderHistoryRepository } from './builder-history.service';
import { BuilderRuleRepository } from './builder-rule-context.service';
import { BuilderDecisionService } from './builder-decision.service';
import { BuilderSettingsService } from './builder-settings.service';
import { BuilderLiveService } from './builder-live.service';
import { autonomyLevelOf } from '../util/builder-autonomy.util';
import { parseJsonObject } from '../util/builder-json.util';
import { BUILDER_AI_TASKS } from '../constants/builder.constants';
import { BuilderDecision } from '../type/builder-decision.type';

/**
 * Decision kinds a rule may decide. Never interview questions about *what* to
 * build — that stays a person's — and a merge rule is the existing
 * auto-merge switch, not a second merge path.
 */
const DECIDE_KINDS = new Set(['budget', 'pr_needs_human', 'build_failed']);
const MERGE_KIND = 'pr_merge';

const PREVIEW_DAYS = 90;
const PREVIEW_MAX = 60;
const PREVIEW_CACHE_SECONDS = 10 * 60;
const RULE_TICK_MS = 60_000;
const RULE_TICK_LOCK = 'builder-rules-tick';

/** "Shall I…?" proposals: this many agreements in a row, and none rejected recently. */
export const BUILDER_PROPOSAL_STREAK = 10;
const PROPOSAL_DISMISS_SECONDS = 30 * 24 * 60 * 60;

export interface BuilderRuleItem {
  id: string;
  statement: string;
  scope: string;
  area: string;
  effect: BuilderRuleEffect;
  match: BuilderRuleMatch | null;
  active: boolean;
  supersedesId: string | null;
  appliedCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
}

export interface BuilderRuleDraft {
  statement: string;
  area: string;
  scope: string;
  /** Whether "Decide for me" may be offered for this answer's decision kind. */
  decideAllowed: boolean;
  match: BuilderRuleMatch | null;
  source: { historyId: string; prompt: string; chosen: string | null } | null;
}

export interface BuilderRulePreviewItem {
  historyId: string;
  sessionTitle: string | null;
  prompt: string;
  chosen: string | null;
  decidedAt: string;
  agrees: boolean;
}

export interface BuilderRulePreview {
  considered: number;
  matches: BuilderRulePreviewItem[];
  conflicts: { id: string; statement: string; area: string }[];
}

export interface BuilderRuleProposal {
  key: string;
  kind: string;
  questionType: string | null;
  optionId: string;
  optionLabel: string;
  streak: number;
  prompt: string;
}

/**
 * Rules: authored by the person, drafted and previewed by Builder, applied by
 * the interview, every run, and — for `decide` rules — a tick that answers
 * matching decisions itself.
 */
@Injectable()
export class BuilderRulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(BuilderRulesService.name);
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: BuilderRuleRepository,
    private readonly historyRepository: BuilderHistoryRepository,
    private readonly llmCompletion: LlmCompletionService,
    private readonly prompts: PromptSharedService,
    private readonly redisService: RedisService,
    private readonly settingsService: BuilderSettingsService,
    private readonly decisionService: BuilderDecisionService,
    @Optional() private readonly liveService?: BuilderLiveService,
  ) {}

  onModuleInit(): void {
    this.tickTimer = setInterval(() => {
      void this.applyDecideRules();
    }, RULE_TICK_MS);
    this.tickTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  /* ── Reading ───────────────────────────────────────────────────────────── */

  async list(): Promise<BuilderRuleItem[]> {
    const rules = await this.repository.find({ order: { createdAt: 'ASC' } });
    // Superseded wording is History's; the page shows the rule as it stands.
    const superseded = new Set(
      rules.map((rule) => rule.supersedesId).filter(Boolean),
    );
    const visible = rules.filter((rule) => !superseded.has(rule.id));
    const usage = await this.usage(visible.map((rule) => rule.id));
    return visible.map((rule) => toItem(rule, usage.get(rule.id)));
  }

  /* ── Drafting and preview ──────────────────────────────────────────────── */

  /** Builder's general version of one answer, for the person to edit. */
  async draft(historyId: string): Promise<BuilderRuleDraft> {
    const row = await this.historyRepository.findOne({
      where: { id: historyId },
    });
    if (!row) throw new NotFoundException('That answer is not in History.');
    const chosen = row.chosenLabel ?? row.customText ?? null;
    const match = matchFromHistory(row);
    const decideAllowed =
      !!match && (DECIDE_KINDS.has(match.kind) || match.kind === MERGE_KIND);

    let statement = '';
    let area = 'Everywhere';
    try {
      const template = await loadPromptTemplate(
        this.prompts,
        BUILDER_RULE_DRAFT_SYSTEM.code,
      );
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.RULE_DRAFT,
        task: LlmTask.BUILDER_RULE_DRAFT,
        promptCode: BUILDER_RULE_DRAFT_SYSTEM.code,
        system: renderPrompt(BUILDER_RULE_DRAFT_SYSTEM, template, {}),
        prompt: [
          `Session: ${row.sessionTitle ?? '(none)'}`,
          `Builder asked: ${row.prompt}`,
          `The admin chose: ${chosen ?? '(nothing)'}`,
        ].join('\n'),
        maxTokens: 300,
        usageMetadata: { historyId },
      });
      const parsed = parseJsonObject<{ statement?: string; area?: string }>(
        result.text,
      );
      statement = String(parsed?.statement ?? '').trim();
      area = normaliseArea(parsed?.area);
    } catch (error) {
      this.logger.warn(
        `Rule draft failed for ${historyId}, falling back to the answer itself: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!statement) {
      statement = chosen ? `${row.prompt} → ${chosen}` : row.prompt;
    }
    return {
      statement: statement.slice(0, 400),
      area,
      scope: area === 'Everywhere' ? 'everywhere' : `area:${area}`,
      decideAllowed,
      match,
      source: { historyId, prompt: row.prompt, chosen },
    };
  }

  /**
   * What a rule would have answered in the last 90 days, whether it agrees
   * with what was chosen, and which active rules it contradicts. Showing
   * impact before saving is the guard against a careless rule.
   */
  async preview(input: {
    statement: string;
    scope: string;
    excludeRuleId?: string | null;
  }): Promise<BuilderRulePreview> {
    const statement = String(input.statement ?? '').trim();
    if (statement.length < 8) {
      throw new BadRequestException('Write the rule as a sentence first.');
    }
    const scope = normaliseScope(input.scope);
    const since = new Date(Date.now() - PREVIEW_DAYS * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = {
      entryType: 'decision',
      undoneAt: IsNull(),
      decidedAt: MoreThan(since),
    };
    if (scope.startsWith('session:')) where.sessionId = scope.slice(8);
    const candidates = await this.historyRepository.find({
      where,
      order: { decidedAt: 'DESC' },
      take: PREVIEW_MAX,
    });
    const existing = (
      await this.repository.find({ where: { active: true } })
    ).filter(
      (rule) =>
        rule.id !== input.excludeRuleId &&
        (rule.scope === scope ||
          rule.scope === 'everywhere' ||
          scope === 'everywhere'),
    );
    if (!candidates.length && !existing.length) {
      return { considered: 0, matches: [], conflicts: [] };
    }

    const cacheKey = `builder-rule-preview:${createHash('sha1')
      .update(
        `${statement}|${scope}|${candidates[0]?.id ?? ''}|${existing
          .map((rule) => rule.id)
          .join(',')}`,
      )
      .digest('hex')}`;
    const cached = await this.redisService.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BuilderRulePreview;
      } catch {
        // fall through and recompute
      }
    }

    let parsed: {
      matches?: { n: number; agrees: boolean }[];
      conflicts?: number[];
    } | null = null;
    try {
      const template = await loadPromptTemplate(
        this.prompts,
        BUILDER_RULE_MATCH_SYSTEM.code,
      );
      const result = await this.llmCompletion.complete({
        taskId: BUILDER_AI_TASKS.RULE_MATCH,
        task: LlmTask.BUILDER_RULE_MATCH,
        promptCode: BUILDER_RULE_MATCH_SYSTEM.code,
        system: renderPrompt(BUILDER_RULE_MATCH_SYSTEM, template, {}),
        prompt: [
          `## Proposed rule\n${statement}`,
          '## Earlier decisions',
          candidates.length
            ? candidates
                .map(
                  (row, index) =>
                    `${index + 1}. Asked: ${clip(row.prompt, 240)} | Chose: ${clip(
                      row.chosenLabel ?? row.customText ?? '(nothing)',
                      120,
                    )}`,
                )
                .join('\n')
            : '(none)',
          '## Existing rules (list the numbers of any the proposed rule contradicts under "conflicts")',
          existing.length
            ? existing
                .map((rule, index) => `${index + 1}. ${rule.statement}`)
                .join('\n')
            : '(none)',
        ].join('\n\n'),
        maxTokens: 800,
        usageMetadata: { candidates: candidates.length },
      });
      parsed = parseJsonObject(result.text);
    } catch (error) {
      this.logger.warn(
        `Rule preview failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        "Builder couldn't check this rule against earlier decisions just now. Try again in a moment.",
      );
    }

    const preview: BuilderRulePreview = {
      considered: candidates.length,
      matches: (parsed?.matches ?? [])
        .filter(
          (match) =>
            Number.isInteger(match?.n) &&
            match.n >= 1 &&
            match.n <= candidates.length,
        )
        .map((match) => {
          const row = candidates[match.n - 1];
          return {
            historyId: row.id,
            sessionTitle: row.sessionTitle ?? null,
            prompt: row.prompt,
            chosen: row.chosenLabel ?? row.customText ?? null,
            decidedAt: new Date(row.decidedAt).toISOString(),
            agrees: match.agrees !== false,
          };
        }),
      conflicts: (parsed?.conflicts ?? [])
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= existing.length)
        .map((n) => existing[n - 1])
        .map((rule) => ({
          id: rule.id,
          statement: rule.statement,
          area: rule.area,
        })),
    };
    await this.redisService
      .set(cacheKey, JSON.stringify(preview), PREVIEW_CACHE_SECONDS)
      .catch(() => undefined);
    return preview;
  }

  /* ── Writing ───────────────────────────────────────────────────────────── */

  /**
   * Save a rule. `supersedes` switches off the rules it replaces — an edit
   * (one id), or the loser of a conflict the person resolved in the editor.
   */
  async create(
    input: {
      statement: string;
      scope: string;
      effect?: BuilderRuleEffect;
      match?: BuilderRuleMatch | null;
      sourceHistoryId?: string | null;
      supersedes?: string[];
    },
    userId: number,
  ): Promise<BuilderRuleItem> {
    const statement = String(input.statement ?? '').trim();
    if (statement.length < 8) {
      throw new BadRequestException('Write the rule as a sentence.');
    }
    const scope = normaliseScope(input.scope);
    const effect: BuilderRuleEffect =
      input.effect === 'decide' ? 'decide' : 'guide';
    if (effect === 'decide') {
      const kind = input.match?.kind;
      if (!input.match?.optionId || !kind) {
        throw new BadRequestException(
          'A "Decide for me" rule needs the decision it answers.',
        );
      }
      if (kind !== MERGE_KIND && !DECIDE_KINDS.has(kind)) {
        throw new BadRequestException(
          'Builder only decides budget, stuck pull request and failed build decisions for you. Questions about what to build stay yours.',
        );
      }
    }

    const saved = await this.repository.save(
      this.repository.create({
        statement: statement.slice(0, 1000),
        scope,
        area: areaOfScope(scope),
        effect,
        match: effect === 'decide' ? input.match : (input.match ?? null),
        sourceHistoryId: input.sourceHistoryId ?? null,
        supersedesId: input.supersedes?.[0] ?? null,
        active: true,
        createdBy: userId,
      }),
    );
    if (input.supersedes?.length) {
      await this.repository.update(
        { id: In(input.supersedes) },
        { active: false, updatedBy: userId },
      );
    }
    // A merge rule is the existing switch, not a second merge path.
    if (effect === 'decide' && input.match?.kind === MERGE_KIND) {
      await this.settingsService.update({ autoMergeEnabled: true }, userId);
    }
    this.liveService?.changed('decisionsChanged');
    return toItem(saved, undefined);
  }

  async setActive(
    id: string,
    active: boolean,
    userId: number,
  ): Promise<BuilderRuleItem> {
    const rule = await this.repository.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('No such rule.');
    await this.repository.update({ id }, { active, updatedBy: userId });
    if (
      !active &&
      rule.effect === 'decide' &&
      rule.match?.kind === MERGE_KIND
    ) {
      // Turning the merge rule off turns the switch it set off with it.
      await this.settingsService.update({ autoMergeEnabled: false }, userId);
    }
    const usage = await this.usage([id]);
    return toItem({ ...rule, active }, usage.get(id));
  }

  /* ── Decide for me ─────────────────────────────────────────────────────── */

  /**
   * Answer pending decisions that an active `decide` rule covers. Off while
   * the autonomy level is `off` or `assist`: the coarse slider always wins.
   * One instance at a time, under a lock.
   */
  async applyDecideRules(): Promise<number> {
    if (!(await this.redisService.acquireLock(RULE_TICK_LOCK, 50))) return 0;
    try {
      const settings = await this.settingsService.get();
      const level = autonomyLevelOf(settings);
      if (level === 'off' || level === 'assist') return 0;
      const rules = (
        await this.repository.find({
          where: { active: true, effect: 'decide' },
        })
      ).filter((rule) => rule.match && rule.match.kind !== MERGE_KIND);
      if (!rules.length) return 0;
      const pending = await this.decisionService.listPending();
      let answered = 0;
      for (const decision of pending) {
        const rule = rules.find((candidate) =>
          ruleMatchesDecision(candidate, decision),
        );
        if (!rule) continue;
        try {
          await this.decisionService.answer(
            decision.id,
            { selectedOptionIds: [rule.match!.optionId] },
            rule.createdBy,
            { surface: 'rule', ruleId: rule.id },
          );
          answered++;
        } catch (error) {
          this.logger.warn(
            `Rule ${rule.id} could not decide ${decision.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return answered;
    } catch (error) {
      this.logger.warn(
        `Builder rule tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      await this.redisService
        .releaseLock(RULE_TICK_LOCK)
        .catch(() => undefined);
    }
  }

  /**
   * "Shall I decide this for you?" — offered, never assumed. A (kind,
   * questionType) pair qualifies when the last ten human answers all took the
   * recommendation and all chose the same option, it is a kind a rule may
   * decide, no rule already covers it, and the person has not said "not yet"
   * in the last 30 days.
   */
  async proposals(): Promise<BuilderRuleProposal[]> {
    const rows = await this.historyRepository.find({
      where: {
        entryType: 'decision',
        undoneAt: IsNull(),
        surface: Not('rule'),
      },
      order: { decidedAt: 'DESC' },
      take: 500,
    });
    const rules = await this.repository.find({ where: { active: true } });
    const byKey = new Map<string, BuilderHistoryEntry[]>();
    for (const row of rows) {
      if (
        !row.kind ||
        !(DECIDE_KINDS.has(row.kind) || row.kind === MERGE_KIND)
      ) {
        continue;
      }
      const key = `${row.kind}:${row.questionType ?? ''}`;
      const list = byKey.get(key) ?? [];
      if (list.length < BUILDER_PROPOSAL_STREAK) list.push(row);
      byKey.set(key, list);
    }

    const out: BuilderRuleProposal[] = [];
    for (const [key, list] of byKey) {
      if (list.length < BUILDER_PROPOSAL_STREAK) continue;
      const option = list[0].chosenOptionIds?.[0];
      const agreed = list.every(
        (row) =>
          row.chosenOptionIds?.length === 1 &&
          row.chosenOptionIds[0] === option &&
          (row.matchedRecommendation === true ||
            // a one-option kind (merge) has no recommendation to agree with
            row.matchedRecommendation === null),
      );
      if (!agreed || !option) continue;
      const [kind, questionType] = key.split(':');
      const covered = rules.some(
        (rule) =>
          rule.effect === 'decide' &&
          rule.match?.kind === kind &&
          (rule.match?.questionType ?? '') === questionType,
      );
      if (covered) continue;
      if (await this.redisService.get(`builder-proposal-dismissed:${key}`)) {
        continue;
      }
      out.push({
        key,
        kind,
        questionType: questionType || null,
        optionId: option,
        optionLabel: list[0].chosenLabel ?? option,
        streak: list.length,
        prompt: list[0].prompt,
      });
    }
    return out;
  }

  async dismissProposal(key: string): Promise<{ ok: true }> {
    await this.redisService.set(
      `builder-proposal-dismissed:${key}`,
      '1',
      PROPOSAL_DISMISS_SECONDS,
    );
    return { ok: true };
  }

  private async usage(
    ruleIds: string[],
  ): Promise<Map<string, { count: number; last: Date | null }>> {
    if (!ruleIds.length) return new Map();
    const rows: { ruleId: string; count: string; last: Date | null }[] =
      await this.historyRepository
        .createQueryBuilder('h')
        .select('h.ruleId', 'ruleId')
        .addSelect('COUNT(*)', 'count')
        .addSelect('MAX(h.decidedAt)', 'last')
        .where('h.ruleId IN (:...ids)', { ids: ruleIds })
        .andWhere('h.undoneAt IS NULL')
        .groupBy('h.ruleId')
        .getRawMany();
    return new Map(
      rows.map((row) => [
        row.ruleId,
        {
          count: Number(row.count),
          last: row.last ? new Date(row.last) : null,
        },
      ]),
    );
  }
}

export const ruleMatchesDecision = (
  rule: Pick<BuilderRule, 'match' | 'scope'>,
  decision: Pick<
    BuilderDecision,
    'kind' | 'questionType' | 'sessionId' | 'options'
  >,
): boolean => {
  const match = rule.match;
  if (!match || match.kind !== decision.kind) return false;
  if (match.questionType && match.questionType !== decision.questionType) {
    return false;
  }
  if (
    rule.scope.startsWith('session:') &&
    rule.scope.slice(8) !== decision.sessionId
  ) {
    return false;
  }
  // Never pick an option the card does not offer, and never a one-way one
  // the person has not explicitly made a merge rule for.
  const option = decision.options.find((entry) => entry.id === match.optionId);
  return !!option && !(option.oneWay || option.confirm);
};

const matchFromHistory = (row: BuilderHistoryEntry): BuilderRuleMatch | null =>
  row.kind && row.chosenOptionIds?.length === 1
    ? {
        kind: row.kind,
        questionType: row.questionType ?? null,
        optionId: row.chosenOptionIds[0],
      }
    : null;

const normaliseArea = (value: unknown): string => {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return (
    BUILDER_RULE_AREAS.find((area) => area.toLowerCase() === text) ??
    'Everywhere'
  );
};

/** `everywhere`, `area:<known area>`, `session:<id>` or `opportunity:<id>`; anything else is everywhere. */
export const normaliseScope = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (text.startsWith('area:')) {
    const area = normaliseArea(text.slice(5));
    return area === 'Everywhere' ? 'everywhere' : `area:${area}`;
  }
  if (/^(session|opportunity):[0-9a-f-]{36}$/i.test(text)) return text;
  return 'everywhere';
};

const areaOfScope = (scope: string): string => {
  if (scope.startsWith('area:')) return scope.slice(5);
  if (scope.startsWith('session:')) return 'This session';
  if (scope.startsWith('opportunity:')) return 'This opportunity';
  return 'Everywhere';
};

const clip = (text: string, max: number): string => {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const toItem = (
  rule: BuilderRule,
  usage: { count: number; last: Date | null } | undefined,
): BuilderRuleItem => ({
  id: rule.id,
  statement: rule.statement,
  scope: rule.scope,
  area: rule.area,
  effect: rule.effect,
  match: rule.match ?? null,
  active: rule.active,
  supersedesId: rule.supersedesId ?? null,
  appliedCount: usage?.count ?? 0,
  lastAppliedAt: usage?.last ? usage.last.toISOString() : null,
  createdAt: new Date(rule.createdAt ?? Date.now()).toISOString(),
});
