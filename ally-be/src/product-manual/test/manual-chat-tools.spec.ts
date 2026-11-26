import { ManualWriteError } from '../type/manual.types';
import {
  ManualChatToolsService,
  newToolContext,
} from '../service/manual-chat-tools.service';

const page = (slug: string, title = slug) => ({
  id: `id-${slug}`,
  slug,
  title,
  summary: 's',
  body: 'old body',
  kind: 'page',
  roles: [],
  surfaces: [],
  journeys: [],
  releaseState: 'live',
  parentSlug: null,
  verifiedAt: null,
  updatedAt: new Date('2026-11-01'),
});

function setup() {
  const pages = {
    getBySlug: jest.fn(async (slug: string) =>
      ['running-a-roleplay', 'roleplays'].includes(slug)
        ? page(slug, `Title ${slug}`)
        : null,
    ),
    write: jest.fn(async (...args: any[]) => ({
      page: {
        ...page(args[0].slug),
        title: args[0].title ?? `Title ${args[0].slug}`,
      },
      revision: { id: 'rev-1' },
      changed: true,
      created: false,
    })),
    markVerified: jest.fn().mockResolvedValue(undefined),
  };
  const search = {
    search: jest.fn().mockResolvedValue([
      {
        slug: 'roleplays',
        title: 'Roleplays',
        parentTitle: null,
        snippet: 'a <mark>b</mark>',
        rank: 1,
      },
    ]),
  };
  const scrub = {
    check: jest.fn((text: string) =>
      /sk-/.test(text)
        ? { ok: false, reason: 'it contains an API key' }
        : { ok: true },
    ),
  };
  const proposals = {
    create: jest.fn().mockResolvedValue({ id: 'prop-1' }),
    markApplied: jest.fn().mockResolvedValue(undefined),
    dismiss: jest.fn().mockResolvedValue(undefined),
  };
  const githubRead = {
    isConfigured: true,
    searchCode: jest.fn().mockResolvedValue({ ok: true, results: [] }),
    readFile: jest.fn().mockResolvedValue({ ok: true, content: '' }),
    repoTree: jest.fn().mockResolvedValue({ ok: true, files: [] }),
  };
  const roadmapItems = {
    search: jest.fn().mockResolvedValue({
      items: [
        {
          code: 'OPP-1',
          title: 'T',
          stage: 'Backlog',
          votes: 2,
          releasedAt: null,
        },
      ],
      recent: [],
    }),
  };
  const analytics = {
    ask: jest.fn().mockResolvedValue({ ok: true, answer: '42' }),
  };
  const tools = new ManualChatToolsService(
    pages as never,
    search as never,
    scrub as never,
    proposals as never,
    githubRead as never,
    roadmapItems as never,
    analytics as never,
  );
  return {
    tools,
    pages,
    search,
    scrub,
    proposals,
    githubRead,
    roadmapItems,
    analytics,
  };
}

const chatCtx = (over: Record<string, unknown> = {}) =>
  newToolContext({
    mode: 'chat',
    userId: 7,
    ref: 'conv-1',
    editsAllowed: true,
    analytics: false,
    emit: jest.fn(),
    // The file `edit` cites, as if read earlier in the turn (the evidence rule).
    filesRead: new Set(['ally-web:apps/x.tsx']),
    ...over,
  });

const names = (defs: { name: string }[]) => defs.map((d) => d.name);
const edit = {
  slug: 'running-a-roleplay',
  newBody: 'new body',
  reason: 'The start button moved.',
  sources: [
    {
      kind: 'code',
      label: 'ally-web start screen',
      repo: 'ally-web',
      path: 'apps/x.tsx',
    },
  ],
};

