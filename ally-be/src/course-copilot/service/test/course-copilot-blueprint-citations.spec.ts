import { ClUseCase } from 'src/context-library/enum/context-library.enum';
import { CourseCopilotBlueprintService } from '../course-copilot-blueprint.service';
import { makeSession } from './course-copilot-test.fixtures';

/**
 * Citation integrity on the blueprint, as Builder's PRD has it: `[LD-…]` and `[CC-…]` codes the
 * session was never shown are stripped before the save, the rest verified in the background.
 */
describe('CourseCopilotBlueprintService — citations', () => {
  const blueprint = (purpose: string) =>
    ({
      title: 'Listening course',
      sections: [
        {
          title: 'Basics',
          items: [{ id: 'i1', type: 'QUIZ', title: 'Check', purpose }],
        },
      ],
    }) as any;

  const build = (citations?: Record<string, jest.Mock>) =>
    new CourseCopilotBlueprintService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      citations as any,
    );

  const check = (service: CourseCopilotBlueprintService, bp: any) =>
    (service as any).checkCitations(
      makeSession({ id: 'sess-1', blueprint: blueprint('before') as any }),
      bp,
    );

  it('strips codes this session was never shown and verifies the rest off the save path', async () => {
    const validate = jest.fn(async ({ text }) => ({
      text: text.replace(' [CC-0099]', ''),
      rejected: ['CC-0099'],
      valid: ['LD-0004'],
    }));
    const verify = jest.fn().mockResolvedValue(['LD-0004']);
    const service = build({ validate, verify });

    const kept = await check(
      service,
      blueprint('Practise before the assessment [LD-0004] [CC-0099]'),
    );

    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: ClUseCase.COURSE_COPILOT,
        sessionId: 'sess-1',
        previousText: JSON.stringify(blueprint('before')),
      }),
    );
    expect(kept.sections[0].items[0].purpose).toBe(
      'Practise before the assessment [LD-0004]',
    );
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: ClUseCase.COURSE_COPILOT,
        sessionId: 'sess-1',
        codes: ['LD-0004'],
      }),
    );
  });

  it('keeps the blueprint as written when the check fails or is not wired', async () => {
    const bp = blueprint('Practise first [LD-0004]');
    expect(await check(build(), bp)).toBe(bp);
    const failing = build({
      validate: jest.fn().mockRejectedValue(new Error('db down')),
      verify: jest.fn(),
    });
    expect(await check(failing, bp)).toBe(bp);
  });
});
