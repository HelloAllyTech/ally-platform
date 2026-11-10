import { NotFoundException } from '@nestjs/common';
import {
  chosen,
  normalisePattern,
  sectionOf,
  SHORTCUT_SECTIONS,
} from '../crawl/url-scope';
import { LearnedSection } from '../enum/bot-draft.enum';
import { SourcesService, cleanChoice } from '../home/sources.service';
import type { CrawlPage, LearnedFact } from '../type/bot-draft.type';
import { memoryDrafts } from './memory-drafts';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const SITE = 'https://sunrise.example';
const page = (path: string, title: string): CrawlPage => ({
  url: `${SITE}${path}`,
  title,
  status: 'read',
  documentId: `doc-${title.toLowerCase()}`,
});
const fact = (id: string, path: string, by = false): LearnedFact => ({
  id,
  section: LearnedSection.SERVICES,
  text: `${id} text`,
  sourceUrl: `${SITE}${path}`,
  byOwner: by,
});

describe('choosing pages', () => {
  it('matches path prefixes on segment boundaries; an exclude always wins', () => {
    const choice = {
      include: ['/services', '/fees'],
      exclude: ['/services/old'],
    };
    expect(chosen(`${SITE}/services`, choice)).toBe(true);
    expect(chosen(`${SITE}/services/couples`, choice)).toBe(true);
    expect(chosen(`${SITE}/servicesxyz`, choice)).toBe(false);
    expect(chosen(`${SITE}/services/old/page`, choice)).toBe(false);
    expect(chosen(`${SITE}/blog/post`, choice)).toBe(false);
    expect(chosen(`${SITE}/blog/post`, { include: [], exclude: [] })).toBe(
      true,
    );
    expect(
      chosen(`${SITE}/Blog/Post`, { include: [], exclude: ['/blog'] }),
    ).toBe(false);
  });

  it('cleans what the owner sends', () => {
    expect(normalisePattern(' /Blog/ ')).toBe('/blog');
    expect(normalisePattern('/blog?x=1')).toBe('/blog');
    expect(normalisePattern('blog')).toBeNull();
    expect(
      cleanChoice({ include: ['/a', '/a/', 'x'], exclude: ['/careers'] }),
    ).toEqual({ include: ['/a'], exclude: ['/careers'] });
  });

  it('groups pages by section, and the shortcuts name blog, news and careers', () => {
    expect(sectionOf(`${SITE}/`)).toBe('');
    expect(sectionOf(`${SITE}/Blog/one`)).toBe('blog');
    expect(SHORTCUT_SECTIONS.blog).toEqual(
      expect.arrayContaining(['blog', 'news']),
    );
    expect(SHORTCUT_SECTIONS.careers).toContain('careers');
  });
});

function harness() {
  const store = memoryDrafts({
    chatbotId: 'bot-1',
  });
  const pages = [
    page('/', 'Home'),
    page('/fees', 'Fees'),
    page('/blog/one', 'Post'),
  ];
  store.poke({
    crawl: { ...store.row().crawl, pages },
    learned: {
      facts: [
        fact('f1', '/fees'),
        fact('f2', '/fees'),
        fact('f3', '/'),
        fact('f4', '/blog/one'),
      ],
      dropped: 0,
    },
  });
  const dataSource = { query: jest.fn(async () => []) };
  const checkup = { scheduleAfterChange: jest.fn() };
  const crawl = {
    discover: jest.fn(async () => [
      { url: `${SITE}/`, title: 'Home', read: true },
      { url: `${SITE}/fees`, title: 'Fees', read: true },
      { url: `${SITE}/blog/one`, title: 'Post', read: true },
      { url: `${SITE}/careers/nurse`, title: null, read: false },
    ]),
  };
  const access = { assert: jest.fn(async () => ({ role: 'editor' })) };
  const service = new SourcesService(
    store.service,
    crawl as never,
    access as never,
    checkup as never,
    dataSource as never,
  );
  return { store, service, dataSource, checkup };
}

describe('SourcesService', () => {
  it('lists each page it read with how many details came from it', async () => {
    const h = harness();
    const list = await h.service.list('bot-1');
    expect(list.map((s) => [s.title, s.details, s.removed])).toEqual([
      ['Home', 1, false],
      ['Fees', 2, false],
      ['Post', 1, false],
    ]);
  });

  it('previews a removal without removing anything', async () => {
    const h = harness();
    await expect(h.service.preview('bot-1', `${SITE}/fees`)).resolves.toEqual({
      url: `${SITE}/fees`,
      title: 'Fees',
      details: 2,
    });
    expect(h.store.row().learned.facts).toHaveLength(4);
    expect(h.dataSource.query).not.toHaveBeenCalled();
  });

  it('removes a page: its details, its document from the assistant, and never reads it again', async () => {
    const h = harness();
    const { eventId } = await h.service.remove('bot-1', `${SITE}/fees`);
    const row = h.store.row();
    expect(row.learned.facts.map((f) => f.id)).toEqual(['f3', 'f4']);
    expect(row.source.removed).toEqual([`${SITE}/fees`]);
    expect(h.dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM chatbot_documents'),
      ['bot-1', ['doc-fees']],
    );
    expect(h.checkup.scheduleAfterChange).toHaveBeenCalledWith('bot-1');
    const listed = await h.service.list('bot-1');
    expect(listed[1]).toMatchObject({ removed: true, details: 2, eventId });
  });

  it('Undo puts back exactly what the removal took', async () => {
    const h = harness();
    const { eventId } = await h.service.remove('bot-1', `${SITE}/fees`);
    await h.service.restore('bot-1', eventId);
    const row = h.store.row();
    expect(row.learned.facts.map((f) => f.id).sort()).toEqual([
      'f1',
      'f2',
      'f3',
      'f4',
    ]);
    expect(row.source.removed).toEqual([]);
    expect(h.dataSource.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO chatbot_documents'),
      ['bot-1', 'doc-fees'],
    );
    await expect(h.service.restore('bot-1', eventId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a page it never read', async () => {
    const h = harness();
    await expect(
      h.service.remove('bot-1', `${SITE}/nowhere`),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('groups the pages found by section, home first', async () => {
    const h = harness();
    const found = await h.service.found('draft-1');
    expect(found.groups.map((g) => g.section)).toEqual([
      '',
      'blog',
      'careers',
      'fees',
    ]);
  });

  it('saves a choice and takes away pages already read that it leaves out, with Undo', async () => {
    const h = harness();
    const result = await h.service.choose('draft-1', {
      include: [],
      exclude: ['/blog/'],
    });
    expect(result).toMatchObject({ removed: 1 });
    let row = h.store.row();
    expect(row.source.pages).toEqual({ include: [], exclude: ['/blog'] });
    expect(row.learned.facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    await h.service.restoreForDraft('draft-1', result.eventId!);
    row = h.store.row();
    expect(row.learned.facts).toHaveLength(4);
    // The choice itself stays: Undo puts the pages back, the owner changes the choice.
    expect(row.source.pages).toEqual({ include: [], exclude: ['/blog'] });
  });
});