describe('ManualChatToolsService', () => {
  it('offers the contract tools to the chat, and never the weekly-only ones', () => {
    const { tools } = setup();
    expect(
      names(tools.getToolDefinitions(chatCtx({ analytics: true }))),
    ).toEqual([
      'search_manual',
      'read_manual_page',
      'search_roadmap',
      'github_search_code',
      'github_read_file',
      'github_repo_tree',
      'analytics_ask',
      'edit_manual_page',
      'create_manual_page',
      'propose_draft',
      'log_gap',
    ]);
  });

  it('gives the weekly agent read, edit, verify and proposal tools only', () => {
    const { tools } = setup();
    const ctx = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
    });
    expect(names(tools.getToolDefinitions(ctx))).toEqual([
      'search_manual',
      'read_manual_page',
      'github_search_code',
      'github_read_file',
      'github_repo_tree',
      'edit_manual_page',
      'create_manual_page',
      'mark_verified',
      'apply_proposal',
      'dismiss_proposal',
    ]);
  });

  it('withholds the edit tools when edits are not allowed, and refuses a call to them', async () => {
    const { tools, pages } = setup();
    const ctx = chatCtx({ editsAllowed: false });
    const offered = names(tools.getToolDefinitions(ctx));
    expect(offered).not.toContain('edit_manual_page');
    expect(offered).not.toContain('create_manual_page');
    const outcome = await tools.execute('edit_manual_page', edit, ctx);
    expect(outcome.ok).toBe(false);
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('leaves analytics_ask out without the analytics_agent toggle', async () => {
    const { tools, analytics } = setup();
    const ctx = chatCtx({ analytics: false });
    expect(names(tools.getToolDefinitions(ctx))).not.toContain('analytics_ask');
    expect(
      (await tools.execute('analytics_ask', { question: 'q' }, ctx)).ok,
    ).toBe(false);
    expect(analytics.ask).not.toHaveBeenCalled();
  });

  it('edits through the single writer as the chat agent and emits page_edited', async () => {
    const { tools, pages } = setup();
    const ctx = chatCtx();
    const outcome = await tools.execute('edit_manual_page', edit, ctx);
    expect(outcome.ok).toBe(true);
    expect(pages.write).toHaveBeenCalledWith(
      { slug: 'running-a-roleplay', body: 'new body' },
      expect.objectContaining({
        kind: 'chat_agent',
        ref: 'conv-1',
        reason: 'The start button moved.',
        sourceRefs: [
          expect.objectContaining({ kind: 'code', path: 'apps/x.tsx' }),
        ],
      }),
      7,
    );
    expect(ctx.emit).toHaveBeenCalledWith('page_edited', {
      slug: 'running-a-roleplay',
      title: 'Title running-a-roleplay',
      revisionId: 'rev-1',
      reason: 'The start button moved.',
    });
    expect(ctx.edits).toHaveLength(1);
  });

  it('surfaces a scrubber rejection as a tool error without writing', async () => {
    const { tools, pages } = setup();
    const outcome = await tools.execute(
      'edit_manual_page',
      { ...edit, newBody: 'key sk-abcdef' },
      chatCtx(),
    );
    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult).error).toMatch(
      /scrubber: it contains an API key/,
    );
    expect(pages.write).not.toHaveBeenCalled();
  });

  it("turns the writer's ManualWriteError into a readable tool error", async () => {
    const { tools, pages } = setup();
    pages.write.mockRejectedValueOnce(
      new ManualWriteError('scrubbed', 'It contains an email address.'),
    );
    const outcome = await tools.execute('edit_manual_page', edit, chatCtx());
    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult)).toEqual({
      ok: false,
      error: 'It contains an email address.',
    });
  });

  it('requires a reason and a source for an edit', async () => {
    const { tools, pages } = setup();
    const noSource = await tools.execute(
      'edit_manual_page',
      { ...edit, sources: [] },
      chatCtx(),
    );
    const noReason = await tools.execute(
      'edit_manual_page',
      { ...edit, reason: ' ' },
      chatCtx(),
    );
    expect([noSource.ok, noReason.ok]).toEqual([false, false]);
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('emits a draft frame and keeps the card in the tray, without touching the roadmap or proposals', async () => {
    const { tools, roadmapItems, proposals } = setup();
    const ctx = chatCtx();
    const outcome = await tools.execute(
      'propose_draft',
      {
        title: 'Let supervisors pin notes',
        text: 'Supervisors lose notes.',
        relatedSlugs: ['roleplays', 'nope'],
      },
      ctx,
    );
    expect(outcome.ok).toBe(true);
    expect(ctx.drafts).toHaveLength(1);
    expect(ctx.emit).toHaveBeenCalledWith('draft', {
      id: ctx.drafts[0].id,
      title: 'Let supervisors pin notes',
      text: 'Supervisors lose notes.',
      relatedPages: [{ slug: 'roleplays', title: 'Title roleplays' }],
    });
    expect(roadmapItems.search).not.toHaveBeenCalled();
    expect(proposals.create).not.toHaveBeenCalled();
  });

  it('logs a gap as a chat proposal', async () => {
    const { tools, proposals } = setup();
    await tools.execute(
      'log_gap',
      { question: 'How do refunds work?' },
      chatCtx(),
    );
    expect(proposals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'gap',
        source: 'chat',
        summary: 'How do refunds work?',
        submittedBy: 7,
      }),
    );
  });

  it('refuses a repo outside the allow-list', async () => {
    const { tools, githubRead } = setup();
    const outcome = await tools.execute(
      'github_read_file',
      { repo: 'some-other-repo', path: 'x' },
      chatCtx(),
    );
    expect(outcome.ok).toBe(false);
    expect(githubRead.readFile).not.toHaveBeenCalled();
  });

  it('records searched and read pages for citations', async () => {
    const { tools } = setup();
    const ctx = chatCtx();
    await tools.execute('search_manual', { query: 'roleplay' }, ctx);
    await tools.execute(
      'read_manual_page',
      { slug: 'running-a-roleplay' },
      ctx,
    );
    expect([...ctx.seen.keys()]).toEqual(['roleplays']);
    expect([...ctx.read.keys()]).toEqual(['running-a-roleplay']);
  });

  it('authors weekly edits as the proposal when applying one, and resolves only that proposal', async () => {
    const { tools, pages, proposals } = setup();
    const ctx = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      proposal: { id: 'prop-9', kind: 'edit' } as never,
      verifiedRef: 'abc123',
    });
    await tools.execute('edit_manual_page', edit, ctx);
    expect(pages.write.mock.calls[0][1]).toMatchObject({
      kind: 'proposal',
      ref: 'prop-9',
    });
    expect(
      (await tools.execute('apply_proposal', { proposalId: 'other' }, ctx)).ok,
    ).toBe(false);
    expect(
      (await tools.execute('apply_proposal', { proposalId: 'prop-9' }, ctx)).ok,
    ).toBe(true);
    expect(proposals.markApplied).toHaveBeenCalledWith('prop-9', 'rev-1');
    await tools.execute('mark_verified', { slug: 'running-a-roleplay' }, ctx);
    expect(pages.markVerified).toHaveBeenCalledWith(
      'running-a-roleplay',
      'abc123',
    );
  });

  it('authors weekly edits as the weekly agent with the run id otherwise', async () => {
    const { tools, pages } = setup();
    const ctx = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      filesRead: new Set(['ally-web:apps/x.tsx']),
    });
    await tools.execute('edit_manual_page', edit, ctx);
    expect(pages.write.mock.calls[0][1]).toMatchObject({
      kind: 'weekly_agent',
      ref: 'run-1',
    });
  });
});

