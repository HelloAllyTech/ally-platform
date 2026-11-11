import { BotDraftEntity } from '../entity/bot-draft.entity';
import {
  BotDraftStatus,
  BotDraftStep,
  LearnedSection,
} from '../enum/bot-draft.enum';
import { BotDraftService } from '../service/bot-draft.service';

/**
 * A real `BotDraftService` over one in-memory row, so specs above it run the real patch checks,
 * safety lock and step machine. The fake update mirrors `save`'s SQL: it applies only at the
 * expected version, never writes `crawl`, and keeps the row's `knowledgeDocumentIds`.
 */
export function memoryDrafts(overrides: Partial<BotDraftEntity> = {}) {
  let row: BotDraftEntity = {
    id: 'draft-1',
    ownerUserId: 7,
    tenantId: 'tenant-1',
    status: BotDraftStatus.ACTIVE,
    step: BotDraftStep.LEARNED,
    source: { website: 'https://sunrise.example/' },
    crawl: {
      status: 'done',
      domain: 'sunrise.example',
      queue: [],
      seen: [],
      pages: [
        {
          url: 'https://sunrise.example/',
          title: 'Sunrise Mind',
          status: 'read',
          headings: ['Therapy'],
          snippet: 'We offer therapy.',
        },
      ],
      findings: [],
    },
    learned: {
      facts: [
        {
          id: 'f1',
          section: LearnedSection.SERVICES,
          text: 'Sessions cost ₹2,000.',
          sourceUrl: 'https://sunrise.example/',
        },
      ],
      dropped: 0,
    },
    industry: null,
    safetyPack: null,
    safetyPackVersion: null,
    answers: {},
    design: {},
    draftConfig: BotDraftService.defaultDraft('Sunrise Mind'),
    chatbotId: 'bot-1',
    transcript: [],
    events: [],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BotDraftEntity;

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  let pending: Record<string, unknown> = {};
  let params: Record<string, unknown> = {};
  let where: { id?: string; basedOn?: number } = {};
  const builder = {
    update: () => builder,
    set: (values: Record<string, unknown>) => {
      pending = values;
      return builder;
    },
    where: (_sql: string, values: { id: string; basedOn: number }) => {
      where = values;
      return builder;
    },
    setParameter: (key: string, value: unknown) => {
      params[key] = value;
      return builder;
    },
    execute: async () => {
      if (where.id !== row.id || where.basedOn !== row.version) {
        pending = {};
        params = {};
        return { affected: 0 };
      }
      const next = { ...pending } as Record<string, unknown>;
      if (typeof next.draftConfig === 'function') {
        const config = JSON.parse(String(params.draftConfig));
        config.knowledgeDocumentIds = row.draftConfig.knowledgeDocumentIds;
        next.draftConfig = config;
      }
      row = { ...row, ...clone(next) } as BotDraftEntity;
      pending = {};
      params = {};
      return { affected: 1 };
    },
  };
  const repository = {
    createQueryBuilder: () => builder,
    findOne: async ({
      where: w,
    }: {
      where: { id?: string; chatbotId?: string };
    }) =>
      (w.id !== undefined ? w.id === row.id : w.chatbotId === row.chatbotId)
        ? clone(row)
        : null,
  };
  const dataSource = { query: jest.fn(async () => []) };
  const events = { publish: jest.fn(async () => undefined) };
  const service = new BotDraftService(
    repository as never,
    dataSource as never,
    { isPlatformAdmin: async () => false } as never,
    events as never,
  );
  return {
    service,
    events,
    dataSource,
    row: () => clone(row),
    /** Change the row behind the service's back (the crawl, or another tab). */
    poke: (patch: Partial<BotDraftEntity>) => {
      row = { ...row, ...patch } as BotDraftEntity;
    },
  };
}
