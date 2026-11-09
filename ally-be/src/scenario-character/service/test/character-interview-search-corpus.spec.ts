import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ContextRetrievalService } from 'src/context-library/service/context-retrieval.service';
import { CharacterInterviewToolsService } from '../character-interview-tools.service';
import { CharacterInterviewSessionRepository } from '../../repository/character-interview-session.repository';

jest.mock('src/logger/logger.service');

/**
 * `search_corpus` is the interview agent's only way to know something the admin did not tell
 * it, so its two failure modes are both about honesty rather than crashes.
 *
 * A retrieval that found nothing must arrive as a RESULT, not an error: every other tool uses
 * ok:false to mean "repair and retry", and the model obliges, so an honest "nothing matched"
 * reported as failure becomes a rephrase loop. And a retrieval that could not RUN must be
 * distinguishable from one that found nothing, or the agent tells an admin the library lacks
 * material it actually holds.
 *
 * Since phase 4 of the Context Library it reads the Character Insights collection through the
 * shared retrieval service, and returns insight cards with codes.
 */

const result = (
  over: { code?: string; band?: string; card?: string } = {},
) => ({
  chunk: { id: `id-${over.code ?? 'CI-0001'}`, code: over.code ?? 'CI-0001' },
  band: over.band ?? 'good',
  score: 0.5,
  card:
    over.card ??
    '[CI-0001 · speech_and_language · lived_experience · good] Word-finding trouble shows as talking around a word',
});

