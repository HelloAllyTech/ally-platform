import { RoadmapIdeaDraftController } from '../roadmap-idea-draft.controller';

const user = { id: 7 } as never;

function build(v2Enabled: boolean) {
  const legacy = { create: jest.fn().mockResolvedValue({ id: 'legacy' }) };
  const v2 = { create: jest.fn().mockResolvedValue({ code: 'OPP-0001' }) };
  const planAccess = { assertIdeas: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    getRoadmapV2: jest.fn().mockResolvedValue({ enabled: v2Enabled }),
  };
  const controller = new RoadmapIdeaDraftController(
    legacy as never,
    {} as never,
    planAccess as never,
    settings as never,
    v2 as never,
  );
  return { controller, legacy, v2, planAccess };
}

describe('RoadmapIdeaDraftController.create', () => {
  it('routes the save to the v2 store once Roadmap v2 is on', async () => {
    const { controller, legacy, v2 } = build(true);
    const out = await controller.create(user, {
      rawText: 'An idea',
      captureMode: 'voice',
    });
    expect(v2.create).toHaveBeenCalledWith(7, {
      text: 'An idea',
      captureMode: 'voice',
    });
    expect(legacy.create).not.toHaveBeenCalled();
    expect(out).toEqual({ code: 'OPP-0001' });
  });

  it('keeps the legacy table while Roadmap v2 is off', async () => {
    const { controller, legacy, v2, planAccess } = build(false);
    await controller.create(user, { rawText: 'An idea' });
    expect(planAccess.assertIdeas).toHaveBeenCalledWith(7);
    expect(legacy.create).toHaveBeenCalled();
    expect(v2.create).not.toHaveBeenCalled();
  });
});
