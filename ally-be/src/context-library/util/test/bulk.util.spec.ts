import { FIRST_PRINCIPLES_PROFILE } from '../../profiles/first-principles.profile';
import { parseBulkFile, templateColumns, templateCsv } from '../bulk.util';

describe('bulk upload parsing', () => {
  it("serves a template with the profile's fields", () => {
    const columns = templateColumns(FIRST_PRINCIPLES_PROFILE);
    expect(columns).toEqual(
      expect.arrayContaining(['statement', 'domain', 'rationale', 'strength']),
    );
    expect(templateCsv(FIRST_PRINCIPLES_PROFILE).endsWith('\n')).toBe(true);
  });

  it('parses CSV rows, splitting list cells on |, and reports bad rows by spreadsheet row number', () => {
    const csv = [
      'statement,situations,keywords,domain,prdSections,rationale,kind,strength,pinned',
      'Design the empty state first,a list can be empty|first use,empty state|zero state,ux_ui,ux_states|scope,New users see it first,rule,must,yes',
      ',x,,ux_ui,,why,rule,must,',
      'Valid but odd domain,,,astrology,,why,rule,must,',
    ].join('\n');
    const result = parseBulkFile(
      FIRST_PRINCIPLES_PROFILE,
      'entries.csv',
      Buffer.from(csv),
    );
    expect(result.rows).toHaveLength(1);
    const [{ row, input }] = result.rows;
    expect(row).toBe(2);
    expect(input.situations).toEqual(['a list can be empty', 'first use']);
    expect(input.facets).toEqual({
      domain: 'ux_ui',
      prdSections: ['ux_states', 'scope'],
    });
    expect(input.pinned).toBe(true);
    expect(result.rejected.map((r) => r.row)).toEqual([3, 4]);
    expect(result.rejected[0].reason).toContain('missing statement');
    expect(result.rejected[1].reason).toContain(
      'invalid facet (domain): astrology',
    );
  });

  it('parses JSON arrays with real lists', () => {
    const json = JSON.stringify([
      {
        statement: 'Keep error messages specific',
        keywords: ['errors'],
        domain: 'content_copy',
        kind: 'rule',
        strength: 'should',
        rationale: 'Specific errors tell people what to do.',
      },
    ]);
    const result = parseBulkFile(
      FIRST_PRINCIPLES_PROFILE,
      'entries.json',
      Buffer.from(json),
    );
    expect(result.rejected).toEqual([]);
    expect(result.rows[0].input.keywords).toEqual(['errors']);
  });

  it('refuses a file it cannot read', () => {
    expect(() =>
      parseBulkFile(
        FIRST_PRINCIPLES_PROFILE,
        'x.json',
        Buffer.from('{"not":"an array"}'),
      ),
    ).toThrow(/Could not read the file/);
  });
});
