import { ConflictException } from '@nestjs/common';
import { CheckupService } from '../checkup/checkup.service';
import { ChangeService } from '../home/change.service';
import { versionOf } from '../home/home-fields';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const field = (value: unknown) => ({ value, version: versionOf(value) });

function build(fields: Record<string, unknown> = {}) {
  const state = {
    tone: 'warm',
    introduction: 'Hi.',
    avoidTopics: [] as string[],
    ...fields,
  };
  const home = {
    get: jest.fn(async () => ({
      fields: Object.fromEntries(
        Object.entries(state).map(([k, v]) => [k, field(v)]),
      ),
      safety: {
        rules: [
          { id: 'pack-0', text: 'No diagnosis.', fixed: true },
          { id: 'own-0', text: 'Quote group prices', fixed: false },
        ],
        version: 'v1',
      },
    })),
    saveField: jest.fn(async (_id, dto: { field: string; value: unknown }) => {
      (state as Record<string, unknown>)[dto.field] = dto.value;
    }),
    changeRule: jest.fn(),
  };
  const events: unknown[] = [];
  const draft = { id: 'd', events: [] as Record<string, unknown>[] };
  const drafts = {
    findByChatbot: jest.fn(async () => draft),
    update: jest.fn(async (d, patch, newEvents = []) => {
      Object.assign(draft, patch);
      draft.events = [...draft.events, ...newEvents];
      events.push(...newEvents);
      return draft;
    }),
  };
  const ai = { proposeChange: jest.fn() };
  const access = {
    assert: jest.fn(async () => ({
      chatbot: { safetyPack: 'mental_health', rules: { never: [] } },
    })),
  };
  const checkup = { scheduleAfterChange: jest.fn() };
  const service = new ChangeService(
    home as never,
    drafts as never,
    ai as never,
    access as never,
    checkup as never,
  );
  return { service, home, drafts, ai, checkup, state, draft };
}

describe('ChangeService (change by chat)', () => {
  it('proposes what ally-ai suggests, with the pack rules as context', async () => {
    const h = build();
    h.ai.proposeChange.mockResolvedValue({
      reply: "I'd make it formal.",
      refused: false,
      changes: [{ field: 'tone', before: 'warm', after: 'formal' }],
    });
    const proposal = await h.service.propose('bot', 'make it more formal');
    expect(proposal.changes).toEqual([
      { field: 'tone', before: 'warm', after: 'formal' },
    ]);
    expect(
      h.ai.proposeChange.mock.calls[0][0].safety_rules.length,
    ).toBeGreaterThan(0);
    expect(h.home.saveField).not.toHaveBeenCalled();
  });

  it("a refusal comes back in the deck's words, with nothing to apply", async () => {
    const h = build();
    h.ai.proposeChange.mockResolvedValue({
      reply: '',
      refused: true,
      changes: [],
    });
    const proposal = await h.service.propose(
      'bot',
      'turn off the crisis rules',
    );
    expect(proposal).toEqual({
      refused: true,
      message:
        "That would turn off a safety rule, so I can't make that change. I can add a rule of your own instead.",
      changes: [],
    });
  });

  it('applies through the home field saves, records it and schedules a checkup', async () => {
    const h = build();
    const { eventId } = await h.service.apply('bot', [
      { field: 'tone', before: 'warm', after: 'formal' },
      { field: 'avoid_topic', after: 'prices' },
      { field: 'add_rule', after: 'Give legal advice' },
    ]);
    expect(h.state.tone).toBe('formal');
    expect(h.state.avoidTopics).toEqual(['prices']);
    expect(h.home.changeRule).toHaveBeenCalledWith(
      'bot',
      expect.objectContaining({ op: 'add', text: 'Give legal advice' }),
      // Recorded once, as the change by chat, not again as an edit by hand (chunk 20d-2).
      { record: false },
    );
    expect(h.draft.events.map((e) => e.id)).toContain(eventId);
    expect(h.checkup.scheduleAfterChange).toHaveBeenCalledWith('bot');
  });

  it('refuses as stale when the value changed since the proposal', async () => {
    const h = build({ tone: 'balanced' });
    await expect(
      h.service.apply('bot', [
        { field: 'tone', before: 'warm', after: 'formal' },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never writes a field outside the list (the pack is out of reach)', async () => {
    const h = build();
    await expect(
      h.service.apply('bot', [
        { field: 'safetyPack', before: 'x', after: 'standard' },
      ]),
    ).rejects.toThrow();
    expect(h.home.saveField).not.toHaveBeenCalled();
  });

  it('undo puts it back and is recorded', async () => {
    const h = build();
    const { eventId } = await h.service.apply('bot', [
      { field: 'tone', before: 'warm', after: 'formal' },
      { field: 'avoid_topic', after: 'prices' },
    ]);
    await h.service.undo('bot', eventId);
    expect(h.state.tone).toBe('warm');
    expect(h.state.avoidTopics).toEqual([]);
    expect(h.draft.events.find((e) => e.id === eventId)?.undoneBy).toBeTruthy();
    expect(h.draft.events[h.draft.events.length - 1]?.kind).toBe('undo');
  });
});

describe('CheckupService.scheduleAfterChange', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once, 2 minutes after the last change', () => {
    const service = new CheckupService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const start = jest.spyOn(service, 'start').mockResolvedValue({} as never);
    service.scheduleAfterChange('bot');
    jest.advanceTimersByTime(60_000);
    service.scheduleAfterChange('bot');
    jest.advanceTimersByTime(119_000);
    expect(start).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('bot', { trigger: 'after_change' });
  });
});
