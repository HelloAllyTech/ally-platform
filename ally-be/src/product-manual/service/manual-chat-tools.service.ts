import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerService } from 'src/logger/logger.service';
import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { BuilderGithubReadService } from 'src/builder/service/builder-github-read.service';
import {
  BUILDER_REPO_NAMES,
  isBuilderReadableRepo,
} from 'src/builder/constants/builder-repos.constants';
import { RoadmapItemReadService } from 'src/product-roadmap/item/roadmap-item-read.service';
import {
  MANUAL_CHAT_LIMITS,
  MANUAL_DRAFT_TOOL_NOTE,
  MANUAL_TOOL_FAILURE_SENTENCES,
  toolFailureSentence,
} from '../constants/manual-agent.constants';
import type { ManualChatDraft } from '../entity/manual-conversation.entity';
import type { ManualProposal } from '../entity/manual-proposal.entity';
import type {
  ManualAuthorKind,
  ManualSourceRef,
} from '../entity/manual-revision.entity';
import { pageLossRefusal } from '../util/manual-edit-guard.util';
import { isValidSlug } from '../util/manual-slug.util';
import { ManualPageService } from './manual-page.service';
import { ManualProposalService } from './manual-proposal.service';
import { ManualScrubService } from './manual-scrub.service';
import { ManualSearchService } from './manual-search.service';
import { ManualAnalyticsPort } from './manual-analytics.port';
import type { ManualToolOutcome } from './manual-agent-core';
import { snippetToPlainText } from './manual-plain-text';

export type ManualEditRecord = {
  slug: string;
  title: string;
  revisionId: string;
  reason: string;
};

/**
 * Everything a tool call may read or change during one chat turn or one weekly work item. Built by
 * the caller, never by the model: the model cannot widen what it is allowed to do.
 */
export interface ManualToolContext {
  mode: 'chat' | 'weekly';
  /** The caller in chat; the admin who pressed Run now (or null) in a weekly run. */
  userId: number | null;
  /** Chat: the conversation id. Weekly: the run id. Stored as the revision's author ref. */
  ref: string;
  /** Chat: analytics_ask is offered (caller holds `analytics_agent`). */
  analytics: boolean;
  /** edit / create offered: budget left and a settings row exists. */
  editsAllowed: boolean;
  /** SSE side-channel (chat only): `page_edited`, `draft`. */
  emit?: (event: string, data: unknown) => void;
  /** Weekly only: the proposal this work item applies (edits are then authored `proposal`). */
  proposal?: ManualProposal | null;
  /** Weekly only: the short master sha that mark_verified records. */
  verifiedRef?: string | null;

  // ── Collected while the turn runs ──
  edits: ManualEditRecord[];
  drafts: ManualChatDraft[];
  /** Pages read in full (slug → title): always cited. */
  read: Map<string, string>;
  /** Pages seen in search results (slug → title): cited only if the answer names them. */
  seen: Map<string, string>;
  /** Weekly: slugs edited or verified, and proposals resolved. */
  verified: Set<string>;
  /** Weekly: slugs where a sentence was flagged as contradicted by code (never also verified). */
  flagged: Set<string>;
  appliedProposals: string[];
  dismissedProposals: string[];
  /**
   * Files read with github_read_file in this turn (chat) or run (weekly: one set shared by every
   * work item), as `repo:path`. An edit that is not applying a proposal must cite one of them.
   */
  filesRead: Set<string>;
  /**
   * Weekly only: how many lookups one work item may make. A lookup past it is refused with a plain
   * instruction to decide. The first production runs gave the model 8 then 12 steps and it spent
   * every one searching; asking for "at most 4 lookups" in the prompt changed nothing.
   */
  lookupBudget?: { code: number; manual: number };
  /** Lookups made so far, counting every attempt (a failing search still costs a step). */
  lookupsUsed: { code: number; manual: number };
  /** Every tool call this turn or work item made, in order: where its steps went. */
  trace: ManualToolTraceEntry[];
}

export interface ManualToolTraceEntry {
  tool: string;
  ok: boolean;
  /** Why it failed, short; never page text. */
  note?: string;
}

export function newToolContext(
  init: Pick<ManualToolContext, 'mode' | 'userId' | 'ref'> &
    Partial<ManualToolContext>,
): ManualToolContext {
  return {
    analytics: false,
    editsAllowed: false,
    edits: [],
    drafts: [],
    read: new Map(),
    seen: new Map(),
    verified: new Set(),
    flagged: new Set(),
    appliedProposals: [],
    dismissedProposals: [],
    filesRead: new Set(),
    lookupsUsed: { code: 0, manual: 0 },
    trace: [],
    ...init,
  };
}

const SOURCE_KINDS: ManualSourceRef['kind'][] = [
  'code',
  'wiki',
  'pr',
  'analytics',
  'chat',
];

const SOURCES_SCHEMA = {
  type: 'array',
  minItems: 1,
  description:
    'Where the new text comes from: at least one. For code give repo and path.',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: SOURCE_KINDS },
      label: { type: 'string', description: 'A short human label' },
      repo: { type: 'string' },
      path: { type: 'string' },
      url: { type: 'string' },
    },
    required: ['kind', 'label'],
  },
};