describe('ManualChatToolsService without GitHub', () => {
  it('offers no github_* tools to the chat or the weekly agent, and no mark_verified to the weekly agent', () => {
    const { tools, githubRead } = setup();
    (githubRead as any).isConfigured = false;
    expect(tools.codeSearchAvailable()).toBe(false);
    const chat = names(tools.getToolDefinitions(chatCtx()));
    const weekly = names(
      tools.getToolDefinitions(
        newToolContext({
          mode: 'weekly',
          userId: null,
          ref: 'r',
          editsAllowed: true,
        }),
      ),
    );
    for (const list of [chat, weekly]) {
      expect(list.filter((n) => n.startsWith('github_'))).toEqual([]);
    }
    expect(weekly).not.toContain('mark_verified');
    expect(chat).toContain('search_manual');
  });
});

describe('ManualChatToolsService failure summaries', () => {
  it('maps error codes to plain sentences for the activity feed', async () => {
    const { tools, githubRead } = setup();
    githubRead.searchCode.mockResolvedValueOnce({
      ok: false,
      error: 'github_not_configured',
      message: 'GITHUB_TOKEN is not set',
    });
    const outcome = await tools.execute(
      'github_search_code',
      { query: 'x' },
      chatCtx(),
    );
    expect(outcome.summary).toBe("Code search isn't available right now");
    // The model still gets the detail.
    expect(JSON.parse(outcome.modelResult).error).toBe('github_not_configured');
  });

  it('never shows snake_case or internal codes in a failure summary', async () => {
    const { tools, pages } = setup();
    const ctx = chatCtx();
    pages.write.mockRejectedValueOnce(new Error('invalid_slug: bad'));
    const outcomes = [
      await tools.execute('read_manual_page', { slug: 'no-such-page' }, ctx),
      await tools.execute('edit_manual_page', edit, ctx),
      await tools.execute('mark_verified', { slug: 'x' }, ctx),
      await tools.execute('github_read_file', { repo: 'nope', path: 'x' }, ctx),
    ];
    expect(outcomes.map((o) => o.summary)).toEqual([
      "Couldn't read that page",
      "Couldn't update the page",
      "That step isn't available here",
      "Couldn't read that file",
    ]);
    for (const o of outcomes) expect(o.summary).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('tells the model a draft is only a card until the user presses Save', async () => {
    const { tools } = setup();
    const outcome = await tools.execute(
      'propose_draft',
      { title: 'Idea', text: 'Why' },
      chatCtx(),
    );
    expect(JSON.parse(outcome.modelResult).note).toBe(
      'Shown to the user as a draft card in their drafts tray. It is NOT saved to their roadmap drafts until they press Save.',
    );
  });

  it('returns search snippets as plain text', async () => {
    const { tools, search } = setup();
    search.search.mockResolvedValueOnce([
      {
        slug: 'badges',
        title: 'Badges',
        parentTitle: null,
        snippet:
          'the <mark>&quot;new badge&quot;</mark> &amp; &lt;tag&gt; it&#39;s',
        rank: 1,
      },
    ]);
    const outcome = await tools.execute(
      'search_manual',
      { query: 'badge' },
      chatCtx(),
    );
    expect(JSON.parse(outcome.modelResult).results[0].snippet).toBe(
      `the "new badge" & <tag> it's`,
    );
  });
});

describe('ManualChatToolsService evidence rule', () => {
  const bare = (over: Record<string, unknown> = {}) =>
    newToolContext({
      mode: 'chat',
      userId: 7,
      ref: 'conv-1',
      editsAllowed: true,
      ...over,
    });

  it('rejects an edit whose code source was not read this turn', async () => {
    const { tools, pages } = setup();
    const outcome = await tools.execute('edit_manual_page', edit, bare());
    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult).error).toMatch(
      /^Read the file first/,
    );
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('rejects an edit citing only non-code sources', async () => {
    const { tools, pages } = setup();
    const outcome = await tools.execute(
      'edit_manual_page',
      { ...edit, sources: [{ kind: 'wiki', label: 'a wiki page' }] },
      bare({ filesRead: new Set(['ally-web:apps/x.tsx']) }),
    );
    expect(outcome.ok).toBe(false);
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('accepts the edit once the cited file was read with github_read_file', async () => {
    const { tools, pages } = setup();
    const ctx = bare();
    await tools.execute(
      'github_read_file',
      { repo: 'ally-web', path: './apps/x.tsx' },
      ctx,
    );
    expect([...ctx.filesRead]).toEqual(['ally-web:apps/x.tsx']);
    // Cited with the service folder in front: the same file.
    const outcome = await tools.execute(
      'edit_manual_page',
      {
        ...edit,
        sources: [
          {
            kind: 'code',
            label: 'x',
            repo: 'ally-web',
            path: 'ally-web/apps/x.tsx',
          },
        ],
      },
      ctx,
    );
    expect(outcome.ok).toBe(true);
    expect(pages.write).toHaveBeenCalled();
  });

  it('does not count a failed read as read', async () => {
    const { tools, githubRead } = setup();
    githubRead.readFile.mockResolvedValueOnce({
      ok: false,
      error: 'read_failed',
    });
    const ctx = bare();
    await tools.execute(
      'github_read_file',
      { repo: 'ally-web', path: 'apps/x.tsx' },
      ctx,
    );
    expect(ctx.filesRead.size).toBe(0);
  });

  it('lets an edit applying a proposal cite the proposal, added automatically', async () => {
    const { tools, pages } = setup();
    const ctx = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      proposal: {
        id: 'prop-9',
        kind: 'edit',
        prRef: 'https://example.test/pr/1',
      } as never,
    });
    const outcome = await tools.execute(
      'edit_manual_page',
      { ...edit, sources: [] },
      ctx,
    );
    expect(outcome.ok).toBe(true);
    expect(pages.write.mock.calls[0][1].sourceRefs).toEqual([
      {
        kind: 'pr',
        label: 'Proposal prop-9',
        url: 'https://example.test/pr/1',
      },
    ]);
  });

  it('withholds chat edits when the code cannot be read, but not proposal edits', () => {
    const { tools, githubRead } = setup();
    (githubRead as any).isConfigured = false;
    expect(names(tools.getToolDefinitions(bare()))).not.toContain(
      'edit_manual_page',
    );
    const weeklyProposal = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'r',
      editsAllowed: true,
      proposal: { id: 'p', kind: 'edit' } as never,
    });
    expect(names(tools.getToolDefinitions(weeklyProposal))).toContain(
      'edit_manual_page',
    );
  });
});

