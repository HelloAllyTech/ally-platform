import { QueryRunner } from 'typeorm';
import { CleanHelplineNumbers1988150000000 } from './1988150000000-CleanHelplineNumbers';

const SAATHI =
  '+91 20 4860 2525 (calls and WhatsApp chat on the same number). Open every day 10 am to 10 pm, including Sundays and public holidays. Closed on Diwali day (Lakshmi Puja) only. Calls are free from any n';

const run = async (rows: { id: string; numbers: string }[]) => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return sql.includes('SELECT') ? rows : [];
    }),
  } as unknown as QueryRunner;
  await new CleanHelplineNumbers1988150000000().up(queryRunner);
  return calls.slice(1);
};

describe('CleanHelplineNumbers (TF1 round 2, S-1)', () => {
  it("keeps only Saathi's number and asks the owner to confirm it again", async () => {
    const [update] = await run([{ id: 'saathi', numbers: SAATHI }]);
    expect(update.params).toEqual(['saathi', '+91 20 4860 2525', SAATHI]);
    expect(update.sql).toContain(`'helplineSource', 'template'`);
    expect(update.sql).toContain(`'helplineConfirmedAt', NULL`);
  });

  it('leaves a value that is already only numbers alone', async () => {
    expect(
      await run([{ id: 'a', numbers: 'iCall 9152987821, Tele-MANAS 14416' }]),
    ).toEqual([]);
  });

  it('removes a value with no number at all', async () => {
    const [update] = await run([{ id: 'b', numbers: 'Open 10 am to 10 pm' }]);
    expect(update.params).toEqual(['b', '', 'Open 10 am to 10 pm']);
    expect(update.sql).toContain(`settings - 'helplineNumbers'`);
  });

  it('down puts the old text back unconfirmed, never into crisis replies', async () => {
    const calls: string[] = [];
    await new CleanHelplineNumbers1988150000000().down({
      query: jest.fn(async (sql: string) => calls.push(sql)),
    } as unknown as QueryRunner);
    expect(calls[0]).toContain(`'helplineConfirmedAt', NULL`);
    expect(calls[0]).toContain(`'helplineSource', 'template'`);
  });
});
