import {API_METHODS, API_ROUTES} from '@/constants';
import {BugReportContext} from '@/utils';

import {api} from './api';

export interface CreateBugReportRequest {
  description: string;
  context?: BugReportContext;
}

export interface CreateBugReportResponse {
  id: string;
  stage: string;
}

export const bugReportApi = api.injectEndpoints({
  endpoints: builder => ({
    createBugReport: builder.mutation<
      CreateBugReportResponse,
      CreateBugReportRequest
    >({
      query: body => ({
        url: API_ROUTES.PRODUCT_ROADMAP.BUG_REPORTS,
        method: API_METHODS.POST,
        body,
      }),
    }),
  }),
});

export const {useCreateBugReportMutation} = bugReportApi;