const REPO_SCHEMA = { type: 'string', enum: BUILDER_REPO_NAMES };

const TAGS_SCHEMA = { type: 'array', items: { type: 'string' } };

/** Tools only the weekly agent gets. */
const WEEKLY_ONLY = new Set([
  'mark_verified',
  'flag_discrepancy',
  'apply_proposal',
  'dismiss_proposal',
]);
/** Tools only the chat agent gets. */
const CHAT_ONLY = new Set([
  'search_roadmap',
  'analytics_ask',
  'propose_draft',
  'log_gap',
]);
const EDIT_TOOLS = new Set(['edit_manual_page', 'create_manual_page']);
/** Lookups that read code, and lookups that read the manual: each has its own weekly budget. */
const CODE_LOOKUP_TOOLS = new Set([
  'github_search_code',
  'github_read_file',
  'github_repo_tree',
]);
const MANUAL_LOOKUP_TOOLS = new Set(['search_manual', 'read_manual_page']);
/** Offered only when GitHub is configured here: otherwise every call fails and the model retries. */
const CODE_TOOLS = new Set([
  'github_search_code',
  'github_read_file',
  'github_repo_tree',
]);

/**
 * The Product Manual agents' tools, for the chat (`mode: 'chat'`) and the weekly agent
 * (`mode: 'weekly'`). Which tools a pass is offered is decided here from the context, never by the
 * model: edits are withheld when the budget is used up, analytics only for a caller holding its
 * toggle, and the weekly-only tools never reach the chat.
 *
 * Every write goes through `ManualPageService.write` (the single writer). Every tool returns
 * `{ok:false,error}` rather than throwing, so the model can read the reason and recover.
 */
@Injectable()
export class ManualChatToolsService {
  private readonly logger = LoggerService.getInstance(
    ManualChatToolsService.name,
  );

  constructor(
    private readonly pages: ManualPageService,
    private readonly search: ManualSearchService,
    private readonly scrub: ManualScrubService,
    private readonly proposals: ManualProposalService,
    private readonly githubRead: BuilderGithubReadService,
    private readonly roadmapItems: RoadmapItemReadService,
    private readonly analytics: ManualAnalyticsPort,
  ) {}

  /** A stable order: the tool list sits in front of the cached system prefix. */
  getToolDefinitions(ctx: ManualToolContext): AgentToolDefinition[] {
    return this.allDefinitions().filter((tool) => {
      if (ctx.mode === 'chat' && WEEKLY_ONLY.has(tool.name)) return false;
      if (ctx.mode === 'weekly' && CHAT_ONLY.has(tool.name)) return false;
      if (EDIT_TOOLS.has(tool.name) && !ctx.editsAllowed) return false;
      // With no code to read, an edit could only be cited to a proposal: none in the chat.
      if (
        EDIT_TOOLS.has(tool.name) &&
        (!ctx.proposal || ctx.proposal.kind === 'gap') &&
        !this.codeSearchAvailable()
      ) {
        return false;
      }
      // Proposals are not worked by the weekly agent any more: no proposal in hand, nothing to resolve.
      if (
        (tool.name === 'apply_proposal' || tool.name === 'dismiss_proposal') &&
        !ctx.proposal
      ) {
        return false;
      }
      if (tool.name === 'analytics_ask' && !ctx.analytics) return false;
      if (!this.codeSearchAvailable()) {
        if (CODE_TOOLS.has(tool.name)) return false;
        // The weekly agent verifies against master; with no code to read it cannot verify.
        if (ctx.mode === 'weekly' && tool.name === 'mark_verified')
          return false;
      }
      return true;
    });
  }

  /** Whether the github_* tools work on this environment (a GITHUB_TOKEN is set). */
  codeSearchAvailable(): boolean {
    return this.githubRead.isConfigured;
  }

