import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ClChunk } from 'src/context-library/entity/cl-chunk.entity';
import {
  ClCollectionId,
  ClUseCase,
} from 'src/context-library/enum/context-library.enum';
import { ContextAgentChunkService } from 'src/context-library/service/context-agent-chunk.service';
import {
  BUILDER_LESSON_SEARCH_TIMEOUT_MS,
  BUILDER_PINNED_LESSONS_MAX,
  BUILDER_RETRIEVED_LESSONS,
} from '../constants/builder.constants';
import { BuilderSession } from '../entity/builder-session.entity';

/** What a session keeps about its lessons, in `builder_sessions.metadata.lessons`. */
export interface BuilderSessionLessons {
  /** The lessons search chose for this session, frozen so the cached prefix holds. */
  codes?: string[];
  builtAt?: string;
}

/**
 * The lessons block of Builder's context: what previous builds learned, from the Context
 * Library's Builder Lessons collection (PLAN §9.1, phase 5).
 *
 * It replaced "the newest twenty lessons". Now:
 *  - **pinned lessons in scope always ride along** — a person decided they matter;
 *  - then **the lessons most relevant to this work**, found by searching Builder Lessons for the
 *    session's own words with its use case (`builder_interview`, `builder_research`), scoped to
 *    the repos in play (platform-wide lessons always qualify).
 *
 * The interview's context block is a cached prompt prefix, so a session's search runs once and
 * its choice is frozen in session metadata; later turns re-read those lessons by code. A failed
 * or slow search never holds a turn up: that turn carries the pinned lessons only, and the
 * search is tried again on the next.
 */
@Injectable()
export class BuilderLessonsService {
  private readonly logger = LoggerService.getInstance(
    BuilderLessonsService.name,
  );

  constructor(
    // Optional: without it (the replay sandbox) nothing is frozen, and nothing is written.
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly agentChunks?: ContextAgentChunkService,
  ) {}

  private state(session: BuilderSession): BuilderSessionLessons {
    return ((session.metadata as any)?.lessons ?? {}) as BuilderSessionLessons;
  }

  /** The interview's block, with the search frozen per session once it has an answer. */
  async blockForSession(
    session: BuilderSession,
    request: string,
  ): Promise<string> {
    const frozen = this.state(session).codes;
    const { block, retrieved } = await this.block({
      useCase: ClUseCase.BUILDER_INTERVIEW,
      sessionId: session.id,
      repos: session.repos ?? undefined,
      request: [session.title, request].filter(Boolean).join('\n\n'),
      frozenCodes: frozen ?? null,
    });
    if (!frozen && retrieved && this.dataSource) {
      await this.dataSource
        .query(
          `UPDATE "builder_sessions"
              SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{lessons}', $2::jsonb)
            WHERE "id" = $1`,
          [
            session.id,
            JSON.stringify({
              codes: retrieved,
              builtAt: new Date().toISOString(),
            } satisfies BuilderSessionLessons),
          ],
        )
        .catch((error: Error) =>
          this.logger.warn(
            `Could not freeze lessons for ${session.id}: ${error.message}`,
          ),
        );
    }
    return block;
  }

  /**
   * The rendered block. `retrieved` is the searched codes when the search answered (even with
   * nothing), and null when it failed or timed out — which is what tells the caller not to
   * freeze.
   */
  async block(args: {
    useCase: ClUseCase;
    sessionId?: string | null;
    repos?: string[];
    request?: string | null;
    frozenCodes?: string[] | null;
  }): Promise<{ block: string; retrieved: string[] | null }> {
    if (!this.agentChunks) return { block: '', retrieved: null };
    let pinned: ClChunk[] = [];
    try {
      pinned = await this.agentChunks.listActive({
        collection: ClCollectionId.BUILDER_LESSONS,
        repos: args.repos,
        limit: BUILDER_PINNED_LESSONS_MAX,
        pinnedOnly: true,
      });
    } catch (error) {
      this.logger.warn(`Pinned lessons skipped: ${(error as Error).message}`);
    }
    const pinnedCodes = new Set(pinned.map((c) => c.code));

    let relevant: ClChunk[] = [];
    let retrieved: string[] | null = null;
    if (args.frozenCodes) {
      relevant = (await this.agentChunks.activeByCodes(args.frozenCodes))
        .filter((c) => !pinnedCodes.has(c.code))
        .slice(0, BUILDER_RETRIEVED_LESSONS);
      retrieved = args.frozenCodes;
    } else if (args.request?.trim()) {
      try {
        const hits = await Promise.race([
          this.agentChunks.search({
            useCase: args.useCase,
            collection: ClCollectionId.BUILDER_LESSONS,
            queries: [args.request.replace(/\s+/g, ' ').slice(0, 500)],
            repos: args.repos,
            limit: BUILDER_RETRIEVED_LESSONS,
            sessionId: args.sessionId ?? null,
            excludeCodes: [...pinnedCodes],
            queryOrigin: 'lessons_block',
          }),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), BUILDER_LESSON_SEARCH_TIMEOUT_MS),
          ),
        ]);
        if (hits) {
          relevant = hits.map((h) => h.chunk);
          retrieved = relevant.map((c) => c.code);
        }
      } catch (error) {
        this.logger.warn(
          `Lesson search skipped (pinned lessons only this time): ${(error as Error).message}`,
        );
      }
    }

    const lessons = [...pinned, ...relevant];
    if (!lessons.length) return { block: '', retrieved };
    return {
      block: [
        '# Lessons from previous builds\n',
        'Pinned lessons first, then the ones most relevant to this work. Each carries a code. ' +
          'If one changes what you do, cite its code as [BL-…] where it changed the decision — ' +
          'an unused lesson is one nobody should keep paying context for.\n',
        ...lessons.map((c) => `- ${this.agentChunks!.card(c)}`),
      ].join('\n'),
      retrieved,
    };
  }

  /** The active lessons in scope for these repos, by evidence — for the outcome categoriser. */
  inScope(repos?: string[] | null, limit = 40): Promise<ClChunk[]> {
    if (!this.agentChunks) return Promise.resolve([]);
    return this.agentChunks.listActive({
      collection: ClCollectionId.BUILDER_LESSONS,
      repos,
      limit,
    });
  }
}
