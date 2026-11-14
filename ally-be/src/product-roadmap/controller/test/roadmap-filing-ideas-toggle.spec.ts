import { ForbiddenException } from '@nestjs/common';
import { RoadmapOpportunityController } from '../roadmap-opportunity.controller';
import { RoadmapAdminController } from '../roadmap-admin.controller';
import { RoadmapIdeaDraftController } from '../roadmap-idea-draft.controller';

/**
 * Every door that files, or leads to filing, needs the Product Planning — Ideas
 * toggle (plans/roadmap-owns-planning rev 5.2 §B.12), checked BEFORE any work.
 * The route decorators stay as they were (Product Roadmap tab + VOTE); this is
 * the second gate, in the handler, so the old copilot door, Quick Add and the
 * new plan flow can never disagree about who may file.
 */
describe('Filing doors require Product Planning — Ideas', () => {
  const user = { id: 9 } as never;
  const refused = new ForbiddenException('no ideas toggle');
  const planAccess = {
    assertIdeas: jest.fn(async () => Promise.reject(refused)),
  };
  const opportunityService = { create: jest.fn() };
  const copilotService = { takeTurn: jest.fn(), streamTurn: jest.fn() };
  const drafts = {
    create: jest.fn(),
    update: jest.fn(),
    list: jest.fn(),
    remove: jest.fn(),
  };
  const transcription = { transcribe: jest.fn() };
  const access = { canManage: jest.fn(async () => false) };

  const opportunity = new RoadmapOpportunityController(
    opportunityService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    access as never,
    {} as never,
    planAccess as never,
  );
  const admin = new RoadmapAdminController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    copilotService as never,
    planAccess as never,
  );
  const ideaDrafts = new RoadmapIdeaDraftController(
    drafts as never,
    transcription as never,
    planAccess as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['create (interview filing)', () => opportunity.create(user, {} as never)],
    ['quickAdd', () => opportunity.quickAdd(user, {} as never)],
    [
      'copilot turn (JSON)',
      () => admin.opportunityInterview(user, { messages: [] } as never),
    ],
    ['park an idea', () => ideaDrafts.create(user, {} as never)],
    ['transcribe', () => ideaDrafts.transcribe(user, {} as never)],
    ['edit a parked idea', () => ideaDrafts.update(user, 'id', {} as never)],
  ])('%s is refused before any work', async (_name, call) => {
    await expect(call()).rejects.toBe(refused);
    expect(planAccess.assertIdeas).toHaveBeenCalledWith(9);
    expect(opportunityService.create).not.toHaveBeenCalled();
    expect(copilotService.takeTurn).not.toHaveBeenCalled();
    expect(drafts.create).not.toHaveBeenCalled();
    expect(drafts.update).not.toHaveBeenCalled();
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it('refuses the copilot stream before opening it', async () => {
    const res = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      on: jest.fn(),
    };
    await expect(
      admin.opportunityInterviewStream(
        user,
        { messages: [] } as never,
        res as never,
      ),
    ).rejects.toBe(refused);
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it('keeps listing and discarding your own drafts open', async () => {
    await ideaDrafts.list(user);
    await ideaDrafts.remove(user, 'id');
    expect(planAccess.assertIdeas).not.toHaveBeenCalled();
  });
});