  private allDefinitions(): AgentToolDefinition[] {
    return [
      {
        name: 'search_manual',
        description:
          'Search the Product Manual by words. Returns page slugs, titles, their section and a ' +
          'short matching snippet. Start here for any question about how the product works.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'A few words' },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_manual_page',
        description:
          'Read one manual page in full by slug: title, summary, body (markdown with [[slug]] ' +
          'links), who it is for, where it happens, and when it was last checked against the code.',
        input_schema: {
          type: 'object',
          properties: { slug: { type: 'string' } },
          required: ['slug'],
        },
      },
      {
        name: 'search_roadmap',
        description:
          'Search the roadmap for ideas and work like the one being discussed. Returns code, ' +
          'title and stage (Draft, Backlog, Being built, Shipped, Declined). Check it before ' +
          'proposing a draft, and when asked whether something is planned.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'github_search_code',
        description:
          'Search the Ally code on master and get matching file paths. Use it when the manual is ' +
          'silent or looks wrong. Every word must match, so search one identifier or one to ' +
          'three words.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' }, repo: REPO_SCHEMA },
          required: ['query'],
        },
      },
      {
        name: 'github_read_file',
        description:
          'Read one file from master (truncated). Prefer the one component, controller or ' +
          'service that matters over large files.',
        input_schema: {
          type: 'object',
          properties: { repo: REPO_SCHEMA, path: { type: 'string' } },
          required: ['repo', 'path'],
        },
      },
      {
        name: 'github_repo_tree',
        description:
          'List files in a service folder, optionally under a subpath.',
        input_schema: {
          type: 'object',
          properties: { repo: REPO_SCHEMA, path: { type: 'string' } },
          required: ['repo'],
        },
      },
      {
        name: 'analytics_ask',
        description:
          'Ask the Analytics Agent a usage question in plain words ("how many learners finished ' +
          'a roleplay last week"). Slow (up to 90 s): use it only when a number matters to the ' +
          'answer, and say where the number came from.',
        input_schema: {
          type: 'object',
          properties: { question: { type: 'string' } },
          required: ['question'],
        },
      },
      {
        name: 'edit_manual_page',
        description:
          'Replace an existing page body with a corrected version. Read the page first; send the ' +
          'WHOLE new body with your change made in place and every other line kept exactly; never ' +
          "only the changed part or a proposal's text (an edit that drops most of the page is " +
          'refused). Change only what is wrong or missing. Needs a one-sentence reason a reader of ' +
          'the change log can follow, and at least one source.',
        input_schema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            newBody: {
              type: 'string',
              description:
                'The ENTIRE page after your change: all unchanged lines kept exactly, your change made in place',
            },
            reason: { type: 'string' },
            sources: SOURCES_SCHEMA,
            title: { type: 'string', description: 'Optional new title' },
            summary: {
              type: 'string',
              description: 'Optional new one- or two-sentence summary',
            },
          },
          required: ['slug', 'newBody', 'reason', 'sources'],
        },
      },
      {
        name: 'create_manual_page',
        description:
          'Create a page for a topic the manual does not cover yet. Search first so you do not ' +
          'duplicate a page. Slug: lowercase words joined by hyphens. Put it under the right ' +
          'section with parentSlug.',
        input_schema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            body: { type: 'string' },
            parentSlug: { type: 'string' },
            reason: { type: 'string' },
            sources: SOURCES_SCHEMA,
            roles: TAGS_SCHEMA,
            surfaces: TAGS_SCHEMA,
            journeys: TAGS_SCHEMA,
          },
          required: ['slug', 'title', 'summary', 'body', 'reason', 'sources'],
        },
      },
      {
        name: 'propose_draft',
        description:
          "Put a rough idea in the user's drafts tray: a short title and a few sentences on the " +
          'problem and who has it. Not a full opportunity. Nothing reaches the roadmap until the ' +
          'user saves it.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            text: { type: 'string' },
            relatedSlugs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Manual pages the idea relates to',
            },
          },
          required: ['title', 'text'],
        },
      },
      {
        name: 'log_gap',
        description:
          'Record a question the manual could not answer and you could not fix, so the weekly ' +
          'agent picks it up.',
        input_schema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            pageSlug: { type: 'string' },
          },
          required: ['question'],
        },
      },
      {
        name: 'flag_discrepancy',
        description:
          'Record that ONE specific sentence on this page is contradicted by code you read. Give the ' +
          'sentence exactly as it appears on the page, what the code shows instead, the surfaces you ' +
          'checked (web, mobile, server) and the files you read. Only when the code you read ' +
          'contradicts the sentence, on every surface you checked: never because you could not find ' +
          'something. You cannot edit the page; this goes to the update queue. Never also call ' +
          'mark_verified for the same page.',
        input_schema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            claim: {
              type: 'string',
              description: 'The exact sentence or table row from the page',
            },
            finding: {
              type: 'string',
              description: 'What the code shows instead, in plain words',
            },
            surfacesChecked: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
              description:
                'Which of web, mobile, server (or others) you read code for',
            },
            sources: SOURCES_SCHEMA,
          },
          required: ['slug', 'claim', 'finding', 'surfacesChecked', 'sources'],
        },
      },
      {
        name: 'mark_verified',
        description:
          'Record that a page matches the code on master (after reading both, and after any edit).',
        input_schema: {
          type: 'object',
          properties: { slug: { type: 'string' } },
          required: ['slug'],
        },
      },
      {
        name: 'apply_proposal',
        description:
          'Close the proposal of this work item as applied, after the page edit that applies it.',
        input_schema: {
          type: 'object',
          properties: { proposalId: { type: 'string' } },
          required: ['proposalId'],
        },
      },
      {
        name: 'dismiss_proposal',
        description:
          'Close the proposal of this work item without changing the manual: the code does not ' +
          'confirm it, or the page already says it.',
        input_schema: {
          type: 'object',
          properties: {
            proposalId: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['proposalId', 'reason'],
        },
      },
    ];
  }

  /** The activity line a person reads while a lookup runs: their words, not a tool name. */
  describe(name: string, input: Record<string, any>): string {
    const q = (value: unknown) => `"${String(value ?? '').slice(0, 80)}"`;
    switch (name) {
      case 'search_manual':
        return `Searching the manual for ${q(input?.query)}`;
      case 'read_manual_page':
        return `Reading ${String(input?.slug ?? 'a page')}`;
      case 'search_roadmap':
        return `Checking the roadmap for ${q(input?.query)}`;
      case 'github_search_code':
        return `Searching the code for ${q(input?.query)}`;
      case 'github_read_file':
        return `Reading ${input?.repo}/${input?.path}`;
      case 'github_repo_tree':
        return `Browsing ${input?.repo}${input?.path ? `/${input.path}` : ''}`;
      case 'analytics_ask':
        return `Asking analytics: ${String(input?.question ?? '').slice(0, 140)}`;
      case 'edit_manual_page':
        return `Updating the page ${String(input?.slug ?? '')}`;
      case 'create_manual_page':
        return `Adding a page: ${String(input?.title ?? input?.slug ?? '')}`;
      case 'propose_draft':
        return `Drafting an idea: ${String(input?.title ?? '').slice(0, 80)}`;
      case 'log_gap':
        return 'Noting a gap in the manual';
      case 'mark_verified':
        return `Marking ${String(input?.slug ?? '')} as checked`;
      case 'apply_proposal':
        return 'Closing the proposal as applied';
      case 'dismiss_proposal':
        return 'Dismissing the proposal';
      default:
        return `Running ${name}`;
    }
  }

  /** Run one tool and record it on the context's trace. Never throws. */
  async execute(
    name: string,
    input: Record<string, any>,
    ctx: ManualToolContext,
  ): Promise<ManualToolOutcome> {
    const outcome = await this.executeOne(name, input, ctx);
    ctx.trace.push({
      tool: name,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { note: failureNote(outcome) }),
    });
    return outcome;
  }

  /** The refusal for a lookup past this work item's budget, or null when it may run (and counts it). */
  private lookupRefusal(name: string, ctx: ManualToolContext): string | null {
    const budget = ctx.lookupBudget;
    if (!budget) return null;
    const kind = CODE_LOOKUP_TOOLS.has(name)
      ? 'code'
      : MANUAL_LOOKUP_TOOLS.has(name)
        ? 'manual'
        : null;
    if (!kind) return null;
    if (ctx.lookupsUsed[kind] >= budget[kind]) {
      return (
        `Lookup budget used: you have already made ${budget[kind]} ${kind} lookups for this page. ` +
        'Do not look anything else up. Decide now: edit_manual_page citing a file you read, ' +
        'mark_verified if the code you read supports the page, or stop and say in one sentence ' +
        'what you could not find.'
      );
    }
    ctx.lookupsUsed[kind] += 1;
    return null;
  }

  /** Run one tool. Never throws. A tool not offered to this context is refused, not run. */
  private async executeOne(
    name: string,
    input: Record<string, any>,
    ctx: ManualToolContext,
  ): Promise<ManualToolOutcome> {
    if (!this.getToolDefinitions(ctx).some((t) => t.name === name)) {
      return fail(
        `The tool "${name}" is not available here.`,
        MANUAL_TOOL_FAILURE_SENTENCES.unavailable,
      );
    }
    const refusal = this.lookupRefusal(name, ctx);
    if (refusal)
      return fail(refusal, MANUAL_TOOL_FAILURE_SENTENCES.lookup_budget);
    try {
      const { result, summary } = await this.run(name, input ?? {}, ctx);
      const ok = result?.ok !== false;
      return {
        modelResult: bound(JSON.stringify(result ?? { ok: true })),
        summary: ok
          ? summary(result)
          : toolFailureSentence(name, result?.error),
        ok,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[PRODUCT_MANUAL] Tool ${name} failed: ${message}`);
      return fail(message, toolFailureSentence(name));
    }
  }

  private async run(
    name: string,
    input: Record<string, any>,
    ctx: ManualToolContext,
  ): Promise<{ result: any; summary: (result: any) => string }> {
    switch (name) {
      case 'search_manual':
        return {
          result: await this.searchManual(String(input.query ?? ''), ctx),
          summary: (r) => count(r.results, 'page'),
        };
      case 'read_manual_page':
        return {
          result: await this.readPage(String(input.slug ?? ''), ctx),
          summary: (r) => `Read ${r.page?.title ?? 'the page'}`,
        };
      case 'search_roadmap':
        return {
          result: await this.searchRoadmap(ctx, String(input.query ?? '')),
          summary: (r) => count(r.items, 'roadmap item'),
        };
      case 'github_search_code':
        return {
          result: await this.repoGuard(input.repo, true, () =>
            this.githubRead.searchCode(
              String(input.query ?? ''),
              input.repo ? String(input.repo) : undefined,
            ),
          ),
          summary: (r) => count(r.results, 'matching file'),
        };
      case 'github_read_file': {
        const result = await this.repoGuard(input.repo, false, () =>
          this.githubRead.readFile(
            String(input.repo ?? ''),
            String(input.path ?? ''),
          ),
        );
        if (result?.ok !== false) {
          ctx.filesRead.add(fileKey(input.repo, input.path));
        }
        return { result, summary: () => 'Read' };
      }
      case 'github_repo_tree':
        return {
          result: await this.repoGuard(input.repo, false, () =>
            this.githubRead.repoTree(
              String(input.repo ?? ''),
              input.path ? String(input.path) : undefined,
            ),
          ),
          summary: (r) => count(r.files, 'file'),
        };
      case 'analytics_ask':
        return {
          result: ctx.userId
            ? await this.analytics.ask(String(input.question ?? ''), ctx.userId)
            : { ok: false, error: 'Analytics needs a signed-in user.' },
          summary: (r) =>
            r.answer
              ? String(r.answer).replace(/\s+/g, ' ').slice(0, 160)
              : `Analytics: ${r.outcome ?? 'answered'}`,
        };
      case 'edit_manual_page':
        return {
          result: await this.editPage(input, ctx),
          summary: (r) =>
            r.changed === false
              ? 'No change needed'
              : `Updated ${r.title ?? 'the page'}`,
        };
      case 'create_manual_page':
        return {
          result: await this.createPage(input, ctx),
          summary: (r) => `Added ${r.title ?? 'a page'}`,
        };
      case 'propose_draft':
        return {
          result: await this.proposeDraft(input, ctx),
          summary: (r) => `Drafted "${r.title ?? 'an idea'}"`,
        };
      case 'log_gap':
        return {
          result: await this.logGap(input, ctx),
          summary: () => 'Noted for the weekly update',
        };
      case 'mark_verified':
        return {
          result: await this.markVerified(String(input.slug ?? ''), ctx),
          summary: () => 'Marked as checked',
        };
      case 'flag_discrepancy':
        return {
          result: await this.flagDiscrepancy(input, ctx),
          summary: () => 'Recorded for the update queue',
        };
      case 'apply_proposal':
        return {
          result: await this.resolveProposal(input, ctx, 'apply'),
          summary: () => 'Proposal applied',
        };
      case 'dismiss_proposal':
        return {
          result: await this.resolveProposal(input, ctx, 'dismiss'),
          summary: () => 'Proposal dismissed',
        };
      default:
        return {
          result: { ok: false, error: `Unknown tool "${name}"` },
          summary: () => '',
        };
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  private async searchManual(query: string, ctx: ManualToolContext) {
    const q = query.trim();
    if (q.length < 2)
      return { ok: false, error: 'Search with at least two characters.' };
    const hits = await this.search.search(q, MANUAL_CHAT_LIMITS.SEARCH_LIMIT);
    for (const hit of hits) ctx.seen.set(hit.slug, hit.title);
    return {
      ok: true,
      results: hits.map((h) => ({
        slug: h.slug,
        title: h.title,
        section: h.parentTitle,
        // The model reads plain text; <mark> is for the reader UI.
        snippet: snippetToPlainText(h.snippet),
      })),
    };
  }

  private async readPage(slug: string, ctx: ManualToolContext) {
    if (!isValidSlug(slug))
      return { ok: false, error: `"${slug}" is not a valid slug.` };
    const page = await this.pages.getBySlug(slug);
    if (!page) {
      return {
        ok: false,
        error: `No page "${slug}". Use search_manual to find the right slug.`,
      };
    }
    ctx.read.set(page.slug, page.title);
    const body =
      page.body.length > MANUAL_CHAT_LIMITS.PAGE_BODY_MAX_CHARS
        ? `${page.body.slice(0, MANUAL_CHAT_LIMITS.PAGE_BODY_MAX_CHARS)}… [truncated]`
        : page.body;
    return {
      ok: true,
      page: {
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        parentSlug: page.parentSlug ?? null,
        kind: page.kind,
        roles: page.roles,
        surfaces: page.surfaces,
        journeys: page.journeys,
        releaseState: page.releaseState,
        verifiedAt: page.verifiedAt
          ? new Date(page.verifiedAt).toISOString()
          : null,
        updatedAt: page.updatedAt
          ? new Date(page.updatedAt).toISOString()
          : null,
        body,
      },
    };
  }

  private async searchRoadmap(ctx: ManualToolContext, query: string) {
    if (!ctx.userId)
      return { ok: false, error: 'The roadmap needs a signed-in user.' };
    const q = query.trim();
    if (!q) return { ok: false, error: 'Say what to search for.' };
    try {
      const { items } = await this.roadmapItems.search(ctx.userId, q);
      return {
        ok: true,
        items: items.slice(0, MANUAL_CHAT_LIMITS.ROADMAP_ROWS).map((i) => ({
          code: i.code,
          title: i.title,
          stage: i.stage,
          votes: i.votes,
          goal: i.goal?.name ?? null,
          releasedAt: i.releasedAt,
        })),
      };
    } catch (error) {
      // A caller with no roadmap role gets the service's 403 — as a readable tool error.
      return {
        ok: false,
        error: (error as Error)?.message ?? 'Roadmap search failed.',
      };
    }
  }

  private async repoGuard(
    repo: unknown,
    optional: boolean,
    read: () => Promise<Record<string, any>>,
  ) {
    if (repo === undefined || repo === null || repo === '') {
      if (!optional) return { ok: false, error: 'Name the repo.' };
    } else if (!isBuilderReadableRepo(String(repo))) {
      return {
        ok: false,
        error: `"${String(repo)}" is not readable. Use one of: ${BUILDER_REPO_NAMES.join(', ')}.`,
      };
    }
    return read();
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  private authorFor(ctx: ManualToolContext): {
    kind: ManualAuthorKind;
    ref: string;
  } {
    if (ctx.mode === 'chat') return { kind: 'chat_agent', ref: ctx.ref };
    if (ctx.proposal) return { kind: 'proposal', ref: ctx.proposal.id };
    return { kind: 'weekly_agent', ref: ctx.ref };
  }

  /**
   * The evidence rule, enforced here rather than asked for in the prompt. An edit that applies this
   * work item's proposal may cite the proposal (it is added as a source when not cited). Any other
   * edit must cite at least one `code` source (repo + path) that was actually read with
   * github_read_file in this turn or run: no edit on taste, memory or an unread file.
   */
  private checkReasonAndSources(
    input: Record<string, any>,
    ctx: ManualToolContext,
  ): { reason: string; sources: ManualSourceRef[] } | { error: string } {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) return { error: 'Give a one-sentence reason for the change.' };
    const sources = normaliseSources(input.sources);
    // A gap is a question, not a statement of change: it is no evidence for its own answer.
    if (ctx.proposal && ctx.proposal.kind !== 'gap') {
      if (!sources.some((src) => src.kind === 'pr')) {
        sources.push({
          kind: 'pr',
          label: `Proposal ${ctx.proposal.id}`,
          ...(ctx.proposal.prRef ? { url: ctx.proposal.prRef } : {}),
        });
      }
      return { reason, sources };
    }
    const backed = sources.some(
      (src) =>
        src.kind === 'code' &&
        !!src.repo &&
        !!src.path &&
        ctx.filesRead.has(fileKey(src.repo, src.path)),
    );
    if (!backed) {
      return {
        error:
          'Read the file first: an edit must cite at least one source of kind "code" with the repo ' +
          'and path of a file you read with github_read_file in this conversation turn. Copy labels ' +
          'and button names from that file.',
      };
    }
    return { reason, sources };
  }

  private scrubbed(...texts: unknown[]): string | null {
    for (const text of texts) {
      if (typeof text !== 'string' || !text) continue;
      const verdict = this.scrub.check(text);
      if (!verdict.ok) return `Rejected by the scrubber: ${verdict.reason}`;
    }
    return null;
  }

  private async editPage(input: Record<string, any>, ctx: ManualToolContext) {
    const slug = String(input.slug ?? '');
    if (!isValidSlug(slug))
      return { ok: false, error: `"${slug}" is not a valid slug.` };
    const newBody = typeof input.newBody === 'string' ? input.newBody : '';
    if (!newBody.trim()) return { ok: false, error: 'newBody is empty.' };
    const checked = this.checkReasonAndSources(input, ctx);
    if ('error' in checked) return { ok: false, error: checked.error };
    const existing = await this.pages.getBySlug(slug);
    if (!existing) {
      return {
        ok: false,
        error: `No page "${slug}". Use create_manual_page for a new topic.`,
      };
    }
    // An edit replaces the whole page: refuse one that would drop most of it (a fragment, or a
    // proposal's own text, sent as the body).
    const loss = pageLossRefusal(existing.body ?? '', newBody);
    if (loss) return { ok: false, error: loss };
    const rejected = this.scrubbed(
      newBody,
      input.title,
      input.summary,
      checked.reason,
    );
    if (rejected) return { ok: false, error: rejected };

    return this.write(
      {
        slug,
        body: newBody,
        ...(typeof input.title === 'string' && input.title.trim()
          ? { title: input.title.trim() }
          : {}),
        ...(typeof input.summary === 'string' && input.summary.trim()
          ? { summary: input.summary.trim() }
          : {}),
      },
      checked,
      ctx,
    );
  }

  private async createPage(input: Record<string, any>, ctx: ManualToolContext) {
    const slug = String(input.slug ?? '');
    if (!isValidSlug(slug))
      return { ok: false, error: `"${slug}" is not a valid slug.` };
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body : '';
    if (!title || !body.trim())
      return { ok: false, error: 'A new page needs a title and a body.' };
    if (ctx.proposal && ctx.proposal.kind !== 'new_page') {
      return {
        ok: false,
        error:
          'create_manual_page is only for a new_page proposal. For this proposal edit the existing ' +
          'page, or leave the proposal open.',
      };
    }
    const checked = this.checkReasonAndSources(input, ctx);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (await this.pages.getBySlug(slug)) {
      return {
        ok: false,
        error: `A page "${slug}" already exists. Read it and use edit_manual_page.`,
      };
    }
    const parentSlug =
      typeof input.parentSlug === 'string' && input.parentSlug
        ? input.parentSlug
        : null;
    if (ctx.proposal && !parentSlug) {
      return {
        ok: false,
        error:
          'A page for a new_page proposal needs a parentSlug: the existing section it belongs under.',
      };
    }
    if (parentSlug && !(await this.pages.getBySlug(parentSlug))) {
      return { ok: false, error: `No parent section "${parentSlug}".` };
    }
    const summary =
      typeof input.summary === 'string' ? input.summary.trim() : '';
    const rejected = this.scrubbed(body, title, summary, checked.reason);
    if (rejected) return { ok: false, error: rejected };

    return this.write(
      {
        slug,
        title,
        summary,
        body,
        parentSlug,
        kind: 'page',
        ...(Array.isArray(input.roles)
          ? { roles: input.roles.map(String) }
          : {}),
        ...(Array.isArray(input.surfaces)
          ? { surfaces: input.surfaces.map(String) }
          : {}),
        ...(Array.isArray(input.journeys)
          ? { journeys: input.journeys.map(String) }
          : {}),
      },
      checked,
      ctx,
    );
  }

  private async write(
    page: Parameters<ManualPageService['write']>[0],
    checked: { reason: string; sources: ManualSourceRef[] },
    ctx: ManualToolContext,
  ) {
    const author = this.authorFor(ctx);
    let result: Awaited<ReturnType<ManualPageService['write']>>;
    try {
      result = await this.pages.write(
        page,
        { ...author, reason: checked.reason, sourceRefs: checked.sources },
        ctx.userId ?? null,
      );
    } catch (error) {
      // ManualWriteError messages are written to be read by a model or a person.
      return {
        ok: false,
        error: (error as Error)?.message ?? 'The write failed.',
      };
    }
    if (ctx.mode === 'weekly') ctx.verified.add(result.page.slug);
    if (!result.changed || !result.revision) {
      return {
        ok: true,
        changed: false,
        slug: result.page.slug,
        title: result.page.title,
      };
    }
    const record: ManualEditRecord = {
      slug: result.page.slug,
      title: result.page.title,
      revisionId: result.revision.id,
      reason: checked.reason,
    };
    ctx.edits.push(record);
    ctx.read.set(record.slug, record.title);
    ctx.emit?.('page_edited', record);
    return {
      ok: true,
      changed: true,
      created: result.created,
      slug: record.slug,
      title: record.title,
      revisionId: record.revisionId,
    };
  }

  private async proposeDraft(
    input: Record<string, any>,
    ctx: ManualToolContext,
  ) {
    const title = String(input.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const text = String(input.text ?? '').trim();
    if (!title || !text)
      return { ok: false, error: 'A draft needs a title and some text.' };
    const relatedSlugs: string[] = Array.isArray(input.relatedSlugs)
      ? [
          ...new Set<string>(
            input.relatedSlugs.map(String).filter(isValidSlug),
          ),
        ].slice(0, 8)
      : [];
    const relatedPages: { slug: string; title: string }[] = [];
    for (const slug of relatedSlugs) {
      const page = await this.pages.getBySlug(slug);
      if (page) relatedPages.push({ slug: page.slug, title: page.title });
    }
    const draft: ManualChatDraft = {
      id: randomUUID(),
      title: title.slice(0, MANUAL_CHAT_LIMITS.DRAFT_TITLE_MAX),
      text: text.slice(0, MANUAL_CHAT_LIMITS.DRAFT_TEXT_MAX),
      relatedPages,
      savedCode: null,
    };
    // Into the tray only: the roadmap sees nothing until the user saves it (POST /drafts).
    ctx.drafts.push(draft);
    ctx.emit?.('draft', {
      id: draft.id,
      title: draft.title,
      text: draft.text,
      relatedPages: draft.relatedPages,
    });
    return {
      ok: true,
      id: draft.id,
      title: draft.title,
      note: MANUAL_DRAFT_TOOL_NOTE,
    };
  }

  private async logGap(input: Record<string, any>, ctx: ManualToolContext) {
    const question = String(input.question ?? '').trim();
    if (!question)
      return { ok: false, error: 'Say what the manual could not answer.' };
    const pageSlug =
      typeof input.pageSlug === 'string' && isValidSlug(input.pageSlug)
        ? input.pageSlug
        : null;
    try {
      const proposal = await this.proposals.create({
        kind: 'gap',
        pageSlug,
        summary: question.slice(0, 500),
        source: 'chat',
        submittedBy: ctx.userId ?? null,
      });
      return { ok: true, proposalId: proposal.id };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error)?.message ?? 'Could not record the gap.',
      };
    }
  }

  /**
   * The weekly agent cannot edit a page. When code it read contradicts a sentence it files that as a
   * proposal (source `weekly_agent`) naming the exact sentence, what the code shows, the surfaces it
   * checked and the files it read. Not a guess: the sentence must be on the page, and a code file it
   * read this run must back the finding.
   */
  private async flagDiscrepancy(
    input: Record<string, any>,
    ctx: ManualToolContext,
  ) {
    const slug = String(input.slug ?? '');
    if (!isValidSlug(slug))
      return { ok: false, error: `"${slug}" is not a valid slug.` };
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
    const claim = typeof input.claim === 'string' ? squash(input.claim) : '';
    const finding =
      typeof input.finding === 'string' ? squash(input.finding) : '';
    if (!claim || !finding) {
      return {
        ok: false,
        error:
          'Give the exact sentence from the page and what the code shows instead.',
      };
    }
    const surfaces = Array.isArray(input.surfacesChecked)
      ? input.surfacesChecked
          .map((s: unknown) => String(s).trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (!surfaces.length) {
      return {
        ok: false,
        error: 'Say which surfaces you read code for (web, mobile, server).',
      };
    }
    const page = await this.pages.getBySlug(slug);
    if (!page) return { ok: false, error: `No page "${slug}".` };
    if (!squash(page.body ?? '').includes(claim)) {
      return {
        ok: false,
        error:
          'That sentence is not on the page as written. Copy it exactly from the page.',
      };
    }
    const checked = this.checkReasonAndSources(
      { reason: finding, sources: input.sources },
      ctx,
    );
    if ('error' in checked) return { ok: false, error: checked.error };
    const rejected = this.scrubbed(claim, finding);
    if (rejected) return { ok: false, error: rejected };

    const summary = `Page says: "${claim.slice(0, 200)}". The code shows: ${finding.slice(0, 300)}`;
    ctx.flagged.add(slug);
    const open = await this.proposals.listOpen(500);
    if (
      open.some(
        (p) =>
          p.source === 'weekly_agent' &&
          p.pageSlug === slug &&
          p.summary === summary,
      )
    ) {
      return { ok: true, flagged: true, alreadyFlagged: true };
    }
    const files = checked.sources
      .filter((src) => src.kind === 'code' && src.repo && src.path)
      .map((src) => `${src.repo}:${src.path}`);
    await this.proposals.create({
      kind: 'edit',
      pageSlug: slug,
      summary,
      detail:
        `Sentence: ${claim}\nCode shows: ${finding}\nSurfaces checked: ${surfaces.join(', ')}\n` +
        `Files read: ${files.join(', ') || '(none)'}`,
      prRef: null,
      source: 'weekly_agent',
      keyId: null,
      submittedBy: ctx.userId ?? null,
    });
    return { ok: true, flagged: true };
  }

  private async markVerified(slug: string, ctx: ManualToolContext) {
    if (!isValidSlug(slug))
      return { ok: false, error: `"${slug}" is not a valid slug.` };
    if (ctx.flagged.has(slug)) {
      return {
        ok: false,
        error:
          'You flagged a discrepancy on this page, so it is not verified. Do not mark it.',
      };
    }
    try {
      await this.pages.markVerified(slug, ctx.verifiedRef ?? null);
    } catch (error) {
      return {
        ok: false,
        error: (error as Error)?.message ?? 'Could not mark it.',
      };
    }
    ctx.verified.add(slug);
    return { ok: true, slug, ref: ctx.verifiedRef ?? null };
  }

  private async resolveProposal(
    input: Record<string, any>,
    ctx: ManualToolContext,
    action: 'apply' | 'dismiss',
  ) {
    const id = String(input.proposalId ?? '');
    // Only the proposal this work item is about: text in a page or a proposal cannot point the
    // agent at another one.
    if (!ctx.proposal || ctx.proposal.id !== id) {
      return {
        ok: false,
        error: 'You can only resolve the proposal of this work item.',
      };
    }
    try {
      if (action === 'apply') {
        const revisionId = ctx.edits.length
          ? ctx.edits[ctx.edits.length - 1].revisionId
          : null;
        await this.proposals.markApplied(id, revisionId);
        ctx.appliedProposals.push(id);
      } else {
        await this.proposals.dismiss(id);
        ctx.dismissedProposals.push(id);
      }
    } catch (error) {
      return {
        ok: false,
        error: (error as Error)?.message ?? 'Could not update the proposal.',
      };
    }
    return {
      ok: true,
      proposalId: id,
      status: action === 'apply' ? 'applied' : 'dismissed',
    };
  }
}

/** `repo:path`, with a leading `./`, `/` or the repo's own folder name stripped from the path. */
export function fileKey(repo: unknown, path: unknown): string {
  const r = String(repo ?? '').trim();
  let p = String(path ?? '')
    .trim()
    .replace(/^\.?\/+/, '');
  if (r && p.startsWith(`${r}/`)) p = p.slice(r.length + 1);
  return `${r}:${p}`;
}

function normaliseSources(raw: unknown): ManualSourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualSourceRef[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const kind = SOURCE_KINDS.includes((item as any).kind)
      ? (item as any).kind
      : 'code';
    const label = String((item as any).label ?? (item as any).path ?? '')
      .trim()
      .slice(0, 200);
    if (!label) continue;
    const ref: ManualSourceRef = { kind, label };
    for (const key of ['repo', 'path', 'url'] as const) {
      const value = (item as any)[key];
      if (typeof value === 'string' && value.trim())
        ref[key] = value.trim().slice(0, 300);
    }
    out.push(ref);
  }
  return out;
}

/** The model reads the detailed error; the person reads a plain sentence. */
/** A short, plain reason a tool call failed, for the run's item log. */
function failureNote(outcome: ManualToolOutcome): string {
  try {
    const parsed = JSON.parse(outcome.modelResult);
    const error = typeof parsed?.error === 'string' ? parsed.error : '';
    if (error) return error.replace(/\s+/g, ' ').slice(0, 80);
  } catch {
    // fall through to the plain sentence
  }
  return String(outcome.summary ?? 'failed').slice(0, 80);
}

const fail = (message: string, summary: string): ManualToolOutcome => ({
  modelResult: JSON.stringify({ ok: false, error: message }),
  summary,
  ok: false,
});

const count = (list: unknown, one: string, many = `${one}s`): string => {
  const n = Array.isArray(list) ? list.length : 0;
  if (n === 0) return `No ${many}`;
  return `${n} ${n === 1 ? one : many}`;
};

const bound = (serialised: string): string =>
  serialised.length <= MANUAL_CHAT_LIMITS.TOOL_RESULT_MAX_CHARS
    ? serialised
    : `${serialised.slice(0, MANUAL_CHAT_LIMITS.TOOL_RESULT_MAX_CHARS)}… [truncated — narrow the lookup]`;
