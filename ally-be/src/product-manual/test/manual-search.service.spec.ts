import {
  escapeHtml,
  highlightToHtml,
  ManualSearchService,
} from '../service/manual-search.service';

const START = '\u0001';
const STOP = '\u0002';

describe('highlightToHtml', () => {
  it('turns only the private markers into <mark> and escapes everything else', () => {
    const fragment = `Start a ${START}roleplay${STOP} <script>alert(1)</script> & "quotes" 'x'`;
    expect(highlightToHtml(fragment)).toBe(
      'Start a <mark>roleplay</mark> &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;x&#39;',
    );
  });

  it('a page that contains its own <mark> or <img onerror> cannot inject a tag', () => {
    const html = highlightToHtml(
      `<mark>fake</mark> <img src=x onerror=alert(1)>`,
    );
    expect(html).not.toMatch(/<(?!\/?mark>)/);
    expect(html).not.toContain('<mark>');
    expect(html).toContain('&lt;img');
  });

  it('survives empty input', () => {
    expect(highlightToHtml('')).toBe('');
    expect(escapeHtml('a<b')).toBe('a&lt;b');
  });
});

describe('ManualSearchService.search', () => {
  function build(rows: Record<string, unknown>[] = [], nodes = 3) {
    const query = jest.fn(async (sql: string, ...rest: unknown[]) => {
      void rest;
      return sql.includes('numnode') ? [{ n: nodes }] : rows;
    });
    return { service: new ManualSearchService({ query } as never), query };
  }

  it('returns nothing under two characters without touching the database', async () => {
    const { service, query } = build();
    expect(await service.search('a')).toEqual([]);
    expect(await service.search('  ')).toEqual([]);
    expect(await service.search(undefined as never)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('runs a parameterised websearch_to_tsquery and never interpolates the text', async () => {
    const { service, query } = build();
    const q = `roleplay'); DROP TABLE manual_pages; --`;
    await service.search(q, 5);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("websearch_to_tsquery('english', $1::text)");
    expect(sql).toContain('ts_rank_cd');
    expect(sql).toContain('ts_headline');
    expect(sql).not.toContain('DROP TABLE');
    expect(params[0]).toBe(q);
    expect(params[1]).toBe(5);
  });

  it('strips markdown from the headline input only (not the match or the stored text)', async () => {
    const { service, query } = build();
    await service.search('badge');
    const [sql] = query.mock.calls[1] as [string, unknown[]];
    const headline = sql.slice(
      sql.indexOf('ts_headline('),
      sql.indexOf('AS headline'),
    );
    // [[slug|label]] -> label, [[slug]] -> slug, bold / code markers, heading #s, pipes, whitespace.
    expect(headline).toContain("'\\[\\[[^\\]|]*\\|([^\\]]*)\\]\\]', '\\1'");
    expect(headline).toContain("'\\[\\[([^\\]]*)\\]\\]', '\\1'");
    expect(headline).toContain("'\\*\\*|__|[' || chr(96) || ']'");
    expect(headline).toContain('#+');
    expect(headline).toContain("'\\|', ' '");
    expect(headline).toContain("'\\s+', ' '");
    // The tsvector match (@@) and the stored columns are untouched by the cleaning.
    expect(sql).toContain('p.search_vector @@ q.query');
    expect(sql.slice(0, sql.indexOf('ts_headline('))).not.toContain(
      'regexp_replace',
    );
  });

  it('escapes the headline: only <mark> survives', async () => {
    const { service } = build([
      {
        slug: 'a',
        title: 'A',
        parentTitle: 'Top',
        summary: 's',
        rank: '0.42',
        headline: `see ${START}roleplay${STOP} <b onclick=x>bold</b>`,
      },
    ]);
    const [hit] = await service.search('roleplay');
    expect(hit).toEqual({
      slug: 'a',
      title: 'A',
      parentTitle: 'Top',
      snippet: 'see <mark>roleplay</mark> &lt;b onclick=x&gt;bold&lt;/b&gt;',
      rank: 0.42,
    });
  });

  it('falls back to a title match when the query is only stop-words', async () => {
    const { service, query } = build(
      [
        {
          slug: 'the-basics',
          title: 'The basics',
          parentTitle: null,
          summary: 'A <i>start</i>',
          headline: null,
          rank: 0,
        },
      ],
      0,
    );
    const hits = await service.search('the');
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('ILIKE');
    expect(params[0]).toBe('%the%');
    expect(hits[0].snippet).toBe('A &lt;i&gt;start&lt;/i&gt;');
  });

  it('escapes LIKE wildcards in the title fallback', async () => {
    const { service, query } = build([], 0);
    await service.search('100%_x');
    expect((query.mock.calls[1] as [string, unknown[]])[1][0]).toBe(
      '%100\\%\\_x%',
    );
  });

  it('clamps the limit to 1..50 and defaults to 20', async () => {
    const a = build();
    await a.service.search('roleplay');
    expect((a.query.mock.calls[1] as [string, unknown[]])[1][1]).toBe(20);
    const b = build();
    await b.service.search('roleplay', 9999);
    expect((b.query.mock.calls[1] as [string, unknown[]])[1][1]).toBe(50);
  });
});
