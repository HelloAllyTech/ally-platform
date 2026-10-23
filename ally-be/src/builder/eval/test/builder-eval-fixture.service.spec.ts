import { BadRequestException, ConflictException } from '@nestjs/common';
import { BuilderMessageRole } from '../../enum/builder.enum';
import {
  adminWordsFrom,
  BuilderEvalFixtureService,
  normaliseChecklist,
} from '../service/builder-eval-fixture.service';

describe('BuilderEvalFixtureService', () => {
  it("reads the admin's words: the opening message, then the script", () => {
    expect(
      adminWordsFrom([
        {
          role: BuilderMessageRole.USER,
          content: 'Let learners rate the debrief.',
        },
        { role: BuilderMessageRole.ASSISTANT, content: 'Which part?' },
        {
          role: BuilderMessageRole.USER,
          content: '[answers question q1] Thumbs [selected ids: thumbs]',
          metadata: { answer: { selectedOptionIds: ['thumbs'] } },
        },
        {
          role: BuilderMessageRole.USER,
          content:
            '[answers question q2] Auto-improve already writes challengers.',
        },
      ] as any),
    ).toEqual({
      openingMessage: 'Let learners rate the debrief.',
      adminScript: [
        'Thumbs [selected ids: thumbs]',
        'Auto-improve already writes challengers.',
      ],
    });
  });

  it('fills checklist ids and kinds, and drops blank items', () => {
    expect(
      normaliseChecklist([
        { text: 'Reuses Auto-improve' },
        { text: '  ' },
        { id: 'X', text: 'Adds a new challenger job', kind: 'must_not' },
      ]),
    ).toEqual([
      { id: 'C1', text: 'Reuses Auto-improve', kind: 'must' },
      { id: 'X', text: 'Adds a new challenger job', kind: 'must_not' },
    ]);
  });

  describe('creating fixtures', () => {
    const build = (existing: any = null) => {
      const repository = {
        findOne: jest.fn().mockResolvedValue(existing),
        create: jest.fn((row) => row),
        save: jest.fn(async (row) => ({ id: 'fixture-1', ...row })),
      };
      const service = new BuilderEvalFixtureService(
        { getRepository: () => repository } as any,
        {} as any,
        {} as any,
        {} as any,
      );
      return { service, repository };
    };

    it('cuts an interview fixture from a session export', async () => {
      const { service, repository } = build();

      await service.createFromExport(
        {
          id: '2bc3a5cf-e3a5-4bf4-bafe-ac6b0bc51f87',
          messages: [
            {
              role: BuilderMessageRole.USER,
              content: 'Let learners rate the debrief.',
            },
            {
              role: BuilderMessageRole.USER,
              content: 'Promotion already exists.',
            },
          ] as any,
          prd: { title: 'v8' } as any,
        },
        {
          name: 'debrief — already exists ×3',
          checklist: [{ text: 'Reuses Auto-improve', kind: 'must' }],
        },
        7,
      );

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'debrief — already exists ×3',
          kind: 'interview',
          sourceSessionId: '2bc3a5cf-e3a5-4bf4-bafe-ac6b0bc51f87',
          payload: expect.objectContaining({
            openingMessage: 'Let learners rate the debrief.',
            adminScript: ['Promotion already exists.'],
            checklist: [
              { id: 'C1', text: 'Reuses Auto-improve', kind: 'must' },
            ],
            recordedPrd: { title: 'v8' },
          }),
        }),
      );
    });

    it('refuses a duplicate name and an export with nothing to replay', async () => {
      await expect(
        build({ id: 'old' }).service.create(
          {
            name: 'debrief',
            kind: 'interview',
            payload: { openingMessage: 'x' } as any,
          },
          7,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        build().service.createFromExport(
          { messages: [] },
          { name: 'empty' },
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('the expected outcome', () => {
      const interview = (extra: Record<string, unknown> = {}) =>
        ({
          openingMessage: 'Version simulations every 24 hours.',
          adminScript: [],
          checklist: [],
          ...extra,
        }) as any;

      it('keeps "nothing to build" and stores nothing for the default', async () => {
        const { service, repository } = build();

        await service.importFixtures(
          [
            {
              name: 'versions (shipped)',
              kind: 'interview',
              payload: interview({ expectedOutcome: 'nothing_to_build' }),
            },
            {
              name: 'versions',
              kind: 'interview',
              payload: interview({ expectedOutcome: 'prd_ready' }),
            },
          ],
          7,
        );

        const saved = repository.save.mock.calls.map(([row]) => row.payload);
        expect(saved[0].expectedOutcome).toBe('nothing_to_build');
        // An export from before the field existed, or one that spells out the
        // default, stores the same payload as it always did.
        expect(saved[1]).not.toHaveProperty('expectedOutcome');
      });

      it('imports an export from before the field existed unchanged', async () => {
        const { service, repository } = build();
        const old = interview({ recordedPrd: null });

        await service.importFixtures(
          [{ name: 'bell', kind: 'interview', payload: old }],
          7,
        );

        expect(repository.save.mock.calls[0][0].payload).toEqual(old);
      });

      it('imports an export that still carries the retired pins, dropping them', async () => {
        const { service, repository } = build();

        await service.importFixtures(
          [
            {
              name: 'debrief (pinned)',
              kind: 'interview',
              payload: interview({ pins: { 'ally-be': 'abc1234' } }),
            },
          ],
          7,
        );

        const saved = repository.save.mock.calls[0][0].payload;
        expect(saved).not.toHaveProperty('pins');
        expect(saved.openingMessage).toBe(
          'Version simulations every 24 hours.',
        );
      });

      it('refuses an expectation it does not know, rather than read it as a PRD', async () => {
        await expect(
          build().service.create(
            {
              name: 'versions',
              kind: 'interview',
              payload: interview({ expectedOutcome: 'nothing-to-build' }),
            },
            7,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('requires a seeded-defect fixture to say whether the critic should block', async () => {
      await expect(
        build().service.create(
          { name: 'seeded', kind: 'prd_review', payload: { prd: {} } as any },
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
