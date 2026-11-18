import { QueryRunner } from 'typeorm';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../whatsapp/type/whatsapp-settings.type';
import { KeepEightPassages1984600000000 } from './1984600000000-KeepEightPassages';

const run = async (direction: 'up' | 'down') => {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  await new KeepEightPassages1984600000000()[direction](queryRunner);
  return queries;
};

describe('KeepEightPassages (Q3-fast)', () => {
  it('keeps 8 passages by default, and moves the seeded platform value only where it is still 5', async () => {
    expect(DEFAULT_WHATSAPP_SETTINGS.retrieval.maxPassages).toBe(8);
    const [up] = await run('up');
    expect(up).toContain(`'{retrieval,maxPassages}', '8'::jsonb`);
    expect(up).toContain(`name = 'whatsapp_bot'`);
    expect(up).toContain(`(value #>> '{retrieval,maxPassages}') = '5'`);
    const [down] = await run('down');
    expect(down).toContain(`(value #>> '{retrieval,maxPassages}') = '8'`);
  });
});
