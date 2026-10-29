import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BuilderDecisionService } from '../builder-decision.service';
import {
  BuilderMessageRole,
  BuilderSessionStatus,
} from '../../enum/builder.enum';
import { parseDecisionId } from '../../type/builder-decision.type';

/**
 * The decision feed derives, it never stores — so what these tests pin down
 * is the derivation: which state counts as "waiting on a person", which does
 * not, and that an answer goes to exactly the service call the session page
 * would have made for the same click.
 */
describe('BuilderDecisionService', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const earlier = new Date('2026-10-28T09:00:00Z');

  const session = (over: Record<string, any> = {}) => ({
    id: 'sess-1',
    title: 'Weekly digest email',
    status: BuilderSessionStatus.INTERVIEWING,
    repos: ['ally-be'],
    budgetUsd: null,
    totalCostUsd: '0',
    error: null,
    createdBy: 7,
    archivedAt: null,
    updatedAt: now,
    createdAt: earlier,
    ...over,
  });

  const question = (over: Record<string, any> = {}) => ({
    id: 'q-1',
    prompt: 'Should the digest go out on Monday or Friday?',
    kind: 'singleSelect',
    rationale: 'Based on: X1\nYours to decide because: both are supported.',
    questionType: 'behaviour',
    options: [
      { id: 'mon', label: 'Monday', recommended: true },
      { id: 'fri', label: 'Friday' },
    ],
    allowCustom: true,
    ...over,
  });

  const assistantRow = (
    metadata: Record<string, any>,
    over: Record<string, any> = {},
  ) => ({
    id: 'm-2',
    seq: 2,
    role: BuilderMessageRole.ASSISTANT,
    content: 'I read the scheduler. One thing I cannot settle:',
    metadata,
    createdAt: earlier,
    ...over,
  });

  const build = (over: Record<string, any> = {}) => {
    const sessions = over.sessions ?? [session()];
    const messages: Record<string, any[]> = over.messages ?? {};
    const pullRequests = over.pullRequests ?? [];
    const sessionRepository = {
      find: jest.fn().mockResolvedValue(sessions),
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          sessions.find((entry: any) => entry.id === where.id) ?? null,
        ),
      ),
      findCreatorNames: jest.fn().mockResolvedValue(new Map([[7, 'Sandeep']])),
    };
    const messageRepository = {
      listBySession: jest.fn((id: string) =>
        Promise.resolve(messages[id] ?? []),
      ),
    };
    const pullRequestRepository = {
      find: jest.fn().mockResolvedValue(pullRequests),
    };
    const prdService = {
      getOrCreateDoc: jest.fn().mockResolvedValue(
        over.doc ?? {
          draft: {
            summary: 'A weekly digest of what shipped.',
            title: 'Digest',
          },
          versionNumber: 3,
        },
      ),
    };
    const buildService = {
      startBuild: jest.fn().mockResolvedValue({ id: 'run-1' }),
      startDesign: jest.fn().mockResolvedValue({ id: 'run-2' }),
      approveDesign: jest.fn().mockResolvedValue({ status: 'approved' }),
      raiseBudget: jest.fn().mockResolvedValue({}),
    };
    const pullRequestService = {
      mergePullRequest: jest.fn().mockResolvedValue({}),
      resumeAutomation: jest.fn().mockResolvedValue({}),
    };
    const sessionService = {
      getSession: jest.fn((id: string) => {
        const found = sessions.find((entry: any) => entry.id === id);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new Error('404'));
      }),
      cancelSession: jest.fn().mockResolvedValue({}),
      archiveSession: jest.fn().mockResolvedValue({}),
    };
    const frames: any[] = over.frames ?? [{ event: 'done', data: {} }];
    const streamTurn = jest.fn(async function* () {
      for (const frame of frames) yield frame;
    }) as unknown as jest.Mock<
      AsyncGenerator<any>,
      [string, Record<string, any>, number]
    >;
    const orchestrator = { streamTurn };
    const store = new Map<string, string>();
    const redisService = {
      acquireLock: jest.fn().mockResolvedValue(over.locked ?? true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
      getByPattern: jest.fn(() =>
        Promise.resolve([...store.keys()].map((key) => `ally:${key}`)),
      ),
    };
    const historyService = {
      recordDecision: jest.fn().mockResolvedValue({ id: 'h-1' }),
      markApplied: jest.fn().mockResolvedValue(undefined),
      markUndone: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BuilderDecisionService(
      sessionRepository as never,
      messageRepository as never,
      pullRequestRepository as never,
      prdService as never,
      buildService as never,
      pullRequestService as never,
      sessionService as never,
      orchestrator as never,
      redisService as never,
      historyService as never,
    );
    return {
      service,
      // The session page's path: applied at once, no undo window.
      answer: (id: string, dto: Record<string, any>, userId = 42) =>
        service.answer(id, dto, userId, { surface: 'session' }),
      historyService,
      store,
      buildService,
      pullRequestService,
      sessionService,
      streamTurn,
      redisService,
      prdService,
    };
  };

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const pullRequest = (over: Record<string, any> = {}) => ({
    id: 'pr-1',
    sessionId: 'sess-1',
    repo: 'ally-platform',
    prNumber: 61,
    prUrl: 'https://github.com/x/y/pull/61',
    title: 'feat: digest',
    state: 'open',
    merged: false,
    ciStatus: 'success',
    fixRunCount: 0,
    needsHumanAt: null,
    needsHumanReason: null,
    escalationResolution: null,
    mergePromptedAt: null,
    ...over,
  });

  const pendingStub = (id: string, optionIds: string[]): any => ({
    id,
    kind: id.split(':')[0],
    category: 'what',
    sessionId: 'sess-1',
    sessionTitle: 'Weekly digest email',
    prompt: 'Stub',
    options: optionIds.map((option) => ({ id: option, label: option })),
    waitingSince: earlier.toISOString(),
    questionType: null,
  });

  describe('listPending', () => {
    it('surfaces the last assistant row’s unanswered question, with its context', async () => {
      const { service } = build({
        messages: {
          'sess-1': [
            {
              id: 'm-1',
              seq: 1,
              role: BuilderMessageRole.USER,
              content: 'Build me a digest',
            },
            assistantRow({ questions: [question()] }),
          ],
        },
      });

      const decisions = await service.listPending();

      expect(decisions).toHaveLength(1);
      const [decision] = decisions;
      expect(decision.id).toBe('question:sess-1:q-1');
      expect(decision.kind).toBe('question');
      expect(decision.category).toBe('what');
      expect(decision.questionType).toBe('behaviour');
      expect(decision.options.map((option) => option.id)).toEqual([
        'mon',
        'fri',
      ]);
      expect(decision.allowCustom).toBe(true);
      expect(decision.createdByName).toBe('Sandeep');
      expect(decision.context[0]).toContain('Builder said:');
      expect(decision.context).toContainEqual(
        expect.stringContaining('A weekly digest of what shipped.'),
      );
      expect(decision.waitingSince).toBe(earlier.toISOString());
    });

    it('does not re-ask a question a later user row has answered', async () => {
      const { service } = build({
        messages: {
          'sess-1': [
            assistantRow({ questions: [question()] }),
            {
              id: 'm-3',
              seq: 3,
              role: BuilderMessageRole.USER,
              content: '[answers question q-1] Monday',
              metadata: { questionId: 'q-1' },
            },
          ],
        },
      });

      expect(await service.listPending()).toEqual([]);
    });

    it('ignores a row whose turn is still streaming', async () => {
      const { service } = build({
        messages: {
          'sess-1': [
            assistantRow({ questions: [question()], streaming: true }),
          ],
        },
      });

      expect(await service.listPending()).toEqual([]);
    });

    it('offers the situation brief as one confirm-all decision', async () => {
      const { service } = build({
        messages: {
          'sess-1': [
            assistantRow({
              situationBrief: {
                id: 'brief-1',
                message: 'What I found',
                lines: [
                  {
                    id: 'X1',
                    kind: 'exists',
                    text: 'A digest job exists',
                    cites: [],
                  },
                  { id: 'P1', kind: 'proposal', text: 'Extend it', cites: [] },
                ],
              },
            }),
          ],
        },
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('brief');
      expect(decision.id).toBe('brief:sess-1:brief-1');
      expect(decision.options).toEqual([
        expect.objectContaining({ id: 'confirm_all', recommended: true }),
      ]);
      expect(decision.context).toEqual([
        'X1: A digest job exists',
        'P1: Extend it',
      ]);
    });

    it('asks to start the build when the PRD is ready and the design is approved and fresh', async () => {
      // productHashOf is deterministic over the product fields, so a design
      // whose hash was computed from this very draft reads as fresh.
      const { productHashOf } = jest.requireActual(
        '../../util/builder-technical-design.util',
      );
      const draft = {
        title: 'Digest',
        summary: 'A weekly digest.',
        requirements: [],
        assumptions: [],
        technicalPlan: { repos: [], dataModelMd: '', apiMd: '' },
      } as any;
      draft.technicalDesign = {
        status: 'approved',
        productHash: productHashOf(draft),
        draftedAt: earlier.toISOString(),
        openDecisions: [],
      };
      const { service } = build({
        sessions: [session({ status: BuilderSessionStatus.PRD_READY })],
        doc: { draft, versionNumber: 4 },
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('start_build');
      expect(decision.options.map((option) => option.id)).toEqual(['start']);
      expect(decision.context[0]).toBe('Technical design approved.');
    });

    it('asks to draft the design first when the ready PRD has none', async () => {
      const { service } = build({
        sessions: [session({ status: BuilderSessionStatus.PRD_READY })],
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('start_build');
      expect(decision.options.map((option) => option.id)).toEqual(['design']);
    });

    it('asks to approve a design in review, recommending redraft while it has blockers', async () => {
      const { service } = build({
        sessions: [session({ status: BuilderSessionStatus.PRD_READY })],
        doc: {
          draft: {
            summary: 'A weekly digest.',
            technicalDesign: {
              status: 'review',
              productHash: 'x',
              draftedAt: earlier.toISOString(),
              designMd: '',
              scope: [],
              contracts: [],
              compatibilityMd: '',
              testMap: [],
              openDecisions: ['Which queue?'],
              review: null,
            },
          },
          versionNumber: 4,
        },
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('design_review');
      expect(decision.category).toBe('how');
      expect(
        decision.options.find((option) => option.id === 'approve')?.recommended,
      ).toBe(false);
      expect(
        decision.options.find((option) => option.id === 'redraft')?.recommended,
      ).toBe(true);
      expect(decision.context[0]).toContain('Which queue?');
    });

    it('raises a budget decision for a building session past its ceiling', async () => {
      const { service } = build({
        sessions: [
          session({
            status: BuilderSessionStatus.BUILDING,
            budgetUsd: '25',
            totalCostUsd: '26.4',
          }),
        ],
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('budget');
      expect(decision.category).toBe('issue');
      expect(decision.options.map((option) => option.id)).toEqual([
        'raise_10',
        'raise_25',
        'uncap',
        'stop',
      ]);
      expect(decision.options[0].label).toBe('Raise by $10 (to $37.00)');
      // Only the hard-to-undo options ask for a second press.
      expect(
        decision.options
          .filter((option) => option.confirm)
          .map((option) => option.id),
      ).toEqual(['uncap', 'stop']);
    });

    it('says nothing about a building session within budget', async () => {
      const { service } = build({
        sessions: [
          session({
            status: BuilderSessionStatus.BUILDING,
            budgetUsd: '25',
            totalCostUsd: '3',
          }),
        ],
      });

      expect(await service.listPending()).toEqual([]);
    });

    it('turns pull requests into merge and needs-you decisions, skipping closed ones', async () => {
      const { service } = build({
        sessions: [session({ status: BuilderSessionStatus.COMPLETED })],
        pullRequests: [
          {
            id: 'pr-1',
            sessionId: 'sess-1',
            repo: 'ally-be',
            prNumber: 12,
            prUrl: 'https://github.com/x/y/pull/12',
            title: 'feat: digest',
            state: 'open',
            merged: false,
            mergePromptedAt: earlier,
            needsHumanAt: null,
            escalationResolution: null,
            fixRunCount: 0,
            ciStatus: 'success',
          },
          {
            id: 'pr-2',
            sessionId: 'sess-1',
            repo: 'ally-web',
            prNumber: 4,
            prUrl: 'https://github.com/x/z/pull/4',
            state: 'open',
            merged: false,
            mergePromptedAt: null,
            needsHumanAt: now,
            needsHumanReason: '3 fix rounds and 2 problems remain.',
            escalationResolution: null,
            fixRunCount: 3,
            ciStatus: 'failure',
          },
          {
            id: 'pr-3',
            sessionId: 'sess-1',
            repo: 'ally-web',
            prNumber: 5,
            prUrl: 'https://github.com/x/z/pull/5',
            state: 'closed',
            merged: false,
            mergePromptedAt: earlier,
            needsHumanAt: null,
          },
        ],
      });

      const decisions = await service.listPending();

      expect(decisions.map((decision) => decision.id)).toEqual([
        'pr_merge:sess-1:pr-1',
        'pr_needs_human:sess-1:pr-2',
      ]);
      expect(decisions[0].pullRequestUrl).toBe(
        'https://github.com/x/y/pull/12',
      );
      expect(decisions[1].context[0]).toBe(
        '3 fix rounds and 2 problems remain.',
      );
      // A merge asks for a second press wherever it is offered; sending the
      // pull request back to Builder does not.
      expect(decisions[0].options.map((option) => option.confirm)).toEqual([
        true,
      ]);
      expect(
        decisions[1].options.map((option) => [option.id, option.confirm]),
      ).toEqual([
        ['resume', undefined],
        ['merge', true],
      ]);
    });

    it('recommends archiving a failed session whose work already opened pull requests', async () => {
      const { service } = build({
        sessions: [
          session({
            status: BuilderSessionStatus.FAILED,
            error: 'gate never passed',
          }),
        ],
        pullRequests: [
          {
            id: 'pr-1',
            sessionId: 'sess-1',
            repo: 'ally-be',
            prNumber: 12,
            prUrl: 'u',
            state: 'closed',
            merged: true,
            mergePromptedAt: null,
            needsHumanAt: null,
          },
        ],
      });

      const [decision] = await service.listPending();

      expect(decision.kind).toBe('build_failed');
      expect(decision.context[0]).toBe('gate never passed');
      expect(
        decision.options.find((option) => option.id === 'archive')?.recommended,
      ).toBe(true);
      expect(
        decision.options.find((option) => option.id === 'retry')?.recommended,
      ).toBe(false);
    });

    it('orders the feed oldest wait first across sessions', async () => {
      const { service } = build({
        sessions: [
          session({
            id: 'sess-1',
            status: BuilderSessionStatus.FAILED,
            updatedAt: now,
          }),
          session({
            id: 'sess-2',
            status: BuilderSessionStatus.FAILED,
            updatedAt: earlier,
          }),
        ],
      });

      const decisions = await service.listPending();

      expect(decisions.map((decision) => decision.sessionId)).toEqual([
        'sess-2',
        'sess-1',
      ]);
    });

    it('keeps the feed up when one session’s derivation throws', async () => {
      const { service, prdService } = build({
        sessions: [
          session({ id: 'sess-1', status: BuilderSessionStatus.PRD_READY }),
          session({ id: 'sess-2', status: BuilderSessionStatus.FAILED }),
        ],
      });
      prdService.getOrCreateDoc.mockRejectedValueOnce(new Error('boom'));

      const decisions = await service.listPending();

      expect(decisions.map((decision) => decision.sessionId)).toEqual([
        'sess-2',
      ]);
    });
  });

  describe('answer', () => {
    it('runs an interview turn in the background with the picked option, under the turn lock', async () => {
      const { answer, streamTurn, redisService } = build({
        messages: { 'sess-1': [assistantRow({ questions: [question()] })] },
      });

      const result = await answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );
      await flush();

      expect(result).toMatchObject({ ok: true, outcome: 'turn_started' });
      expect(redisService.acquireLock).toHaveBeenCalledWith(
        'builder-turn:sess-1',
        300,
      );
      expect(streamTurn).toHaveBeenCalledWith(
        'sess-1',
        {
          message: 'Monday',
          questionId: 'q-1',
          answer: { selectedOptionIds: ['mon'] },
        },
        42,
      );
      expect(redisService.releaseLock).toHaveBeenCalledWith(
        'builder-turn:sess-1',
      );
    });

    it('sends a custom answer as the admin’s words', async () => {
      const { answer, streamTurn } = build({
        messages: { 'sess-1': [assistantRow({ questions: [question()] })] },
      });

      await answer(
        'question:sess-1:q-1',
        { customValues: ['Wednesday, after the standup'] },
        42,
      );
      await flush();

      expect(streamTurn.mock.calls[0][1]).toEqual({
        message: 'Wednesday, after the standup',
        questionId: 'q-1',
        answer: { customValues: ['Wednesday, after the standup'] },
      });
    });

    it('refuses a question that has already been answered', async () => {
      const { answer, streamTurn } = build({
        messages: {
          'sess-1': [
            assistantRow({ questions: [question()] }),
            {
              id: 'm-3',
              seq: 3,
              role: BuilderMessageRole.USER,
              content: 'Monday',
              metadata: { questionId: 'q-1' },
            },
          ],
        },
      });

      await expect(
        answer('question:sess-1:q-1', { selectedOptionIds: ['mon'] }, 42),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(streamTurn).not.toHaveBeenCalled();
    });

    it('refuses to start a turn while another holds the session lock', async () => {
      const { answer, streamTurn } = build({
        locked: false,
        messages: { 'sess-1': [assistantRow({ questions: [question()] })] },
      });

      await expect(
        answer('question:sess-1:q-1', { selectedOptionIds: ['mon'] }, 42),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(streamTurn).not.toHaveBeenCalled();
    });

    it('releases the lock even when the turn throws', async () => {
      const { answer, redisService, streamTurn } = build({
        messages: { 'sess-1': [assistantRow({ questions: [question()] })] },
      });
      streamTurn.mockImplementation(async function* () {
        throw new Error('model down');

        yield { event: 'done', data: {} };
      });

      await answer('question:sess-1:q-1', { selectedOptionIds: ['mon'] }, 42);
      await flush();

      expect(redisService.releaseLock).toHaveBeenCalledWith(
        'builder-turn:sess-1',
      );
    });

    it('confirms every brief line and carries the note', async () => {
      const { answer, streamTurn } = build({
        messages: {
          'sess-1': [
            assistantRow({
              situationBrief: {
                id: 'brief-1',
                message: 'What I found',
                lines: [
                  { id: 'X1', kind: 'exists', text: 'a', cites: [] },
                  { id: 'P1', kind: 'proposal', text: 'b', cites: [] },
                ],
              },
            }),
          ],
        },
      });

      await answer(
        'brief:sess-1:brief-1',
        {
          selectedOptionIds: ['confirm_all'],
          customValues: ['Keep it to one email a week'],
        },
        42,
      );
      await flush();

      expect(streamTurn.mock.calls[0][1]).toEqual({
        message: 'Confirmed. Keep it to one email a week',
        briefResponse: {
          briefId: 'brief-1',
          lines: [
            { id: 'X1', verdict: 'confirm' },
            { id: 'P1', verdict: 'confirm' },
          ],
          note: 'Keep it to one email a week',
        },
      });
    });

    it('routes start, design and approve to the build service', async () => {
      const ready = session({ status: BuilderSessionStatus.PRD_READY });
      const { answer, service, buildService } = build({ sessions: [ready] });
      // Routing only: which decision is pending is the derivation tests' job.
      jest
        .spyOn(service, 'findPending')
        .mockImplementation((id: string) =>
          Promise.resolve(
            pendingStub(id, ['start', 'design', 'approve', 'redraft']),
          ),
        );

      await expect(
        answer('start_build:sess-1', { selectedOptionIds: ['start'] }, 42),
      ).resolves.toMatchObject({ ok: true, outcome: 'build_started' });
      expect(buildService.startBuild).toHaveBeenCalledWith(ready, 42);

      await expect(
        answer('start_build:sess-1', { selectedOptionIds: ['design'] }, 42),
      ).resolves.toMatchObject({ ok: true, outcome: 'design_started' });
      expect(buildService.startDesign).toHaveBeenCalledWith(ready, 42);

      await expect(
        answer('design_review:sess-1', { selectedOptionIds: ['approve'] }, 42),
      ).resolves.toMatchObject({ ok: true, outcome: 'design_approved' });
      expect(buildService.approveDesign).toHaveBeenCalledWith(ready, 42);
    });

    it('raises the budget from the current ceiling, or to a typed figure', async () => {
      const held = session({
        status: BuilderSessionStatus.BUILDING,
        budgetUsd: '25',
        totalCostUsd: '26.4',
      });
      const { answer, buildService, sessionService } = build({
        sessions: [held],
      });

      await answer('budget:sess-1', { selectedOptionIds: ['raise_10'] }, 42);
      expect(buildService.raiseBudget).toHaveBeenLastCalledWith(held, 42, 37);

      await answer('budget:sess-1', { customValues: ['$60'] }, 42);
      expect(buildService.raiseBudget).toHaveBeenLastCalledWith(held, 42, 60);

      await answer('budget:sess-1', { selectedOptionIds: ['uncap'] }, 42);
      expect(buildService.raiseBudget).toHaveBeenLastCalledWith(held, 42, 0);

      await expect(
        answer('budget:sess-1', { selectedOptionIds: ['stop'] }, 42),
      ).resolves.toMatchObject({ ok: true, outcome: 'cancelled' });
      expect(sessionService.cancelSession).toHaveBeenCalledWith('sess-1', 42);
    });

    it('never reads typed text as "remove the ceiling"', async () => {
      const held = session({
        status: BuilderSessionStatus.BUILDING,
        budgetUsd: '25',
        totalCostUsd: '26.4',
      });
      const { answer, buildService } = build({ sessions: [held] });

      // A ceiling of 0 means "no ceiling" downstream. Text with no digits, or
      // a typed zero, must be refused rather than uncap the session.
      for (const text of ['none', 'a lot', '0', '$0.00']) {
        await expect(
          answer('budget:sess-1', { customValues: [text] }, 42),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(buildService.raiseBudget).not.toHaveBeenCalled();

      await answer('budget:sess-1', { customValues: ['$1,200'] }, 42);
      expect(buildService.raiseBudget).toHaveBeenLastCalledWith(held, 42, 1200);
    });

    it('merges and resumes pull requests through the pull request service', async () => {
      const { answer, pullRequestService } = build({
        pullRequests: [
          pullRequest({ id: 'pr-1', mergePromptedAt: earlier }),
          pullRequest({ id: 'pr-2', needsHumanAt: earlier }),
        ],
      });

      await expect(
        answer('pr_merge:sess-1:pr-1', { selectedOptionIds: ['merge'] }, 42),
      ).resolves.toMatchObject({ ok: true, outcome: 'merged' });
      expect(pullRequestService.mergePullRequest).toHaveBeenCalledWith(
        'sess-1',
        'pr-1',
        42,
      );

      await expect(
        answer(
          'pr_needs_human:sess-1:pr-2',
          { selectedOptionIds: ['resume'] },
          42,
        ),
      ).resolves.toMatchObject({ ok: true, outcome: 'resumed' });
      expect(pullRequestService.resumeAutomation).toHaveBeenCalledWith(
        'sess-1',
        'pr-2',
        42,
      );
    });

    it('retries or archives a failed build', async () => {
      const failed = session({ status: BuilderSessionStatus.FAILED });
      const { answer, buildService, sessionService } = build({
        sessions: [failed],
      });

      await answer('build_failed:sess-1', { selectedOptionIds: ['retry'] }, 42);
      expect(buildService.startBuild).toHaveBeenCalledWith(failed, 42);

      await answer(
        'build_failed:sess-1',
        { selectedOptionIds: ['archive'] },
        42,
      );
      expect(sessionService.archiveSession).toHaveBeenCalledWith('sess-1', 42);
    });

    it('rejects an id that is not a decision, and an answer that picks nothing', async () => {
      const failed = session({ status: BuilderSessionStatus.FAILED });
      const { answer } = build({ sessions: [failed] });

      await expect(answer('nonsense', {}, 42)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        answer('build_failed:sess-1', {}, 42),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('the undo window', () => {
    const withQuestion = () =>
      build({
        messages: { 'sess-1': [assistantRow({ questions: [question()] })] },
      });

    it('holds a reversible answer from Now instead of applying it', async () => {
      const { service, streamTurn, store } = withQuestion();

      const result = await service.answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );

      expect(result).toMatchObject({ ok: true, outcome: 'pending' });
      expect(result.undoableUntil).toEqual(expect.any(String));
      expect(store.has('builder-undo:question:sess-1:q-1')).toBe(true);
      expect(streamTurn).not.toHaveBeenCalled();
      service.onModuleDestroy();
    });

    it('applies the held answer when the window closes, once', async () => {
      const { service, streamTurn, historyService } = withQuestion();
      await service.answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );

      await service.commitHeld('question:sess-1:q-1');
      await service.commitHeld('question:sess-1:q-1');
      await flush();

      expect(streamTurn).toHaveBeenCalledTimes(1);
      expect(historyService.markApplied).toHaveBeenCalledWith('h-1');
    });

    it('undo inside the window cancels it and marks the row undone', async () => {
      const { service, streamTurn, historyService, store } = withQuestion();
      await service.answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );

      await expect(service.undo('question:sess-1:q-1', 42)).resolves.toEqual({
        ok: true,
      });
      await service.commitHeld('question:sess-1:q-1');

      expect(streamTurn).not.toHaveBeenCalled();
      expect(historyService.markUndone).toHaveBeenCalledWith('h-1');
      expect(store.size).toBe(0);
    });

    it('refuses an undo after the window, or by someone else', async () => {
      const { service } = withQuestion();
      await service.answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );

      await expect(
        service.undo('question:sess-1:q-1', 99),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.commitHeld('question:sess-1:q-1');
      await expect(
        service.undo('question:sess-1:q-1', 42),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hides a held answer from the feed and refuses a second answer', async () => {
      const { service } = withQuestion();
      await service.answer(
        'question:sess-1:q-1',
        { selectedOptionIds: ['mon'] },
        42,
      );

      expect(await service.listPending()).toEqual([]);
      await expect(
        service.answer(
          'question:sess-1:q-1',
          { selectedOptionIds: ['fri'] },
          42,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      service.onModuleDestroy();
    });

    it('sends a one-way option at once, with no window', async () => {
      const { service, pullRequestService, store } = build({
        pullRequests: [pullRequest({ id: 'pr-1', mergePromptedAt: earlier })],
      });

      const result = await service.answer(
        'pr_merge:sess-1:pr-1',
        { selectedOptionIds: ['merge'] },
        42,
      );

      expect(result).toMatchObject({ outcome: 'merged' });
      expect(result.undoableUntil).toBeUndefined();
      expect(pullRequestService.mergePullRequest).toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('commits answers a gone instance left behind', async () => {
      const { service, streamTurn, store } = withQuestion();
      store.set(
        'builder-undo:question:sess-1:q-1',
        JSON.stringify({
          dto: { selectedOptionIds: ['mon'] },
          userId: 42,
          historyId: 'h-9',
          until: Date.now() - 1000,
        }),
      );

      await service.sweepHeld();
      await flush();

      expect(streamTurn).toHaveBeenCalledTimes(1);
    });

    it('records History before applying, with the recommendation frozen', async () => {
      const { answer, historyService } = withQuestion();

      await answer('question:sess-1:q-1', { selectedOptionIds: ['fri'] });

      expect(historyService.recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'question:sess-1:q-1' }),
        expect.objectContaining({ selectedOptionIds: ['fri'] }),
        expect.objectContaining({ surface: 'session', actorUserId: 42 }),
      );
    });

    it('refuses a decision that is no longer pending, and an unknown option', async () => {
      const { answer } = withQuestion();

      await expect(
        answer('build_failed:sess-1', { selectedOptionIds: ['retry'] }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        answer('question:sess-1:q-1', { selectedOptionIds: ['tue'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks every one-way option with what it does', async () => {
      const { service } = build({
        sessions: [
          session({
            status: BuilderSessionStatus.BUILDING,
            budgetUsd: '25',
            totalCostUsd: '26',
          }),
        ],
        pullRequests: [pullRequest({ id: 'pr-1', mergePromptedAt: earlier })],
      });

      const options = (await service.listPending()).flatMap(
        (decision) => decision.options,
      );
      const oneWay = options.filter((option) => option.oneWay);

      expect(oneWay.map((option) => option.id).sort()).toEqual([
        'merge',
        'stop',
        'uncap',
      ]);
      for (const option of oneWay) {
        expect(option.consequence).toEqual(expect.any(String));
        expect(option.confirm).toBe(true);
      }
    });
  });

  describe('parseDecisionId', () => {
    it('round-trips ids with and without a ref', () => {
      expect(parseDecisionId('question:sess-1:q-1')).toEqual({
        kind: 'question',
        sessionId: 'sess-1',
        ref: 'q-1',
      });
      expect(parseDecisionId('budget:sess-1')).toEqual({
        kind: 'budget',
        sessionId: 'sess-1',
        ref: null,
      });
      expect(parseDecisionId('bogus:sess-1')).toBeNull();
      expect(parseDecisionId('')).toBeNull();
    });
  });
});
