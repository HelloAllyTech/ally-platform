import {API_ROUTES} from '@/constants';

import {api} from './api';

export interface Place {
  id: number;
  city: string;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlacesResponse {
  total: number;
  data: Place[];
}

export interface PlacesSearchParams {
  query: string;
}

export const placesApi = api.injectEndpoints({
  endpoints: builder => ({
    getPlaces: builder.query<PlacesResponse, {page?: number; limit?: number}>({
      query: ({page = 1, limit = 50} = {}) => {
        return {
          url: API_ROUTES.PLACES.ROOT,
          params: {page, limit},
        };
      },
    }),
    searchPlaces: builder.query<Place[], PlacesSearchParams>({
      query: ({query}) => {
        return {
          url: API_ROUTES.PLACES.SEARCH,
          params: {query},
        };
      },
    }),
  }),
});

export const {useGetPlacesQuery, useLazySearchPlacesQuery} = placesApi;
