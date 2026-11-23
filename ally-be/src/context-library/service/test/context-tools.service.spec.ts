import { ClUseCase } from '../../enum/context-library.enum';
import { ContextToolsService } from '../context-tools.service';

const names = {
  search: 'principles_search',
  get: 'principles_get',
  libraryLabel: 'the principles',
  noun: 'principle',
  nounPlural: 'principles',
  when: 'Search often.',
};

describe('ContextToolsService.runSearch', () => {
  const search = jest.fn(async () => ({
    retrievalId: null,
    results: [],
    noConfidentMatch: true,
    block: '',
  }));
  const service = new ContextToolsService(
    { search } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => search.mockClear());

  it('takes `queries` sent as one string as a search, not a failure', async () => {
    const result = await service.runSearch(
      ClUseCase.BUILDER_INTERVIEW,
      names,
      { queries: 'empty state for a new list' },
      {},
    );
    expect(result.modelResult.ok).toBe(true);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ queries: ['empty state for a new list'] }),
    );
  });

  it('says what to pass when there is no query, without calling retrieval', async () => {
    const result = await service.runSearch(
      ClUseCase.BUILDER_INTERVIEW,
      names,
      {},
      {},
    );
    expect(result.modelResult).toMatchObject({ ok: false, error: 'no_query' });
    expect(search).not.toHaveBeenCalled();
  });
});
