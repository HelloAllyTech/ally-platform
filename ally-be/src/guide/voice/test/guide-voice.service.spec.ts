import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GuideVoiceService } from '../guide-voice.service';

function setup(switches: { voice?: boolean; enabled?: boolean } = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const livekit = {
    createRoom: jest.fn(async () => undefined),
    generateAccessToken: jest.fn(async (dto: any) => ({
      token: 'jwt',
      roomName: dto.roomName,
      serverUrl: 'wss://lk',
    })),
    agentDispatch: jest.fn(async () => undefined),
  };
  const settings = {
    switches: jest.fn(async () => ({ voice: switches.voice ?? true })),
    isGuidedAvailable: jest.fn(async () => switches.enabled ?? true),
  };
  const service = new GuideVoiceService(
    livekit as never,
    redis as never,
    settings as never,
    { livekit: { guideAgentName: 'AgentGuide' } } as never,
  );
  return { service, livekit, store };
}

const thread = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  trackId: 'tr1',
  languageCode: 'hi',
};
const user = { id: 3, tenantId: 'org', username: 'x' };

describe('GuideVoiceService', () => {
  it('refuses when voice is switched off', async () => {
    await expect(
      setup({ voice: false }).service.startSession(thread as never, user, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('opens a guide- room, a learner token, and dispatches the guide worker with a session token', async () => {
    const t = setup();
    const result = await t.service.startSession(thread as never, user, {
      turnMode: 'push_to_talk',
    });
    expect(result.roomName).toMatch(/^guide-a1b2c3d4-[0-9a-f]{8}$/);
    expect(result).toMatchObject({ token: 'jwt', serverUrl: 'wss://lk' });
    const [room, agent, metadata] = t.livekit.agentDispatch.mock
      .calls[0] as unknown as [string, string, string];
    expect(room).toBe(result.roomName);
    expect(agent).toBe('AgentGuide');
    const parsed = JSON.parse(metadata);
    expect(parsed).toMatchObject({
      kind: 'ally_guide',
      language: 'hi',
      turnMode: 'push_to_talk',
    });
    // The worker's token resolves to this thread and learner.
    await expect(
      t.service.resolve(parsed.voiceSessionToken),
    ).resolves.toMatchObject({
      threadId: thread.id,
      userId: 3,
      tenantId: 'org',
    });
  });

  it('keeps one session per thread: a new one ends the old token', async () => {
    const t = setup();
    await t.service.startSession(thread as never, user, {});
    const first = JSON.parse(
      (t.livekit.agentDispatch.mock.calls[0] as any)[2],
    ).voiceSessionToken;
    await t.service.startSession(thread as never, user, {});
    await expect(t.service.resolve(first)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('ends a session so its token stops working', async () => {
    const t = setup();
    await t.service.startSession(thread as never, user, {});
    const token = JSON.parse(
      (t.livekit.agentDispatch.mock.calls[0] as any)[2],
    ).voiceSessionToken;
    await t.service.end(token);
    await expect(t.service.resolve(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
