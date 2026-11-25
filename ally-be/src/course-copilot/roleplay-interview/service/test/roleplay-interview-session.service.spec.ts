import { ConflictException, ForbiddenException } from '@nestjs/common';
import { RoleplayInterviewSessionService } from '../roleplay-interview-session.service';
import { RoleplayInterviewStatus } from '../../type/roleplay-interview.type';
import { validatePlan } from '../../util/roleplay-interview-brief.util';
import { COMPLETE_BRIEF, PLAN_INPUT } from './roleplay-interview-fixtures';

describe('RoleplayInterviewSessionService', () => {
  const plan = (() => {
    const result = validatePlan(PLAN_INPUT, COMPLETE_BRIEF, 2);
    if (!result.ok) throw new Error('fixture plan invalid');
    return result.plan;
  })();

  const makeService = (
    session: Record<string, any> | null,
    saved: { id: string; name: string } | null = null,
  ) => {
    const sessionRepository = {
      findOne: jest.fn().mockResolvedValue(session),
      save: jest.fn().mockImplementation(async (row) => row),
      create: jest.fn().mockImplementation((row) => row),
    };
    const messageRepository = {
      listBySession: jest.fn().mockResolvedValue([]),
    };
    const characterService = {
      saveCharacter: jest.fn().mockResolvedValue(saved),
    };
    return {
      service: new RoleplayInterviewSessionService(
        sessionRepository as any,
        messageRepository as any,
        characterService as any,
      ),
      sessionRepository,
      characterService,
    };
  };

  const ready = () => ({
    id: 's-1',
    createdBy: 7,
    status: RoleplayInterviewStatus.PLAN_READY,
    brief: COMPLETE_BRIEF,
    plan,
    planVersion: 2,
  });

  it('adds the new character to the library once the plan is approved', async () => {
    const session = { ...ready(), status: RoleplayInterviewStatus.APPROVED };
    const { service, characterService } = makeService(session, {
      id: 'c-9',
      name: 'Arjun',
    });
    const values = { name: 'Arjun', age: 22, gender: 'male' };
    const view = await service.saveCharacter('s-1', 7, values);
    expect(characterService.saveCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      values,
    );
    expect(view.brief?.savedCharacter).toEqual({ id: 'c-9', name: 'Arjun' });
  });

  it('refuses before the plan is approved', async () => {
    const { service, characterService } = makeService(ready());
    await expect(service.saveCharacter('s-1', 7, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(characterService.saveCharacter).not.toHaveBeenCalled();
  });

  it('approves the current plan and returns the generation inputs', async () => {
    const { service, sessionRepository } = makeService(ready());
    const out = await service.approve('s-1', 7, 2);
    expect(out.session.status).toBe(RoleplayInterviewStatus.APPROVED);
    expect(sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ approvedAt: expect.any(Date) }),
    );
    expect(out.generation.competencyId).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(out.generation.states).toEqual(plan.states);
  });

  it('refuses a stale plan version with 409', async () => {
    const { service } = makeService(ready());
    await expect(service.approve('s-1', 7, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a plan whose brief changed since with 409', async () => {
    const { service } = makeService({
      ...ready(),
      status: RoleplayInterviewStatus.INTERVIEWING,
    });
    await expect(service.approve('s-1', 7, 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("refuses another trainer's session", async () => {
    const { service } = makeService(ready());
    await expect(service.approve('s-1', 8, 2)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resumes an open session instead of creating one', async () => {
    const { service, sessionRepository } = makeService(ready());
    const view = await service.createOrResume(7, 't-1', 42);
    expect(view.id).toBe('s-1');
    expect(sessionRepository.save).not.toHaveBeenCalled();
  });

  it('creates a session when none is open', async () => {
    const { service, sessionRepository } = makeService(null);
    const view = await service.createOrResume(7, 't-1', null);
    expect(sessionRepository.save).toHaveBeenCalled();
    expect(view.status).toBe(RoleplayInterviewStatus.INTERVIEWING);
    expect(view.stillNeeded).toHaveLength(5);
    expect(view.scenarioId).toBeNull();
  });

  it('shows the trainer their own words and an assistant row its card, plan and receipt', () => {
    const { service } = makeService(null);
    expect(
      service.messageView({
        seq: 1,
        role: 'user',
        content: '[answers "Which?"] chose: Practice',
        metadata: { displayText: 'Practice' },
      } as any),
    ).toEqual({ seq: 1, role: 'user', content: 'Practice' });
    expect(
      service.messageView({
        seq: 2,
        role: 'assistant',
        content: 'Here is the plan.',
        metadata: {
          questions: [{ id: 'q' }],
          plan,
          receipt: { read: [] },
          errorMessage: 'x',
        },
      } as any),
    ).toEqual({
      seq: 2,
      role: 'assistant',
      content: 'Here is the plan.',
      questions: [{ id: 'q' }],
      plan,
      receipt: { read: [] },
      error: 'x',
    });
  });
});
