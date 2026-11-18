import { BOT_PAGE_OTP, BotPageOtpService } from '../bot-page-otp.service';
import { FakeRedis } from './fake-redis';

const PAGE = { title: 'Sunrise Mind', accentColour: '#336699' };

function harness(isDevelopment = false) {
  const redis = new FakeRedis();
  const sent: { to: string; code: string }[] = [];
  const email = {
    sendBotPageCode: jest.fn(async (p: { to: string; code: string }) => {
      sent.push(p);
      return true;
    }),
  };
  const config = {
    isDevelopment,
    botPage: { visitorSecret: '' },
    jwt: { accessToken: { secret: 'access-secret' } },
  };
  const service = new BotPageOtpService(
    redis as never,
    email as never,
    config as never,
  );
  return { redis, email, sent, service };
}

describe('BotPageOtpService', () => {
  it('sends a 6-digit code that works once', async () => {
    const { service, sent } = harness();
    expect(await service.send('bot', 'Asha@Example.com', PAGE)).toBe('sent');
    const code = sent[0].code;
    expect(code).toMatch(/^\d{6}$/);
    expect(await service.check('bot', 'asha@example.com', code)).toBe('ok');
    expect(await service.check('bot', 'asha@example.com', code)).toBe(
      'expired',
    );
  });

  it('stores neither the code nor the address', async () => {
    const { service, sent, redis } = harness();
    await service.send('bot', 'asha@example.com', PAGE);
    const dump = JSON.stringify([...redis.values.entries()]);
    expect(dump).not.toContain(sent[0].code);
    expect(dump).not.toContain('asha');
  });

  it('says wrong while tries remain, and burns the code on the fifth wrong try', async () => {
    const { service, sent } = harness();
    await service.send('bot', 'asha@example.com', PAGE);
    const wrong = sent[0].code === '000000' ? '111111' : '000000';
    for (let i = 1; i < BOT_PAGE_OTP.maxTries; i++) {
      expect(await service.check('bot', 'asha@example.com', wrong)).toBe(
        'wrong',
      );
    }
    expect(await service.check('bot', 'asha@example.com', wrong)).toBe(
      'too_many',
    );
    expect(await service.check('bot', 'asha@example.com', sent[0].code)).toBe(
      'expired',
    );
  });

  it('is expired when no code was sent, or for another bot', async () => {
    const { service, sent } = harness();
    expect(await service.check('bot', 'asha@example.com', '123456')).toBe(
      'expired',
    );
    await service.send('bot', 'asha@example.com', PAGE);
    expect(
      await service.check('other-bot', 'asha@example.com', sent[0].code),
    ).toBe('expired');
  });

  it('a new code replaces the old one and resets the tries', async () => {
    const { service, sent } = harness();
    await service.send('bot', 'asha@example.com', PAGE);
    await service.send('bot', 'asha@example.com', PAGE);
    if (sent[0].code !== sent[1].code) {
      expect(await service.check('bot', 'asha@example.com', sent[0].code)).toBe(
        'wrong',
      );
    }
    expect(await service.check('bot', 'asha@example.com', sent[1].code)).toBe(
      'ok',
    );
  });

  it('sends at most five codes per address per window', async () => {
    const { service, email } = harness();
    for (let i = 0; i < BOT_PAGE_OTP.maxSends; i++) {
      expect(await service.send('bot', 'asha@example.com', PAGE)).toBe('sent');
    }
    expect(await service.send('bot', 'asha@example.com', PAGE)).toBe(
      'too_many',
    );
    expect(email.sendBotPageCode).toHaveBeenCalledTimes(BOT_PAGE_OTP.maxSends);
  });

  it('withdraws a code that could not be emailed', async () => {
    const { service, email, redis } = harness();
    email.sendBotPageCode.mockRejectedValueOnce(new Error('ses down'));
    expect(await service.send('bot', 'asha@example.com', PAGE)).toBe('failed');
    expect(
      [...redis.values.keys()].some((k) => k.startsWith('bp:otp:code:')),
    ).toBe(false);
  });

  it('keeps the code in development when the email could not be sent (no local SES)', async () => {
    const { service, email } = harness(true);
    email.sendBotPageCode.mockRejectedValueOnce(new Error('ses down'));
    expect(await service.send('bot', 'asha@example.com', PAGE)).toBe('sent');
  });
});