describe('agent prompts: truth, not polish', () => {
  it('protect "Needs confirmation:" lines and forbid taste edits in both prompts', () => {
    const c = require('../constants/manual-agent.constants');
    for (const prompt of [
      c.MANUAL_CHAT_SYSTEM_PROMPT,
      c.MANUAL_WEEKLY_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain(
        '"Needs confirmation:" are deliberate open questions',
      );
      expect(prompt).toContain(
        'Do not change naming, labels, tone or structure',
      );
      expect(prompt).toContain(
        'Labels and button names are copied exactly from code you read',
      );
    }
  });
});

describe('ManualChatToolsService proposal kinds', () => {
  const weekly = (
    proposal: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) =>
    newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      proposal: proposal as never,
      ...over,
    });
  const newPage = {
    slug: 'brand-new',
    title: 'Brand new',
    summary: 's',
    body: 'b',
    parentSlug: 'roleplays',
    reason: 'Proposal says so.',
    sources: [],
  };

  it('does not accept a gap proposal as evidence for its own answer', async () => {
    const { tools, pages } = setup();
    const outcome = await tools.execute(
      'edit_manual_page',
      { ...edit, sources: [] },
      weekly({ id: 'gap-1', kind: 'gap' }),
    );
    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult).error).toMatch(
      /^Read the file first/,
    );
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('answers a gap once the cited code was read', async () => {
    const { tools, pages } = setup();
    const outcome = await tools.execute(
      'edit_manual_page',
      edit,
      weekly(
        { id: 'gap-1', kind: 'gap' },
        { filesRead: new Set(['ally-web:apps/x.tsx']) },
      ),
    );
    expect(outcome.ok).toBe(true);
    expect(pages.write).toHaveBeenCalled();
  });

  it('withholds the edit tools for a gap when the code cannot be read', () => {
    const { tools, githubRead } = setup();
    (githubRead as any).isConfigured = false;
    expect(
      names(tools.getToolDefinitions(weekly({ id: 'g', kind: 'gap' }))),
    ).not.toContain('create_manual_page');
    expect(
      names(tools.getToolDefinitions(weekly({ id: 'n', kind: 'new_page' }))),
    ).toContain('create_manual_page');
  });

  it('creates a page only for a new_page proposal, under an existing section', async () => {
    const { tools, pages } = setup();
    const forEdit = await tools.execute(
      'create_manual_page',
      newPage,
      weekly({ id: 'e', kind: 'edit' }),
    );
    expect(JSON.parse(forEdit.modelResult).error).toMatch(
      /only for a new_page proposal/,
    );
    const forGap = await tools.execute(
      'create_manual_page',
      newPage,
      weekly(
        { id: 'g', kind: 'gap' },
        { filesRead: new Set(['ally-web:apps/x.tsx']) },
      ),
    );
    expect(forGap.ok).toBe(false);
    const noParent = await tools.execute(
      'create_manual_page',
      { ...newPage, parentSlug: undefined },
      weekly({ id: 'n', kind: 'new_page' }),
    );
    expect(JSON.parse(noParent.modelResult).error).toMatch(
      /needs a parentSlug/,
    );
    const missingParent = await tools.execute(
      'create_manual_page',
      { ...newPage, parentSlug: 'no-such-section' },
      weekly({ id: 'n', kind: 'new_page' }),
    );
    expect(JSON.parse(missingParent.modelResult).error).toMatch(
      /No parent section/,
    );
    expect(pages.write).not.toHaveBeenCalled();

    const ok = await tools.execute(
      'create_manual_page',
      newPage,
      weekly({ id: 'n', kind: 'new_page' }),
    );
    expect(ok.ok).toBe(true);
    expect(pages.write.mock.calls[0][1]).toMatchObject({
      kind: 'proposal',
      ref: 'n',
    });
  });

  it('tells the weekly agent to write only what the proposal states, and that a gap is a question', () => {
    const c = require('../constants/manual-agent.constants');
    expect(c.MANUAL_WEEKLY_SYSTEM_PROMPT).toContain(
      "Write ONLY what the proposal's summary and detail state",
    );
    expect(c.MANUAL_WEEKLY_SYSTEM_PROMPT).toContain(
      'A gap proposal is a question the manual could not answer, not a statement of change',
    );
  });
});

