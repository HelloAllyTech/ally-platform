import {API_METHODS, API_ROUTES} from '@/constants';
import {SearchRequest, SearchResult} from '@/screens/SearchScreen/types';

import {api} from './api';

export const searchApi = api.injectEndpoints({
  endpoints: builder => ({
    getSearchResults: builder.query<SearchResult, SearchRequest>({
      query: (params: SearchRequest) => ({
        url: API_ROUTES.REFERENCE_DOCUMENT.SEARCH,
        method: API_METHODS.POST,
        body: params,
      }),
    }),
    getCategories: builder.query<string[], void>({
      query: () => ({
        url: API_ROUTES.REFERENCE_DOCUMENT.CATEGORIES,
        method: API_METHODS.GET,
      }),
    }),
  }),
});

export const {useLazyGetSearchResultsQuery, useLazyGetCategoriesQuery} =
  searchApi;
