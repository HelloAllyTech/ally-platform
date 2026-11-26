import { LateCrisisService } from '../late-crisis.service';

describe('LateCrisisService (WA-A §0a)', () => {
  const AT_RISK = {
    is_crisis: true,
    confidence: 0.9,
    signal: 'end it',
    failed: false,
  };
  const turn = (over: Record<string, unknown> = {}) => ({
    chatbot: { id: 'bot-1', name: 'Sukoon' },
    conversationId: 'conv-1',
    channel: { type: 'whatsapp' },
    sender: { label: '…3210' },
    ...over,
  });
  const harness = () => {
    const query = jest.fn().mockResolvedValue([]);
    const crisis = { flag: jest.fn().mockResolvedValue(undefined) };
    const events = { publishInbox: jest.fn().mockResolvedValue(undefined) };
    const emitter = { emit: jest.fn() };
    const service = new LateCrisisService(
      { query } as never,
      crisis as never,
      events as never,
      emitter as never,
    );
    return { service, query, crisis, events, emitter };
  };

  it('flags the chat as at risk, tells the Inbox and sends the crisis alert', async () => {
    const h = harness();
    await expect(h.service.flag(turn(), AT_RISK)).resolves.toBe(true);
    expect(h.query).toHaveBeenCalledWith(
      expect.stringContaining('SET safety_at = now()'),
      ['conv-1'],
    );
    expect(h.crisis.flag).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bot-1' }),
      'conv-1',
      { level: 1, path: 'classifier' },
    );
    expect(h.events.publishInbox).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'safety', conversationId: 'conv-1' }),
    );
    expect(h.emitter.emit).toHaveBeenCalledWith(
      'exception',
      expect.objectContaining({
        path: 'chatbot/crisis',
        message: expect.stringContaining('fired late'),
      }),
    );
  });

  it('flags a medical emergency at level 2', async () => {
    const h = harness();
    await h.service.flag(turn(), { ...AT_RISK, level: 'emergency' } as never);
    expect(h.crisis.flag).toHaveBeenCalledWith(expect.anything(), 'conv-1', {
      level: 2,
      path: 'classifier',
    });
  });

  it('never flags the test console, a turn with no conversation, or a verdict not at risk', async () => {
    const h = harness();
    expect(
      await h.service.flag(turn({ channel: { type: 'test' } }), AT_RISK),
    ).toBe(false);
    expect(
      await h.service.flag(turn({ conversationId: undefined }), AT_RISK),
    ).toBe(false);
    expect(await h.service.flag(turn(), { ...AT_RISK, is_crisis: false })).toBe(
      false,
    );
    expect(h.crisis.flag).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const h = harness();
    h.crisis.flag.mockRejectedValueOnce(new Error('db down'));
    await expect(h.service.flag(turn(), AT_RISK)).resolves.toBe(false);
  });
});
