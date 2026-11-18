import { DropDebriefRiskCueOptions1984300000000 } from './1984300000000-DropDebriefRiskCueOptions';

describe('DropDebriefRiskCueOptions', () => {
  const runner = () => {
    const queries: string[] = [];
    return {
      queries,
      qr: {
        query: jest.fn(async (sql: string) => void queries.push(sql)),
      } as any,
    };
  };

  it('drops the table, and only that', async () => {
    const { qr, queries } = runner();
    await new DropDebriefRiskCueOptions1984300000000().up(qr);
    expect(queries).toEqual([
      `DROP TABLE IF EXISTS "debrief_risk_cue_options"`,
    ]);
  });

  it('rebuilds it with its two seeded options on the way back', async () => {
    const { qr, queries } = runner();
    await new DropDebriefRiskCueOptions1984300000000().down(qr);
    const all = queries.join('\n');
    expect(all).toContain(
      'CREATE TABLE IF NOT EXISTS "debrief_risk_cue_options"',
    );
    expect(all).toContain("'standard'");
    expect(all).toContain("'part_of_practice'");
  });
});