describe('ManualChatToolsService weekly lookup budget and trace', () => {
  const weekly = (over: Record<string, unknown> = {}) =>
    newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      lookupBudget: { code: 2, manual: 1 },
      ...over,
    });

  it('refuses a code lookup past the budget with an instruction to decide, without running it', async () => {
    const { tools, githubRead } = setup();
    const ctx = weekly();
    await tools.execute('github_search_code', { query: 'a' }, ctx);
    await tools.execute('github_search_code', { query: 'b' }, ctx);
    const third = await tools.execute(
      'github_search_code',
      { query: 'c' },
      ctx,
    );
    expect(third.ok).toBe(false);
    expect(JSON.parse(third.modelResult).error).toMatch(
      /Lookup budget used.*Decide now/,
    );
    expect(githubRead.searchCode).toHaveBeenCalledTimes(2);
    // Reading a file and listing a folder draw on the same code budget.
    const read = await tools.execute(
      'github_read_file',
      { repo: 'ally-web', path: 'x.tsx' },
      ctx,
    );
    expect(read.ok).toBe(false);
    expect(githubRead.readFile).not.toHaveBeenCalled();
  });

  it('keeps a separate budget for manual lookups, and never limits deciding', async () => {
    const { tools, pages } = setup();
    const ctx = weekly();
    expect(
      (await tools.execute('search_manual', { query: 'roleplay' }, ctx)).ok,
    ).toBe(true);
    const over = await tools.execute(
      'read_manual_page',
      { slug: 'running-a-roleplay' },
      ctx,
    );
    expect(over.ok).toBe(false);
    expect(JSON.parse(over.modelResult).error).toMatch(/manual lookups/);
    // The decision tools stay open however many lookups were made.
    const verified = await tools.execute(
      'mark_verified',
      { slug: 'running-a-roleplay' },
      ctx,
    );
    expect(verified.ok).toBe(true);
    expect(pages.markVerified).toHaveBeenCalled();
  });

  it('counts a failing lookup, because it still costs a step', async () => {
    const { tools, githubRead } = setup();
    githubRead.searchCode.mockResolvedValue({
      ok: false,
      error: 'search_failed',
    });
    const ctx = weekly();
    await tools.execute('github_search_code', { query: 'a' }, ctx);
    await tools.execute('github_search_code', { query: 'b' }, ctx);
    const third = await tools.execute(
      'github_search_code',
      { query: 'c' },
      ctx,
    );
    expect(JSON.parse(third.modelResult).error).toMatch(/Lookup budget used/);
    expect(githubRead.searchCode).toHaveBeenCalledTimes(2);
  });

  it('does not limit lookups when no budget is set (chat)', async () => {
    const { tools, githubRead } = setup();
    const ctx = chatCtx();
    for (let i = 0; i < 6; i += 1) {
      const out = await tools.execute(
        'github_search_code',
        { query: `q${i}` },
        ctx,
      );
      expect(out.ok).toBe(true);
    }
    expect(githubRead.searchCode).toHaveBeenCalledTimes(6);
  });

  it('records every call on the trace, with a short reason for a failure and never the page text', async () => {
    const { tools, githubRead } = setup();
    githubRead.searchCode.mockResolvedValueOnce({
      ok: false,
      error: 'GitHub returned 403: rate limit exceeded',
    });
    const ctx = weekly({ lookupBudget: { code: 1, manual: 3 } });
    await tools.execute('github_search_code', { query: 'a' }, ctx);
    await tools.execute('github_search_code', { query: 'b' }, ctx); // refused: over budget
    await tools.execute('search_manual', { query: 'roleplay' }, ctx);
    expect(ctx.trace).toEqual([
      {
        tool: 'github_search_code',
        ok: false,
        note: 'GitHub returned 403: rate limit exceeded',
      },
      {
        tool: 'github_search_code',
        ok: false,
        note: expect.stringMatching(/^Lookup budget used/),
      },
      { tool: 'search_manual', ok: true },
    ]);
    expect(JSON.stringify(ctx.trace)).not.toContain('a <mark>b</mark>');
  });
});

