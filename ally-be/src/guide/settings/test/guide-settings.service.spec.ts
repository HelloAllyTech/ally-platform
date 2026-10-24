import {
  ALLY_GUIDE_SETTINGS_NAME,
  DEFAULT_GUIDE_SWITCHES,
  GUIDE_SWITCHES_SNAPSHOT_MS,
  GuideSettingsService,
  normaliseGuideSwitches,
} from '../guide-settings.service';

const repo = () => ({
  findOne: jest.fn(),
  save: jest.fn(async (row: unknown) => row),
  create: jest.fn((row: unknown) => row),
});

describe('normaliseGuideSwitches', () => {
  it('fails closed on anything missing or malformed', () => {
    expect(normaliseGuideSwitches(undefined)).toEqual(DEFAULT_GUIDE_SWITCHES);
    expect(normaliseGuideSwitches('on')).toEqual(DEFAULT_GUIDE_SWITCHES);
    expect(
      normaliseGuideSwitches({
        enabled: 'yes',
        voice: 1,
        disabledCourses: 'x',
      }),
    ).toEqual(DEFAULT_GUIDE_SWITCHES);
  });

  it('keeps well-formed values and de-duplicates lists', () => {
    expect(
      normaliseGuideSwitches({
        enabled: true,
        disabledCourses: ['a', 'a', 7, 'b'],
      }),
    ).toEqual({
      ...DEFAULT_GUIDE_SWITCHES,
      enabled: true,
      disabledCourses: ['a', 'b'],
    });
  });
});

describe('GuideSettingsService', () => {
  let nowSpy: jest.SpyInstance;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('treats a missing row as the guide being off', async () => {
    const r = repo();
    r.findOne.mockResolvedValue(null);
    const service = new GuideSettingsService(r as never);

    expect(await service.isGuidedAvailable('t1')).toBe(false);
  });

  it('fails closed when the read throws, and retries next time', async () => {
    const r = repo();
    r.findOne
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ value: { enabled: true } });
    const service = new GuideSettingsService(r as never);

    expect(await service.isGuidedAvailable('t1')).toBe(false);
    expect(await service.isGuidedAvailable('t1')).toBe(true);
  });

  it('honours per-course and per-tenant switches', async () => {
    const r = repo();
    r.findOne.mockResolvedValue({
      value: {
        enabled: true,
        disabledCourses: ['off-course'],
        disabledTenants: ['off-org'],
      },
    });
    const service = new GuideSettingsService(r as never);

    expect(await service.isGuidedAvailable('on-course', 'on-org')).toBe(true);
    expect(await service.isGuidedAvailable('off-course', 'on-org')).toBe(false);
    expect(await service.isGuidedAvailable('on-course', 'off-org')).toBe(false);
  });

  it('turns every capability off when the master switch is off', async () => {
    const r = repo();
    r.findOne.mockResolvedValue({ value: { enabled: false } });
    const service = new GuideSettingsService(r as never);

    expect(await service.isCapabilityEnabled('consult_tutor')).toBe(false);
  });

  it('reuses a read within the snapshot window and re-reads after it', async () => {
    const r = repo();
    r.findOne.mockResolvedValue({ value: { enabled: true } });
    const service = new GuideSettingsService(r as never);

    await service.switches();
    now += GUIDE_SWITCHES_SNAPSHOT_MS - 1;
    await service.switches();
    expect(r.findOne).toHaveBeenCalledTimes(1);

    now += 2;
    await service.switches();
    expect(r.findOne).toHaveBeenCalledTimes(2);
  });

  it('merges an update over the stored switches and applies it at once', async () => {
    const r = repo();
    const stored = {
      name: ALLY_GUIDE_SETTINGS_NAME,
      value: { enabled: true, voice: true },
      updatedBy: 1,
    };
    r.findOne.mockResolvedValue(stored);
    const service = new GuideSettingsService(r as never);

    const merged = await service.update({ voice: false }, 42);

    expect(merged).toEqual({ ...DEFAULT_GUIDE_SWITCHES, enabled: true });
    expect(r.save).toHaveBeenCalledWith(
      expect.objectContaining({ updatedBy: 42 }),
    );
    expect(await service.isGuidedAvailable('t1')).toBe(true);
  });

  it('creates the row on the first save', async () => {
    const r = repo();
    r.findOne.mockResolvedValue(null);
    const service = new GuideSettingsService(r as never);

    await service.update({ enabled: true }, 7);

    expect(r.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: ALLY_GUIDE_SETTINGS_NAME,
        createdBy: 7,
        updatedBy: 7,
      }),
    );
  });
});
