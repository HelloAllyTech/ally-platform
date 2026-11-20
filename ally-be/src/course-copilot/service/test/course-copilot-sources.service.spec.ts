import { BadRequestException } from '@nestjs/common';
import {
  COURSE_COPILOT_SOURCE_LIMITS,
  COURSE_COPILOT_SOURCE_RULES,
} from '../../constants/course-copilot.constants';
import { CourseCopilotSessionStatus } from '../../enum/course-copilot.enum';
import {
  CourseCopilotSource,
  CourseCopilotSourceChunk,
} from '../../entity/course-copilot-source.entity';
import {
  CourseCopilotSourcesService,
  citeLabel,
  kindOf,
  rankPassages,
  tokenize,
  toChunks,
} from '../course-copilot-sources.service';
import * as pptx from '../../util/pptx.extractor';

const chunk = (
  index: number,
  text: string,
  extra: Partial<CourseCopilotSourceChunk> = {},
): CourseCopilotSourceChunk => ({
  index,
  text,
  pageFrom: index + 1,
  pageTo: index + 1,
  section: null,
  ...extra,
});

const source = (
  id: string,
  fileName: string,
  chunks: CourseCopilotSourceChunk[],
  extra: Partial<CourseCopilotSource> = {},
): CourseCopilotSource =>
  ({
    id,
    sessionId: 'session-1',
    tenantId: 'org-1',
    fileName,
    kind: 'pdf',
    sizeBytes: 1000,
    pageCount: chunks.length,
    charCount: chunks.reduce((sum, c) => sum + c.text.length, 0),
    chunks,
    createdBy: 1,
    createdAt: new Date('2026-11-19T00:00:00Z'),
    updatedAt: new Date('2026-11-19T00:00:00Z'),
    ...extra,
  }) as CourseCopilotSource;

const manual = source('s-1', 'Volunteer Manual.pdf', [
  chunk(0, 'Welcome to the peer support programme and its values.'),
  chunk(
    1,
    'Ask directly about suicide: "Are you thinking about killing yourself?" Asking does not plant the idea.',
    { section: 'Chapter 3 > Asking about suicide' },
  ),
  chunk(
    2,
    'Safety planning: remove means, list contacts, call Tele-MANAS 14416.',
    {
      section: 'Chapter 4 > Safety planning',
    },
  ),
]);

const session = (status = CourseCopilotSessionStatus.INTERVIEWING) =>
  ({ id: 'session-1', tenantId: 'org-1', status }) as any;

const file = (name: string, mimetype = '', bytes = 10) => ({
  originalname: name,
  mimetype,
  size: bytes,
  buffer: Buffer.alloc(bytes, 1),
});

