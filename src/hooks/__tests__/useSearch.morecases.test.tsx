import {act, renderHook} from '@testing-library/react-native';

import {useSearch} from '../useSearch';

jest.mock('@/services/searchApi', () => ({
  useLazyGetSearchResultsQuery: () => [
    jest.fn(async (args: any) => {
      const baseDocs = Array.from({length: 5}).map((_, i) => ({
        id: `${i + 1}${args?.excludedIds?.length || ''}`,
        heading: `H ${i + 1}`,
        content: `C ${args.query}`,
        category: args?.filters?.category || 'General',
        tags: [],
        score: 1,
      }));
      return {
        data: {
          documents: baseDocs,
          total: 12,
          categories: {General: 12},
        },
      };
    }),
    {isLoading: false, isFetching: false},
  ],
}));

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({t: (k: string) => k}),
}));

describe('useSearch more cases', () => {
  it('runs search via suggestion, pagination, and category flows', async () => {
    const {result} = renderHook(() => useSearch());

    await act(async () => {
      await result.current.onPressSuggestion('ally');
    });

    expect(result.current.showSearchResults).toBe(true);
    expect(result.current.resources.length).toBeGreaterThan(0);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.onCategoryChange('General');
    });

    await act(async () => {
      await result.current.handleEndReached();
    });

    // After loading more, resources should have appended
    expect(result.current.resources.length).toBeGreaterThanOrEqual(5);

    // Tab meta and handlers
    act(() => {
      result.current.handleTabChange(0);
    });

    // Reset and ensure state is cleared
    act(() => {
      result.current.resetSearch();
    });
    expect(result.current.resources.length).toBe(0);
    expect(result.current.selectedCategory).toBe('All');
  });
});


