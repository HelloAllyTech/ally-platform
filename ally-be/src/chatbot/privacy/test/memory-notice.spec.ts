import { MemoryConsentService } from '../memory-consent.service';
import { NOTICE_WORDING_VERSION } from '../memory-consent-copy';

/**
 * TF1 B1: with memory on from a template, an adult is told one line ("Say 'forget me' any time")
 * and memory starts; young or unstated audiences are still asked YES or NO.
 */
describe('the memory notice (TF1 B1)', () => {
  const NOTICE =
    'I can remember your name and your applications so you don’t have to repeat them. Say ‘forget me’ any time.';

  const setup = (settings: Record<string, unknown>) => {
    const writes: unknown[][] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('to_regclass')) return [{ t: null }];
      if (sql.includes('FROM memory_consents')) return [];
      if (sql.includes('FROM chatbots')) return [{ settings }];
      if (sql.startsWith('INSERT INTO memory_consents')) writes.push(params);
      return [];
    });
    return { service: new MemoryConsentService({ query } as never), writes };
  };

  it('an adult is told, and the answer is recorded as yes', async () => {
    const { service, writes } = setup({
      audienceAge: 'adults',
      memory: { on: true, notice: NOTICE },
    });
    const asked = await service.ask('bot-1', 'contact-1', 'en');
    expect(asked).toEqual({
      text: NOTICE,
      wordingVersion: NOTICE_WORDING_VERSION,
    });
    expect(writes[0]).toEqual(
      expect.arrayContaining(['granted', NOTICE_WORDING_VERSION]),
    );
  });

  it('in Hindi, the fixed Hindi notice', async () => {
    const { service } = setup({
      audienceAge: 'adults',
      memory: { on: true, notice: NOTICE },
    });
    expect((await service.ask('bot-1', 'contact-1', 'hi'))?.text).toMatch(
      /मुझे भूल जाओ/,
    );
  });

  it('a young or unstated audience is still asked YES or NO', async () => {
    const { service, writes } = setup({
      audienceAge: 'under_18',
      memory: { on: true, notice: NOTICE },
    });
    const asked = await service.ask('bot-1', 'contact-1', 'en');
    expect(asked?.text).toMatch(/Reply YES or NO/);
    expect(writes[0]).toEqual(expect.arrayContaining(['contact:contact-1']));
    expect(writes[0]).not.toEqual(expect.arrayContaining(['granted']));
  });
});