describe('CourseCopilotSourcesService', () => {
  let repository: Record<string, jest.Mock>;
  let service: CourseCopilotSourcesService;

  beforeEach(() => {
    repository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({
        id: 'new-1',
        createdAt: new Date('2026-11-19T00:00:00Z'),
        ...row,
      })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new CourseCopilotSourcesService(repository as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('upload', () => {
    it('keeps only the extracted passages, scoped to the session and its organisation', async () => {
      jest.spyOn(pptx, 'extractPptx').mockResolvedValue({
        text: 'Slide one\n\nRisk signs and what to ask.',
        pages: [
          { number: 1, start: 0, end: 9 },
          { number: 2, start: 11, end: 38 },
        ],
        sections: [],
      });

      const summary = await service.upload(
        session(),
        file('Training deck.pptx'),
        7,
      );

      const saved = repository.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        sessionId: 'session-1',
        tenantId: 'org-1',
        fileName: 'Training deck.pptx',
        kind: 'pptx',
        pageCount: 2,
        createdBy: 7,
      });
      expect(saved).not.toHaveProperty('buffer');
      expect(saved.chunks.length).toBeGreaterThan(0);
      expect(summary).toMatchObject({
        id: 'new-1',
        fileName: 'Training deck.pptx',
        kind: 'pptx',
        passageCount: saved.chunks.length,
      });
    });

    it('refuses a file it cannot read, naming the formats it can', async () => {
      await expect(
        service.upload(session(), file('notes.txt', 'text/plain'), 1),
      ).rejects.toThrow(
        'Attach a PDF, Word (.docx) or PowerPoint (.pptx) file.',
      );
    });

    it('refuses a file over the size limit', async () => {
      await expect(
        service.upload(
          session(),
          file('big.pdf', '', COURSE_COPILOT_SOURCE_LIMITS.maxBytes + 1),
          1,
        ),
      ).rejects.toThrow('Files can be up to 50 MB.');
    });

    it('refuses an eleventh file', async () => {
      repository.find.mockResolvedValue(
        Array.from({ length: COURSE_COPILOT_SOURCE_LIMITS.maxFiles }, (_, i) =>
          source(`s-${i}`, `f${i}.pdf`, []),
        ),
      );
      await expect(
        service.upload(session(), file('one-more.pdf'), 1),
      ).rejects.toThrow('up to 10 reference files');
    });

    it('refuses the same file twice', async () => {
      repository.find.mockResolvedValue([manual]);
      await expect(
        service.upload(session(), file('Volunteer Manual.pdf'), 1),
      ).rejects.toThrow('already attached');
    });

    it('refuses changes while the course builds, or once archived', async () => {
      await expect(
        service.upload(
          session(CourseCopilotSessionStatus.BUILDING),
          file('a.pdf'),
          1,
        ),
      ).rejects.toThrow('Wait for the build to finish');
      await expect(
        service.remove(session(CourseCopilotSessionStatus.ARCHIVED), 's-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('says when a file has no text to read', async () => {
      jest.spyOn(pptx, 'extractPptx').mockResolvedValue({
        text: '   ',
        pages: [],
        sections: [],
      });
      await expect(
        service.upload(session(), file('images-only.pptx'), 1),
      ).rejects.toThrow('No text was found');
    });
  });

  describe('remove', () => {
    it('deletes only within the session', async () => {
      await service.remove(session(), 's-1');
      expect(repository.delete).toHaveBeenCalledWith({
        id: 's-1',
        sessionId: 'session-1',
      });
    });

    it('says so when the file is not attached to this session', async () => {
      repository.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove(session(), 'other')).rejects.toThrow(
        'not attached to this course',
      );
    });

    it('removeAll deletes every file of the session (on archive)', async () => {
      repository.delete.mockResolvedValue({ affected: 3 });
      expect(await service.removeAll('session-1')).toBe(3);
      expect(repository.delete).toHaveBeenCalledWith({
        sessionId: 'session-1',
      });
    });
  });

  describe('overview', () => {
    it('is null without files, so the interviewer context is unchanged', async () => {
      expect(await service.overview('session-1')).toBeNull();
    });

    it('lists each file with its headings and opening, and how to use them', async () => {
      repository.find.mockResolvedValue([manual]);
      const text = (await service.overview('session-1'))!;

      expect(text).toContain('REFERENCE MATERIAL');
      expect(text).toContain(COURSE_COPILOT_SOURCE_RULES.interviewer);
      expect(text).toContain('FILE: Volunteer Manual.pdf (3 pages)');
      expect(text).toContain('Chapter 3 > Asking about suicide');
      expect(text).toContain('Welcome to the peer support programme');
    });
  });

  describe('referenceFor', () => {
    it('is null without files, so writers send the prompt they sent before', async () => {
      expect(await service.referenceFor('session-1', 'suicide')).toBeNull();
    });

    it('leads with the usage rule and cites each passage by file and page', async () => {
      repository.find.mockResolvedValue([manual]);
      const reference = (await service.referenceFor(
        'session-1',
        'how to ask directly about suicide',
      ))!;

      expect(
        reference.text.startsWith(COURSE_COPILOT_SOURCE_RULES.writer),
      ).toBe(true);
      expect(reference.text).toContain(
        '[1] Volunteer Manual.pdf, p. 2 — Chapter 3 > Asking about suicide',
      );
      expect(reference.labels[0]).toBe('Volunteer Manual.pdf, p. 2');
    });

    it('stays within the character budget but always gives at least one passage', async () => {
      repository.find.mockResolvedValue([manual]);
      const reference = (await service.referenceFor(
        'session-1',
        'suicide safety',
        {
          maxChars: 10,
        },
      ))!;
      expect(reference.labels).toHaveLength(1);
    });
  });
});

describe('rankPassages', () => {
  it('puts the passage about the query first, and drops passages with no match', () => {
    const hits = rankPassages([manual], 'safety planning contacts', 5);
    expect(hits[0].label).toBe('Volunteer Manual.pdf, p. 3');
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
    expect(hits.map((h) => h.label)).not.toContain(
      'Volunteer Manual.pdf, p. 1',
    );
  });

  it('matches section headings as well as text', () => {
    const hits = rankPassages([manual], 'chapter asking', 1);
    expect(hits[0].section).toBe('Chapter 3 > Asking about suicide');
  });

  it('returns nothing for a query of only common words', () => {
    expect(rankPassages([manual], 'the and of it', 5)).toEqual([]);
  });

  it('searches across every file of the session', () => {
    const deck = source(
      's-2',
      'Deck.pptx',
      [chunk(0, 'Role play: a student who stopped attending classes.')],
      { kind: 'pptx' },
    );
    const hits = rankPassages([manual, deck], 'student classes', 5);
    expect(hits[0].label).toBe('Deck.pptx, slide 1');
  });
});

describe('helpers', () => {
  it('kindOf reads the extension or the content type', () => {
    expect(kindOf({ originalname: 'A.PDF', mimetype: '' })).toBe('pdf');
    expect(kindOf({ originalname: 'notes', mimetype: 'application/pdf' })).toBe(
      'pdf',
    );
    expect(kindOf({ originalname: 'x.docx', mimetype: '' })).toBe('docx');
    expect(kindOf({ originalname: 'x.pptx', mimetype: '' })).toBe('pptx');
    expect(kindOf({ originalname: 'x.ppt', mimetype: '' })).toBeNull();
  });

  it('citeLabel says page, page range, slide, or just the file', () => {
    const pdf = { fileName: 'M.pdf', kind: 'pdf' as const };
    expect(citeLabel(pdf, { pageFrom: 4, pageTo: 4 })).toBe('M.pdf, p. 4');
    expect(citeLabel(pdf, { pageFrom: 4, pageTo: 5 })).toBe('M.pdf, p. 4–5');
    expect(
      citeLabel(
        { fileName: 'D.pptx', kind: 'pptx' },
        { pageFrom: 2, pageTo: 2 },
      ),
    ).toBe('D.pptx, slide 2');
    expect(
      citeLabel(
        { fileName: 'W.docx', kind: 'docx' },
        { pageFrom: null, pageTo: null },
      ),
    ).toBe('W.docx');
  });

  it('tokenize drops short and common words, keeps other scripts', () => {
    expect(tokenize('The ASHA worker asks about it')).toEqual([
      'asha',
      'worker',
      'asks',
    ]);
    expect(tokenize('आत्महत्या के बारे में पूछें')).toContain('आत्महत्या');
  });

  it('toChunks keeps page spans and drops empty passages', () => {
    const chunks = toChunks({
      text: 'Page one text.\n\nPage two text.',
      pages: [
        { number: 1, start: 0, end: 14 },
        { number: 2, start: 16, end: 30 },
      ],
      sections: [],
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks.every((c) => c.text.trim())).toBe(true);
  });
});
