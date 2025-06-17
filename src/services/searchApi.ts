import {SearchRequest, SearchResult} from '@/screens/SearchScreen/types';

import {api} from './api';

export const searchApi = api.injectEndpoints({
  endpoints: builder => ({
    getSearchResults: builder.query<SearchResult, SearchRequest>({
      query: (params: SearchRequest) => ({
        url: 'reference-document/search',
        method: 'POST',
        body: params,
      }),
    }),
  }),
});

export const {useLazyGetSearchResultsQuery} = searchApi;
