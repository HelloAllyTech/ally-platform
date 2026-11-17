import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PlanEventKind } from '../enum/product-planning.enum';
import { PlanEventService } from './plan-event.service';
import { PlanSettingsService } from './plan-settings.service';
import { PlanSpendService } from './plan-spend.service';
import { RoadmapRoleService } from './roadmap-role.service';

/**
 * Where a plan's money is about to be spent (plans/roadmap-builder-merge
 * §5.6). Named so a refusal says which door it closed, and so the PR body can
 * list them.
 */
export type PlanSpendPoint =
  | 'copilot_turn'
  | 'interviewer_turn'
  | 'specialist'
  | 'design_run'
  | 'build_dispatch'
  | 'pr_automation'
  | 'phase_boundary';

export interface PlanCeilingState {
  sessionId: string;
  /** Model calls in the plan ledger plus Builder runner spend on the session. */
  spentUsd: number;
  ledgerUsd: number;
  runnerUsd: number;
  ceilingUsd: number;
  /** True when this plan has its own raised ceiling. */
  raised: boolean;
  exceeded: boolean;
  /** Some ledger rows were unpriced; the spend is a floor. */
  approximate: boolean;
}

interface SessionRow {
  kind: string;
  leadUserId: number | null;
  ceilingUsd: string | null;
  totalCostUsd: string | null;
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/** The one refusal every spend point raises, so the client can show "Paused at $100". */
export class PlanCeilingReachedException extends ConflictException {
  constructor(point: PlanSpendPoint, state: PlanCeilingState) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: 'plan_ceiling_reached',
      point,
      spentUsd: round(state.spentUsd),
      ceilingUsd: round(state.ceilingUsd),
      message:
        `This idea has spent $${state.spentUsd.toFixed(2)} of its ` +
        `$${state.ceilingUsd.toFixed(2)} ceiling. Its lead can raise the ceiling to continue.`,
    });
  }
}

/**
 * One ceiling per idea, enforced at every spend point (§5.6, rev 5.2's $100
 * covering interview, design and build). Rev 5.2 checked it only on idea
 * turns; this is the check the other doors call.
 *
 * Applies to `kind='plan'` sessions only, and only while `roadmap_v2` is on:
 * with the flag off every method here is a no-op, so no turn, run or review
 * that runs today can be refused by it. A Builder session that is not a plan
 * keeps its own `budgetUsd` exactly as before.
 *
 * Spend is the plan's ledger (copilot, interviewer, specialists, priced as
 * they happen) plus the session's runner spend (`totalCostUsd`: design and
 * build runs, priced by the runner). Nothing writes runner cost into the
 * ledger, so the two never count the same dollar.
 */
@Injectable()
export class PlanCeilingService {
  private readonly logger = LoggerService.getInstance(PlanCeilingService.name);

  constructor(
    private readonly settings: PlanSettingsService,
    private readonly spend: PlanSpendService,
    private readonly events: PlanEventService,
    private readonly roles: RoadmapRoleService,
    private readonly dataSource: DataSource,
  ) {}

  /** Pure: the ceiling that applies, a positive raised value winning over the setting. */
  static effectiveCeiling(
    raised: unknown,
    settingsCeilingUsd: number,
  ): { ceilingUsd: number; raised: boolean } {
    const value = Number(raised);
    return Number.isFinite(value) && value > 0 && raised !== null
      ? { ceilingUsd: value, raised: true }
      : { ceilingUsd: settingsCeilingUsd, raised: false };
  }