describe('ManualChatToolsService page protection', () => {
  const longBody = Array.from(
    { length: 12 },
    (_, i) => `Line ${i + 1}: some words here.`,
  ).join('\n\n');
  const withBody = (pages: any, body: string) =>
    pages.getBySlug.mockResolvedValue({ ...page('running-a-roleplay'), body });

  it('refuses a fragment sent in place of a long page, and writes nothing', async () => {
    const { tools, pages } = setup();
    withBody(pages, longBody);
    const outcome = await tools.execute(
      'edit_manual_page',
      {
        ...edit,
        newBody:
          'Summary: a proposal.\n\nDetail: its text.\n\nPR: fix/something',
      },
      chatCtx(),
    );
    expect(outcome.ok).toBe(false);
    expect(JSON.parse(outcome.modelResult).error).toMatch(
      /remove most of the page.*WHOLE page/s,
    );
    expect(pages.write).not.toHaveBeenCalled();
  });

  it('lets a one-line change to a long page through', async () => {
    const { tools, pages } = setup();
    withBody(pages, longBody);
    const outcome = await tools.execute(
      'edit_manual_page',
      {
        ...edit,
        newBody: longBody.replace('Line 3: some', 'Line 3 (fixed): some'),
      },
      chatCtx(),
    );
    expect(outcome.ok).toBe(true);
    expect(pages.write).toHaveBeenCalledTimes(1);
  });

  it('refuses the same fragment from the weekly agent applying a proposal', async () => {
    const { tools, pages } = setup();
    withBody(pages, longBody);
    const ctx = newToolContext({
      mode: 'weekly',
      userId: null,
      ref: 'run-1',
      editsAllowed: true,
      proposal: { id: 'prop-1', kind: 'edit', summary: 's' } as never,
    });
    const outcome = await tools.execute(
      'edit_manual_page',
      {
        slug: 'running-a-roleplay',
        newBody: 'Summary: only the proposal text.',
        reason: 'Applying the proposal.',
        sources: [{ kind: 'pr', label: 'Proposal prop-1' }],
      },
      ctx,
    );
    expect(outcome.ok).toBe(false);
    expect(pages.write).not.toHaveBeenCalled();
    expect(ctx.trace[0]).toMatchObject({ tool: 'edit_manual_page', ok: false });
  });

  it('still lets a small page be rewritten freely', async () => {
    const { tools, pages } = setup(); // the default page body is a single short line
    const outcome = await tools.execute(
      'edit_manual_page',
      { ...edit, newBody: 'A completely different short body.' },
      chatCtx(),
    );
    expect(outcome.ok).toBe(true);
    expect(pages.write).toHaveBeenCalledTimes(1);
  });
});
