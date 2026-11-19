import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import type { BuilderSession } from 'src/builder/entity/builder-session.entity';
import type { BuilderToolExecutionOutcome } from 'src/builder/type/builder-sse.type';
import {
  BuilderPlanToolProvider,
  builderPlanTools,
} from 'src/builder/util/builder-plan-tools.registry';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import { RoadmapCopilotToolsService } from '../service/roadmap-copilot-tools.service';
import { RoadmapCommentService } from '../service/roadmap-comment.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import { normaliseOpportunityBrief } from '../util/roadmap-brief.util';

export const PLAN_ROADMAP_TOOL_NAMES = {
  SEARCH: 'search_roadmap_ideas',
  READ: 'read_roadmap_idea',
  NOTES: 'search_interview_notes',
} as const;

const SEARCH_MAX = 10;
const SNIPPET_CHARS = 300;
const COMMENTS_MAX = 10;
const COMMENT_CHARS = 500;

const NO_ACCESS = {
  ok: false,
  error:
    'The person running this turn has no Roadmap access, so the board cannot be read.',
};

/**
 * The planning agent's three read-only Roadmap tools (audit rec. 5): search the board, read
 * one idea, and search the team's user interview notes. Registered into Builder's plan-session
 * belt (builder-plan-tools.registry) so Builder never imports the roadmap.
 *
 * Reuses the idea agent's own lookups (RoadmapCopilotToolsService) for search and interview
 * notes, then passes every idea through the Roadmap read model as the turn's caller, so the
 * agent sees exactly the ideas that person can open and nothing else:
 * - drafts are never on the board (they are private sessions, not opportunities);
 * - bugs are not ideas and are dropped;
 * - a decline reason is never returned, even to an Owner: the session's other readers would
 *   see the agent quote it, and only the author may read it.
 */