  /**
   * Whether the flag is on. A failure to read it counts as off: an
   * unreadable settings row must not start refusing turns that run today.
   */
  private async flagOn(): Promise<boolean> {
    try {
      return (await this.settings.getRoadmapV2()).enabled;
    } catch (error) {
      this.logger.warn(
        `Roadmap v2 flag unreadable, treating as off: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async session(sessionId: string): Promise<SessionRow | null> {
    const rows: SessionRow[] = await this.dataSource.query(
      `SELECT kind, "leadUserId", "plan"->>'ceilingUsd' AS "ceilingUsd", "totalCostUsd"
         FROM "builder_sessions" WHERE id = $1`,
      [sessionId],
    );
    return rows?.[0] ?? null;
  }

  /** Spend against the ceiling for a plan session; null for anything else. */
  async state(sessionId: string): Promise<PlanCeilingState | null> {
    const row = await this.session(sessionId);
    if (!row || row.kind !== 'plan') return null;
    const [settings, summary] = await Promise.all([
      this.settings.getRoadmapV2(),
      this.spend.summarize(sessionId),
    ]);
    const { ceilingUsd, raised } = PlanCeilingService.effectiveCeiling(
      row.ceilingUsd,
      settings.ceilingUsd,
    );
    const runnerUsd = Number(row.totalCostUsd ?? 0) || 0;
    const spentUsd = round(summary.totalUsd + runnerUsd);
    return {
      sessionId,
      spentUsd,
      ledgerUsd: summary.totalUsd,
      runnerUsd,
      ceilingUsd,
      raised,
      exceeded: spentUsd >= ceilingUsd,
      approximate: summary.approximate,
    };
  }

  /**
   * The check before any spend. Read before the work, never mid-call: work
   * that started under the ceiling finishes. No-op with the flag off or for a
   * session that is not a plan.
   */
  async assertWithinCeiling(
    sessionId: string | null | undefined,
    point: PlanSpendPoint,
  ): Promise<void> {
    if (!sessionId || !(await this.flagOn())) return;
    const state = await this.state(sessionId);
    if (state?.exceeded) throw new PlanCeilingReachedException(point, state);
  }

  /**
   * The same check where refusing is not possible (the runner reporting a
   * finished phase): answers the state instead of throwing. Null with the
   * flag off or for a non-plan session. Never throws.
   */
  async checkAt(
    sessionId: string,
    point: PlanSpendPoint,
  ): Promise<PlanCeilingState | null> {
    try {
      if (!(await this.flagOn())) return null;
      const state = await this.state(sessionId);
      if (state?.exceeded) {
        this.logger.info(
          `[PLAN_CEILING] session=${sessionId} at ${point}: $${state.spentUsd} of $${state.ceilingUsd}`,
        );
      }
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Raise (or set) one plan's ceiling (§5.6). The lead may go up to the
   * Owner-set `maxLeadCeilingUsd`; an Owner may set any amount. Refused at or
   * below what is already spent, because the next turn would stop again at
   * once. Every change is a `budget_changed` plan event.
   */
  async setCeiling(
    sessionId: string,
    userId: number,
    ceilingUsd: number,
  ): Promise<PlanCeilingState> {
    const settings = await this.settings.assertRoadmapV2();
    if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) {
      throw new BadRequestException('Give the new ceiling in US dollars.');
    }
    const row = await this.session(sessionId);
    if (!row || row.kind !== 'plan') {
      throw new NotFoundException(
        'This idea has no plan yet, so it has no ceiling to raise.',
      );
    }
    const role = await this.roles.roleOf(userId);
    const isLead = row.leadUserId === userId;
    if (role !== 'owner') {
      if (role !== 'builder' || !isLead) {
        throw new ForbiddenException(
          "Only this idea's lead or an Owner can change its ceiling.",
        );
      }
      if (ceilingUsd > settings.maxLeadCeilingUsd) {
        throw new ForbiddenException(
          `A lead can raise the ceiling up to $${settings.maxLeadCeilingUsd.toFixed(2)}. ` +
            'Ask an Owner for more.',
        );
      }
    }
    const before = await this.state(sessionId);
    if (before && ceilingUsd <= before.spentUsd) {
      throw new BadRequestException(
        `This idea has already spent $${before.spentUsd.toFixed(2)}, so a ` +
          `$${ceilingUsd.toFixed(2)} ceiling would stop it again at once. ` +
          'Choose a figure above what it has spent.',
      );
    }
    await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "plan" = COALESCE("plan", '{}'::jsonb) || jsonb_build_object('ceilingUsd', $2::numeric),
              "updatedAt" = now()
        WHERE id = $1`,
      [sessionId, ceilingUsd],
    );
    await this.events.record({
      sessionId,
      kind: PlanEventKind.BUDGET_CHANGED,
      actorUserId: userId,
      detail: {
        fromUsd: before?.ceilingUsd ?? null,
        toUsd: ceilingUsd,
        by: role === 'owner' ? 'owner' : 'lead',
      },
    });
    return (await this.state(sessionId)) as PlanCeilingState;
  }
}
