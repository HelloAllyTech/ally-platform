import {
  BuilderMessageRole,
  BuilderSessionStatus,
} from '../../enum/builder.enum';
import { SandboxStores } from '../sandbox/builder-eval-stores';
import {
  BuilderEvalRunnerService,
  parseAdminReply,
  parseJudgement,
  replyToMessage,
} from '../service/builder-eval-runner.service';

describe('BuilderEvalRunnerService', () => {
  describe('parsing the model roles', () => {
    it('reads the simulated admin, including a correction', () => {
      expect(
        parseAdminReply(
          '```json\n{"message":"No — Auto-improve already writes challengers.","correction":true,"about":["C2"]}\n```',
        ),
      ).toEqual({
        message: 'No — Auto-improve already writes challengers.',
        optionIds: [],
        correction: true,
        about: ['C2'],
        done: false,
      });
      expect(parseAdminReply('{"done":true}')?.done).toBe(true);
      expect(parseAdminReply('sure')).toBeNull();
    });

    it('scores every checklist item, unjudged ones as unmet', () => {
      const judgement = parseJudgement(
        JSON.stringify({
          items: [
            { id: 'C1', met: true, evidence: 'reuses Auto-improve' },
            { id: 'C9', met: true, evidence: 'invented' },
          ],
        }),
        [
          { id: 'C1', text: 'Reuses Auto-improve', kind: 'must' },
          { id: 'C2', text: 'Plans ally-mobile', kind: 'must' },
        ],
      );

      expect(judgement).toEqual(
        expect.objectContaining({ met: 1, total: 2, score: 0.5 }),
      );
      expect(judgement?.items[1]).toEqual({
        id: 'C2',
        met: false,
        evidence: 'not judged',
      });
    });
  });

  describe('the situation brief', () => {
    const brief = {
      id: 'brief-1',
      message: 'Here is what exists.',
      createdAt: '2026-10-21T00:00:00Z',
      lines: [
        {
          id: 'X1',
          kind: 'exists' as const,
          text: 'Auto-improve',
          cites: [
            {
              ref: 'E1',
              label: 'capability_lookup "auto improve" — Auto-improve',
            },
          ],
        },
        {
          id: 'P1',
          kind: 'proposal' as const,
          approach: 'new' as const,
          part: 'loop',
          text: 'A new challenger job',
          cites: [],
        },
      ],
    };

    it("reads the admin's verdicts on the brief's lines", () => {
      expect(
        parseAdminReply(
          JSON.stringify({
            message: 'Mostly right.',
            lines: [
              { id: 'X1', verdict: 'confirm' },
              {
                id: 'P1',
                verdict: 'correct',
                correction: 'Reuse Auto-improve, do not build a job',
              },
              { id: 'P2', verdict: 'correct' },
            ],
            correction: true,
            about: ['C2'],
          }),
        )?.lines,
      ).toEqual([
        { id: 'X1', verdict: 'confirm' },
        {
          id: 'P1',
          verdict: 'correct',
          correction: 'Reuse Auto-improve, do not build a job',
        },
        // A correction with no words is a confirmation.
        { id: 'P2', verdict: 'confirm' },
      ]);
    });

    it('answers every line of the brief, confirming the ones the admin did not mention', () => {
      expect(
        replyToMessage(
          {
            message: 'Reuse it.',
            optionIds: [],
            correction: true,
            about: ['C2'],
            done: false,
            lines: [
              {
                id: 'P1',
                verdict: 'correct',
                correction: 'Reuse Auto-improve',
              },
            ],
          },
          null,
          brief,
        ),
      ).toEqual({
        message: 'Reuse it.',
        briefResponse: {
          briefId: 'brief-1',
          lines: [
            { id: 'X1', verdict: 'confirm' },
            { id: 'P1', verdict: 'correct', correction: 'Reuse Auto-improve' },
          ],
          note: 'Reuse it.',
        },
      });
    });
  });

  describe('replyToMessage', () => {
    const question = {
      id: 'q1',
      options: [
        { id: 'guardrail', label: 'Guardrail' },
        { id: 'weight', label: 'Weight' },
      ],
    };

    it('answers a card with the picked options, keeping extra words as custom text', () => {
      expect(
        replyToMessage(
          {
            message: 'Guardrail, at 70%.',
            optionIds: ['guardrail'],
            correction: false,
            about: [],
            done: false,
          },
          question,
        ),
      ).toEqual({
        message: 'Guardrail',
        questionId: 'q1',
        answer: {
          selectedOptionIds: ['guardrail'],
          customValues: ['Guardrail, at 70%.'],
        },
      });
    });

    it('answers in free text when nothing on the card fits', () => {
      expect(
        replyToMessage(
          {
            message: 'Neither — skip it.',
            optionIds: ['nope'],
            correction: false,
            about: [],
            done: false,
          },
          question,
        ),
      ).toEqual({ message: 'Neither — skip it.', questionId: 'q1' });
    });
  });

  describe('an interview replay', () => {
    /**
     * A stand-in sandbox whose "interview" is scripted: turn one asks a
     * question, turn two marks the session ready. The simulated admin corrects
     * once. Pins the loop: it stops at ready, counts the correction, and the
     * correction fails the run even though the gates are clean.
     */
    const buildRunner = () => {
      const stores = new SandboxStores();
      const session = {
        id: 'session-1',
        status: BuilderSessionStatus.INTERVIEWING,
      };
      let turn = 0;
      const orchestrator = {
        streamTurn: async function* (_id: string, dto: any) {
          turn += 1;
          await stores.messageRepository.appendMessage('session-1', {
            role: BuilderMessageRole.USER,
            content: dto.message,
          });
          await stores.messageRepository.appendMessage('session-1', {
            role: BuilderMessageRole.ASSISTANT,
            content:
              turn === 1
                ? 'Should this be a new challenger job?'
                : 'Reusing Auto-improve.',
            toolCalls:
              turn === 1 ? [{ id: 'q', name: 'ask_admin', input: {} }] : [],
            toolResults:
              turn === 1
                ? [{ toolUseId: 'q', name: 'ask_admin', result: { ok: true } }]
                : [],
            metadata:
              turn === 1
                ? { questions: [{ id: 'q1', prompt: 'New job?' }] }
                : {},
          });
          if (turn === 2) session.status = BuilderSessionStatus.PRD_READY;
          yield { event: 'done', data: {} };
        },
      };
      const complete = jest.fn(async (request: any) =>
        request.taskId === 'builder-eval-admin'
          ? {
              text: JSON.stringify({
                message: 'No — Auto-improve already writes challengers.',
                correction: true,
                about: ['C1'],
              }),
            }
          : {
              text: JSON.stringify({
                items: [{ id: 'C1', met: true, evidence: 'yes' }],
              }),
              model: 'gpt-5-mini',
            },
      );
      const readyReadiness = {
        score: 100,
        ready: true,
        blockers: [],
        sections: [
          { key: 'existingGrounded', ok: true },
          { key: 'testPlanRepos', ok: true },
        ],
      };
      const sandbox = {
        session,
        stores,
        orchestrator,
        prdService: {},
        readiness: { assess: jest.fn().mockResolvedValue(readyReadiness) },
        llmCompletion: { complete },
        passes: [],
        costUsd: () => 0.42,
      };
      const factory = { create: jest.fn(() => sandbox) };
      return {
        runner: new BuilderEvalRunnerService(factory as any),
        complete,
        factory,
      };
    };

    it('stops at ready, counts the correction, and fails the run for it', async () => {
      const { runner, complete } = buildRunner();

      const result = await runner.run(
        {
          id: 'f1',
          name: 'debrief',
          kind: 'interview',
          payload: {
            openingMessage: 'Let learners rate the debrief.',
            adminScript: ['Auto-improve already writes challengers.'],
            checklist: [
              { id: 'C1', text: 'Reuses Auto-improve', kind: 'must' },
            ],
          },
        } as any,
        { evalRunId: 'run-1', userId: 7 },
      );

      expect(result.metrics).toEqual(
        expect.objectContaining({
          turns: 2,
          questions: 1,
          corrections: 1,
          correctedItems: ['C1'],
          readyReached: true,
          costUsd: 0.42,
        }),
      );
      expect(result.transcript?.[1]).toEqual(
        expect.objectContaining({
          correction: true,
          admin: 'No — Auto-improve already writes challengers.',
        }),
      );
      expect(result.judge?.score).toBe(1);
      expect(result.status).toBe('failed');
      // One admin reply (turn 1 asked; turn 2 was ready), then the judge.
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it('records what held a 100-scored PRD back, and a ready claim made over it', async () => {
      const stores = new SandboxStores();
      const session = {
        id: 'session-1',
        status: BuilderSessionStatus.INTERVIEWING,
      };
      // Every written row passes, so the score is 100; an open review
      // finding still blocks.
      const notReady = {
        score: 100,
        ready: false,
        blockers: ['1 review finding(s) to fix or dismiss.'],
        sections: [
          {
            key: 'existingGrounded',
            label: 'What already exists was read',
            ok: true,
          },
          { key: 'prdReview', label: 'Cold review', ok: false },
        ],
      };
      const orchestrator = {
        streamTurn: async function* (_id: string, dto: any) {
          await stores.messageRepository.appendMessage('session-1', {
            role: BuilderMessageRole.USER,
            content: dto.message,
          });
          await stores.messageRepository.appendMessage('session-1', {
            role: BuilderMessageRole.ASSISTANT,
            content: 'The PRD is complete. You can start the build.',
          });
          yield { event: 'readiness', data: notReady };
          yield { event: 'done', data: {} };
        },
      };
      const complete = jest.fn(async (request: any) =>
        request.taskId === 'builder-eval-admin'
          ? { text: JSON.stringify({ message: 'Thanks.', done: true }) }
          : { text: JSON.stringify({ items: [] }), model: 'gpt-5-mini' },
      );
      const runner = new BuilderEvalRunnerService({
        create: jest.fn(() => ({
          session,
          stores,
          orchestrator,
          prdService: {},
          readiness: { assess: jest.fn().mockResolvedValue(notReady) },
          llmCompletion: { complete },
          passes: [],
          costUsd: () => 0.1,
        })),
      } as any);

      await stores.docRepository.save({
        sessionId: 'session-1',
        versionNumber: 4,
        draft: {},
      } as any);

      const result = await runner.run(
        {
          id: 'f1',
          name: 'bell',
          kind: 'interview',
          payload: { openingMessage: 'Fix the bell.', checklist: [] },
        } as any,
        { evalRunId: 'run-1', userId: 7 },
      );

      expect(result.metrics).toEqual(
        expect.objectContaining({
          readyReached: false,
          readinessScore: 100,
          readyAtEnd: false,
          blockersAtEnd: [{ key: 'prdReview', label: 'Cold review' }],
        }),
      );
      expect(result.transcript?.[0]).toEqual(
        expect.objectContaining({ ready: false }),
      );
      expect(result.gates?.falseReadyClaims).toBe(1);
      expect(result.status).toBe('failed');
    });

    describe('a fixture that expects nothing to build', () => {
      /**
       * A stand-in interview that ends the way Suite 5d24dd95's "simulation
       * edit versions" run did: turn one shows a brief, the admin confirms,
       * turn two empties the requirements, says what exists and asks nothing.
       * `variant` changes only how it ends.
       */
      const replay = async (
        expectedOutcome: string | undefined,
        variant: 'concludes' | 'builds' | 'keeps asking' = 'concludes',
      ) => {
        const stores = new SandboxStores();
        const session = {
          id: 'session-1',
          status: BuilderSessionStatus.INTERVIEWING,
        };
        const grounded = {
          score: 82,
          ready: false,
          blockers: ['No requirements captured yet.'],
          sections: [
            { key: 'existingGrounded', label: 'Read', ok: true },
            { key: 'requirements', label: 'Requirements', ok: false },
          ],
        };
        let turn = 0;
        const orchestrator = {
          streamTurn: async function* (_id: string, dto: any) {
            turn += 1;
            await stores.messageRepository.appendMessage('session-1', {
              role: BuilderMessageRole.USER,
              content: dto.message,
            });
            const asks = turn === 1 || variant === 'keeps asking';
            await stores.messageRepository.appendMessage('session-1', {
              role: BuilderMessageRole.ASSISTANT,
              content: asks
                ? 'Is anything different from the daily auto-version job?'
                : 'The daily job already does this, so no build is needed.',
              metadata: asks
                ? { questions: [{ id: `q${turn}`, prompt: 'Different?' }] }
                : {},
            });
            await stores.docRepository.save({
              id: 'doc-1',
              sessionId: 'session-1',
              versionNumber: turn,
              draft: {
                existingBehaviour:
                  'A daily job saves an automatic version of each edited draft.',
                requirements:
                  variant === 'builds'
                    ? [
                        {
                          id: 'R1',
                          title: 'Version history',
                          description: '',
                          acceptanceCriteria: ['Lists versions'],
                        },
                      ]
                    : [],
              },
            } as any);
            if (variant === 'builds' && turn === 2) {
              session.status = BuilderSessionStatus.PRD_READY;
            }
            yield { event: 'readiness', data: grounded };
            yield { event: 'done', data: {} };
          },
        };
        const complete = jest.fn(async (request: any) =>
          request.taskId === 'builder-eval-admin'
            ? {
                text: JSON.stringify(
                  turn === 1
                    ? { message: 'No, that is it.' }
                    : { message: 'Thanks.', done: true },
                ),
              }
            : {
                text: JSON.stringify({
                  items: [{ id: 'C1', met: true, evidence: 'daily job' }],
                }),
                model: 'gpt-5-mini',
              },
        );
        const runner = new BuilderEvalRunnerService({
          create: jest.fn(() => ({
            session,
            stores,
            orchestrator,
            prdService: {},
            readiness: { assess: jest.fn().mockResolvedValue(grounded) },
            llmCompletion: { complete },
            passes: [],
            costUsd: () => 0.3,
          })),
        } as any);
        return runner.run(
          {
            id: 'f1',
            name: 'versions',
            kind: 'interview',
            payload: {
              openingMessage: 'Version simulations every 24 hours.',
              adminScript: ['No, that is it.'],
              checklist: [
                {
                  id: 'C1',
                  text: 'Says the daily auto-version job exists',
                  kind: 'must',
                },
              ],
              maxTurns: 3,
              ...(expectedOutcome ? { expectedOutcome } : {}),
            },
          } as any,
          { evalRunId: 'run-1', userId: 7 },
        );
      };

      it('passes without a ready PRD when Builder concludes the work exists', async () => {
        const result = await replay('nothing_to_build');

        expect(result.metrics).toEqual(
          expect.objectContaining({
            readyReached: false,
            outcome: 'nothing_to_build',
            expectedOutcome: 'nothing_to_build',
            corrections: 0,
          }),
        );
        expect(result.status).toBe('passed');
      });

      it('fails the same ending on a fixture that expects a PRD, as before', async () => {
        const result = await replay(undefined);

        expect(result.metrics).toEqual(
          expect.objectContaining({
            outcome: 'nothing_to_build',
            expectedOutcome: 'prd_ready',
          }),
        );
        expect(result.status).toBe('failed');
      });

      it('fails when Builder plans a build of what exists, even one that reaches ready', async () => {
        const result = await replay('nothing_to_build', 'builds');

        expect(result.metrics?.readyReached).toBe(true);
        expect(result.metrics?.outcome).toBe('prd_ready');
        expect(result.status).toBe('failed');
      });

      it('fails when the replay runs out of turns still asking', async () => {
        const result = await replay('nothing_to_build', 'keeps asking');

        expect(result.metrics?.outcome).toBe('neither');
        expect(result.status).toBe('failed');
      });
    });

    it('reports an errored run rather than throwing', async () => {
      const runner = new BuilderEvalRunnerService({
        create: () => {
          throw new Error('no catalog');
        },
      } as any);

      const result = await runner.run(
        {
          id: 'f1',
          name: 'x',
          kind: 'interview',
          payload: { openingMessage: 'hi' },
        } as any,
        { evalRunId: 'run-1', userId: 7 },
      );

      expect(result).toEqual(
        expect.objectContaining({ status: 'errored', error: 'no catalog' }),
      );
    });
  });
});