describe('search_corpus', () => {
  let service: CharacterInterviewToolsService;
  let retrieval: { search: jest.Mock };
  const sessionRepository = { update: jest.fn(), findOne: jest.fn() };
  const warn = jest.fn();

  const run = (input: Record<string, any>, metadata?: Record<string, any>) =>
    (service as any).executeSearchCorpus(input, {
      session: { id: 'sess-1', metadata },
      userId: 7,
    });

  const found = (results: any[], noConfidentMatch = false) =>
    retrieval.search.mockResolvedValue({
      retrievalId: 'r1',
      results,
      noConfidentMatch,
      block: '',
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    sessionRepository.update.mockResolvedValue({ affected: 1 });
    (LoggerService.getInstance as jest.Mock) = jest.fn().mockReturnValue({
      info: jest.fn(),
      warn,
      error: jest.fn(),
      debug: jest.fn(),
    });
    retrieval = { search: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterInterviewToolsService,
        {
          provide: CharacterInterviewSessionRepository,
          useValue: sessionRepository,
        },
        { provide: DataSource, useValue: { getRepository: jest.fn() } },
        { provide: ContextRetrievalService, useValue: retrieval },
      ],
    }).compile();
    service = module.get(CharacterInterviewToolsService);
  });

  it('searches Character Insights as the character interview, for its session, topics as soft facets', async () => {
    found([result()]);

    await run({
      query: 'how does dementia change speech?',
      topics: ['speech_and_language'],
    });

    const [request] = retrieval.search.mock.calls[0];
    expect(request).toMatchObject({
      useCase: 'character_interview',
      queries: ['how does dementia change speech?'],
      facets: { aspect: ['speech_and_language'] },
      sessionId: 'sess-1',
    });
    // Soft by default: `strict` would turn a boost into a filter.
    expect(request.strict).toBeUndefined();
  });

  it('sends no facets when no topic was given', async () => {
    found([]);
    await run({ query: 'q' });
    expect(retrieval.search.mock.calls[0][0].facets).toBeUndefined();
  });

  it('returns insight cards with their codes', async () => {
    found([result()]);

    const outcome = await run({ query: 'q' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.insights[0]).toEqual({
      code: 'CI-0001',
      band: 'good',
      card: expect.stringContaining('[CI-0001 · speech_and_language'),
    });
    expect(outcome.modelResult.note).toBeUndefined();
  });

  it('says so when only a low-confidence insight came back', async () => {
    found([result({ band: 'low' })], true);
    const outcome = await run({ query: 'q' });
    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.note).toMatch(/no confident match/i);
  });

  it('does NOT end the turn — the agent searches, then keeps going', async () => {
    found([result()]);
    const outcome = await run({ query: 'q' });
    expect(outcome.endTurn).toBeUndefined();
  });

  it('reports an empty result as a successful result, not a failure to retry', async () => {
    found([], true);

    const outcome = await run({ query: 'nothing covers this' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.insights).toEqual([]);
    // And it must say so, or the model has to guess what an empty list means.
    expect(outcome.modelResult.note).toMatch(/real answer, not a/i);
    expect(outcome.modelResult.note).toMatch(/do not imply/i);
  });

  it('distinguishes "retrieval is down" from "nothing matched", and never logs the query', async () => {
    // Conflating these makes the agent tell an admin the library lacks material it holds.
    retrieval.search.mockRejectedValue(new Error('weaviate is down'));

    const outcome = await run({ query: 'a woman in her sixties caring for' });

    expect(outcome.modelResult.ok).toBe(false);
    expect(outcome.modelResult.error).toMatch(
      /says nothing about what the library holds/i,
    );
    expect(outcome.modelResult.error).toMatch(/do not.*tell the admin/i);
    // An admin describing a person is a sensitive query.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('a woman in her');
  });

  it('sends an insight once and references it by code thereafter', async () => {
    // The loop resends the whole transcript every turn, so a repeated card is paid for on
    // every remaining turn, twice over.
    found([result()]);

    const first = await run({ query: 'q1' });
    expect(first.modelResult.insights[0].card).toBeTruthy();
    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      { metadata: { servedCodes: ['CI-0001'] } },
    );

    const second = await run({ query: 'q2' }, { servedCodes: ['CI-0001'] });
    expect(second.modelResult.insights[0].card).toBeNull();
    expect(second.modelResult.insights[0].note).toMatch(/already provided/i);
    // Still told which insight matched — that is the part carrying information.
    expect(second.modelResult.insights[0].code).toBe('CI-0001');
  });

  it('records only the insights that were newly sent', async () => {
    found([result({ code: 'CI-0001' }), result({ code: 'CI-0002' })]);

    await run({ query: 'q' }, { servedCodes: ['CI-0001'] });

    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 'sess-1' },
      { metadata: { servedCodes: ['CI-0001', 'CI-0002'] } },
    );
  });

  it('caps the served set, dropping the oldest codes first', async () => {
    found([result({ code: 'CI-9999' })]);
    const served = Array.from(
      { length: 200 },
      (_, i) => `CI-${String(i).padStart(4, '0')}`,
    );

    await run({ query: 'q' }, { servedCodes: served });

    const [, { metadata }] = sessionRepository.update.mock.calls[0];
    expect(metadata.servedCodes).toHaveLength(200);
    expect(metadata.servedCodes[0]).toBe('CI-0001');
    expect(metadata.servedCodes[199]).toBe('CI-9999');
  });

  it('does not write when every insight was already served', async () => {
    found([result({ code: 'CI-0001' })]);

    await run({ query: 'q' }, { servedCodes: ['CI-0001'] });

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('still returns insights when the served-set write fails', async () => {
    // Losing the set costs tokens, never correctness.
    found([result()]);
    sessionRepository.update.mockRejectedValue(new Error('row is locked'));

    const outcome = await run({ query: 'q' });

    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.insights[0].card).toBeTruthy();
  });

  it('drops topics that are not real, rather than passing them on', async () => {
    found([]);

    await run({ query: 'q', topics: ['speech_and_language', 'astrology', ''] });

    expect(retrieval.search.mock.calls[0][0].facets).toEqual({
      aspect: ['speech_and_language'],
    });
  });

  it('rejects an empty query without calling retrieval', async () => {
    const outcome = await run({ query: '   ' });
    expect(outcome.modelResult.ok).toBe(false);
    expect(retrieval.search).not.toHaveBeenCalled();
  });

  it('keeps the tool name and its five topics', () => {
    const tool = service
      .getToolDefinitions()
      .find((t: any) => t.name === 'search_corpus');
    expect(tool.input_schema.properties.topics.items.enum).toEqual([
      'identity',
      'life_context',
      'inner_life',
      'history_and_presenting_concern',
      'speech_and_language',
    ]);
  });
});
