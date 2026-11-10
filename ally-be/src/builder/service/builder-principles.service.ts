import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClUseCase } from 'src/context-library/enum/context-library.enum';
import { ContextBriefService } from 'src/context-library/service/context-brief.service';
import { ContextRetrievalService } from 'src/context-library/service/context-retrieval.service';
import {
  BUILDER_BRIEF_AREAS,
  BUILDER_PRINCIPLES_BRIEF_CARDS,
} from '../constants/builder-principles.constants';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdReadiness } from '../type/builder-prd.type';

/** What a session keeps about its principles, in `builder_sessions.metadata.principles`. */
export interface BuilderSessionPrinciples {
  /** The admin switched principles off for this session. */
  off?: boolean;
  descriptor?: string;
  block?: string;
  codes?: string[];
  builtAt?: string;
}

const SECTION_FOCUS_TIMEOUT_MS = 3000;

/**
 * Proactive principles for the Builder interview (the owner's decision: on from day one,
 * switchable per session).
 *
 * - **Guiding brief:** at session start a query planner turns the idea into a short context
 *   descriptor and situational searches; the best ~15 principles, grouped by PRD area, become a
 *   cached system block. Built in the background so it never delays the first token, and joins
 *   from the turn after it lands.
 * - **Section focus:** each turn, a couple of searches for the first PRD section that is not
 *   ready yet, after the cache breakpoint, skipping what the brief already holds.
 * - **PRD check:** the review pass receives the principles relevant to the draft, with their
 *   warning signs, and is asked which ones the draft breaks or ignores.
 *
 * Every failure here is soft: the interview is worth more than its guidance.
 */
@Injectable()
export class BuilderPrinciplesService {
  private readonly logger = LoggerService.getInstance(
    BuilderPrinciplesService.name,
  );
  private readonly building = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly brief?: ContextBriefService,
    @Optional() private readonly retrieval?: ContextRetrievalService,
  ) {}

  state(session: BuilderSession): BuilderSessionPrinciples {
    return ((session.metadata as any)?.principles ??
      {}) as BuilderSessionPrinciples;
  }

  isOn(session: BuilderSession): boolean {
    if (!this.brief || !this.retrieval) return false;
    if (process.env.BUILDER_PRINCIPLES_PROACTIVE === 'off') return false;
    return !this.state(session).off;
  }

  /** Merge into `metadata.principles` without clobbering other metadata writers. */
  private async save(
    sessionId: string,
    patch: BuilderSessionPrinciples,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE "builder_sessions"
         SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{principles}',
               COALESCE("metadata"->'principles', '{}'::jsonb) || $2::jsonb)
       WHERE "id" = $1`,
      [sessionId, JSON.stringify(patch)],
    );
  }

  async setOff(sessionId: string, off: boolean): Promise<void> {
    await this.save(sessionId, { off });
  }

  /**
   * Start building the guiding brief if this session has none. Returns immediately; the
   * brief lands in session metadata when ready.
   */
  ensureBrief(session: BuilderSession, idea: string): void {
    if (
      !this.isOn(session) ||
      this.state(session).block ||
      this.building.has(session.id)
    )
      return;
    const request = [session.title, idea]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000);
    if (!request.trim()) return;
    this.building.add(session.id);
    this.brief!.build({
      useCase: ClUseCase.BUILDER_BRIEF,
      request,
      areas: BUILDER_BRIEF_AREAS,
      sessionId: session.id,
      maxCards: BUILDER_PRINCIPLES_BRIEF_CARDS,
    })
      .then(async (brief) => {
        if (!brief) return;
        await this.save(session.id, {
          descriptor: brief.descriptor,
          block: brief.block,
          codes: brief.codes,
          builtAt: new Date().toISOString(),
        });
      })
      .catch((error) =>
        this.logger.warn(
          `Guiding brief failed for ${session.id}: ${(error as Error).message}`,
        ),
      )
      .finally(() => this.building.delete(session.id));
  }

  /** The cached brief block, once built. Frozen for the session so the prompt cache holds. */
  briefBlock(session: BuilderSession): string | null {
    if (!this.isOn(session)) return null;
    return this.state(session).block ?? null;
  }

  /**
   * A small, uncached block of principles for the first PRD section that is not ready yet.
   * Bounded by a timeout so it never holds a turn up.
   */
  async sectionFocusBlock(
    session: BuilderSession,
    readiness: BuilderPrdReadiness | null,
    turnIndex?: number,
  ): Promise<string | null> {
    if (!this.isOn(session) || !readiness) return null;
    const focus = readiness.sections.find(
      (s) => !s.ok && s.key !== 'prdReview',
    );
    if (!focus) return null;
    const state = this.state(session);
    const search = this.retrieval!.search({
      useCase: ClUseCase.BUILDER_INTERVIEW,
      queries: [focus.label, focus.hint].filter(Boolean),
      sessionId: session.id,
      turnIndex,
      queryOrigin: 'section_focus',
      contextDescriptor: state.descriptor ?? null,
      excludeCodes: state.codes ?? [],
      limit: 3,
    });
    try {
      const response = await Promise.race([
        search,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SECTION_FOCUS_TIMEOUT_MS),
        ),
      ]);
      if (!response || response.noConfidentMatch || !response.results.length)
        return null;
      return [
        `<principles_for_this_section section="${focus.label}">`,
        'Advisory. If one of these is unaddressed, turn it into your next question in your own words (at most one principle-led question this turn); cite its code as [CODE] in the PRD only where it changed a decision.',
        ...response.results.map((r) => r.card),
        '</principles_for_this_section>',
      ].join('\n');
    } catch (error) {
      this.logger.warn(`Section focus skipped: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Principles relevant to a draft, with their warning signs, for the PRD review pass. Queries
   * come from the draft's own sections, so the check is about what this PRD actually says.
   */
  async prdCheckBlock(
    sessionId: string,
    draft: Record<string, any> | null | undefined,
  ): Promise<string | null> {
    if (!this.retrieval || process.env.BUILDER_PRINCIPLES_PROACTIVE === 'off')
      return null;
    const queries = Object.entries(draft ?? {})
      .filter(([, v]) => typeof v === 'string' && v.trim().length > 40)
      .map(([, v]) => String(v).replace(/\s+/g, ' ').slice(0, 200))
      .slice(0, 6);
    if (!queries.length) return null;
    try {
      const response = await this.retrieval.search({
        useCase: ClUseCase.BUILDER_PRD_REVIEW,
        queries,
        sessionId,
        queryOrigin: 'prd_review',
        limit: 10,
      });
      if (response.noConfidentMatch || !response.results.length) return null;
      return response.results
        .map((r) => {
          const warning = String(r.chunk.attributes?.antiPattern ?? '').trim();
          return `- [${r.chunk.code}] ${r.chunk.statement}${warning ? ` — warning sign: ${warning}` : ''}`;
        })
        .join('\n');
    } catch (error) {
      this.logger.warn(
        `PRD principle check skipped: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