@Injectable()
export class PlanRoadmapToolsService
  implements BuilderPlanToolProvider, OnModuleInit, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    PlanRoadmapToolsService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly roles: RoadmapRoleService,
    private readonly reader: RoadmapItemReadService,
    private readonly copilotTools: RoadmapCopilotToolsService,
    private readonly comments: RoadmapCommentService,
  ) {}

  onModuleInit(): void {
    builderPlanTools.register(this);
  }

  onModuleDestroy(): void {
    builderPlanTools.clear();
  }

  definitions(): any[] {
    return [
      {
        name: PLAN_ROADMAP_TOOL_NAMES.SEARCH,
        description:
          'Search the Roadmap board for ideas like this one, by meaning and by wording. Use it to ' +
          'find an idea that overlaps, one already built, or one this depends on, before writing ' +
          'scope or non-goals. Returns code, title, stage, votes, goal, size and the start of ' +
          'each description. Read-only.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'What to look for, in a phrase',
            },
          },
          required: ['query'],
        },
      },
      {
        name: PLAN_ROADMAP_TOOL_NAMES.READ,
        description:
          'Read one Roadmap idea in full by its code (e.g. "OPP-0714"): its description as it ' +
          "reads now, stage, goal, size, votes, author, the idea agent's brief and recent " +
          'comments. Use it on this idea to re-read what was asked, and on a similar idea before ' +
          'deciding it overlaps. Read-only.',
        input_schema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
        },
      },
      {
        name: PLAN_ROADMAP_TOOL_NAMES.NOTES,
        description:
          'Search the notes from real user interviews the team has logged (title, interviewee, ' +
          'summary): the best evidence of who has a need and how often. Use a short keyword or ' +
          'two, not a sentence: it matches text. Read-only.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  handles(name: string): boolean {
    return (Object.values(PLAN_ROADMAP_TOOL_NAMES) as string[]).includes(name);
  }

  async execute(
    name: string,
    input: Record<string, any>,
    ctx: { session: BuilderSession; userId: number },
  ): Promise<BuilderToolExecutionOutcome> {
    try {
      if ((await this.roles.roleOf(ctx.userId)) === 'none') {
        return { modelResult: NO_ACCESS, summary: 'No Roadmap access' };
      }
      switch (name) {
        case PLAN_ROADMAP_TOOL_NAMES.SEARCH: {
          const result = await this.search(
            ctx.userId,
            String(input?.query ?? ''),
          );
          return {
            modelResult: result,
            summary: result.ok
              ? `Roadmap: "${String(input?.query ?? '').slice(0, 60)}" — ${result.matches.length} idea(s)`
              : `Lookup failed: ${result.error}`,
          };
        }
        case PLAN_ROADMAP_TOOL_NAMES.READ: {
          const result = await this.read(ctx.userId, String(input?.code ?? ''));
          return {
            modelResult: result,
            summary: result.ok
              ? `Read ${result.idea.code}`
              : `Lookup failed: ${result.error}`,
          };
        }
        case PLAN_ROADMAP_TOOL_NAMES.NOTES: {
          const outcome = await this.copilotTools.execute(
            'search_user_interviews',
            { query: String(input?.query ?? '') },
            { userId: ctx.userId },
          );
          return {
            modelResult: parseResult(outcome.modelResult),
            summary: outcome.summary,
          };
        }
        default:
          return {
            modelResult: { ok: false, error: `Unknown tool "${name}"` },
            summary: `Unknown tool "${name}"`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[ROADMAP] Plan tool ${name} failed: ${message}`);
      return {
        modelResult: { ok: false, error: message },
        summary: `Lookup failed: ${message}`,
      };
    }
  }

  /** Meaning and wording (the idea agent's search), then title and author, filtered by the read model. */
  private async search(
    userId: number,
    query: string,
  ): Promise<
    | { ok: true; matches: Record<string, unknown>[]; note?: string }
    | { ok: false; error: string }
  > {
    const trimmed = query.trim();
    if (!trimmed)
      return { ok: false, error: 'Give me something to search for.' };

    const codes: string[] = [];
    const copilot = parseResult(
      (
        await this.copilotTools.execute(
          'search_roadmap',
          { query: trimmed },
          { userId },
        )
      ).modelResult,
    );
    for (const match of Array.isArray(copilot.matches) ? copilot.matches : []) {
      if (typeof match?.code === 'string') codes.push(match.code);
    }
    const quick = await this.reader.search(userId, trimmed);
    for (const row of quick.items) codes.push(row.code);

    const unique = [...new Set(codes)];
    if (!unique.length) {
      return {
        ok: true,
        matches: [],
        note: 'Nothing matched. Try one or two words from a screen or feature name before concluding the board has nothing like it.',
      };
    }
    const found: { id: string; code: string; description: string }[] =
      await this.dataSource.query(
        `SELECT id, code, description FROM "roadmap_opportunities"
          WHERE code = ANY($1) AND type = 'idea' AND "deletedAt" IS NULL`,
        [unique],
      );
    const byId = new Map(found.map((f) => [f.id, f]));
    const order = new Map(unique.map((code, i) => [code, i]));
    const rows = (await this.reader.rowsFor(userId, [...byId.keys()]))
      .sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
      .slice(0, SEARCH_MAX);
    return {
      ok: true,
      matches: rows.map((row) => {
        const description = byId.get(row.id)?.description ?? '';
        return {
          code: row.code,
          title: row.title,
          stage: row.shownStage,
          votes: row.votes,
          goal: row.goal?.name ?? null,
          size: row.size,
          description:
            description.length > SNIPPET_CHARS
              ? `${description.slice(0, SNIPPET_CHARS)}…`
              : description,
        };
      }),
    };
  }

  private async read(
    userId: number,
    code: string,
  ): Promise<
    { ok: true; idea: Record<string, any> } | { ok: false; error: string }
  > {
    const wanted = code.trim().toUpperCase();
    if (!wanted)
      return { ok: false, error: 'Which idea? Give its code, e.g. OPP-0714.' };
    let item;
    try {
      item = await this.reader.detail(userId, wanted);
    } catch {
      return {
        ok: false,
        error: `No idea with code ${wanted} that this person can read.`,
      };
    }
    const [opp] = await this.dataSource.query(
      `SELECT description, brief FROM "roadmap_opportunities" WHERE id = $1`,
      [item.id],
    );
    const comments = (await this.comments.list(item.id).catch(() => [])).slice(
      -COMMENTS_MAX,
    );
    const names = await this.namesOf(comments.map((c) => c.createdBy));
    // An allowlist, never the whole detail: no decline reason, spend, session or people list.
    return {
      ok: true,
      idea: {
        code: item.code,
        title: item.title,
        description: opp?.description ?? null,
        stage: item.shownStage,
        votes: item.votes,
        goal: item.goal?.name ?? null,
        size: item.size,
        author: item.author?.name ?? null,
        lead: item.lead?.name ?? null,
        plannedMonth: item.plannedMonth,
        releasedAt: item.releasedAt,
        brief: normaliseOpportunityBrief(opp?.brief),
        comments: comments.map((c) => ({
          author: names.get(Number(c.createdBy)) ?? 'Someone',
          body:
            c.body.length > COMMENT_CHARS
              ? `${c.body.slice(0, COMMENT_CHARS)}…`
              : c.body,
        })),
      },
    };
  }

  private async namesOf(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [unique],
      );
    return new Map(
      rows.filter((r) => r.name).map((r) => [Number(r.id), r.name as string]),
    );
  }
}

/** The idea agent's tools answer with bounded JSON text; a truncated one is passed on as text. */
function parseResult(text: string): Record<string, any> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : { ok: true, text };
  } catch {
    return { ok: true, text };
  }
}
