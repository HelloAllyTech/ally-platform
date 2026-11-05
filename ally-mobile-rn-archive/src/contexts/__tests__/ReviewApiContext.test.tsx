import React from 'react';
import {renderHook} from '@testing-library/react-native';

jest.mock('@/services/reactionsApi', () => ({
  useAddReactionToCommentMutation: jest.fn(),
  useAddReactionToReviewMutation: jest.fn(),
  useLazyGetReactionsCountQuery: jest.fn(),
  useLazyGetReactionsQuery: jest.fn(),
}));

jest.mock('@/services/reviewsApi', () => ({
  useAddReviewCommentMutation: jest.fn(),
  useDeleteCommentMutation: jest.fn(),
  useGetGeneralReviewCommentsQuery: jest.fn(),
  useLazyGetGeneralReviewCommentsQuery: jest.fn(),
  useLazyGetThreadCommentsQuery: jest.fn(),
  useUpdateCommentMutation: jest.fn(),
  useUpdateCommentVisibilityMutation: jest.fn(),
  useUpdateReviewStatusMutation: jest.fn(),
}));

jest.mock('@/services/reviewThreadsApi', () => ({
  useLazyGetCommentRepliesQuery: jest.fn(),
  useLazyGetThreadsQuery: jest.fn(),
}));

jest.mock('@/services/scribeReactionsApi', () => ({
  useAddScribeReactionToCommentMutation: jest.fn(),
  useAddScribeReactionToReviewMutation: jest.fn(),
  useLazyGetScribeReactionsCountQuery: jest.fn(),
  useLazyGetScribeReactionsQuery: jest.fn(),
}));

jest.mock('@/services/scribeReviewsApi', () => ({
  useAddScribeReviewCommentMutation: jest.fn(),
  useDeleteScribeCommentMutation: jest.fn(),
  useGetScribeGeneralReviewCommentsQuery: jest.fn(),
  useLazyGetScribeGeneralReviewCommentsQuery: jest.fn(),
  useLazyGetScribeThreadCommentsQuery: jest.fn(),
  useUpdateScribeCommentMutation: jest.fn(),
  useUpdateScribeCommentVisibilityMutation: jest.fn(),
  useUpdateScribeReviewStatusMutation: jest.fn(),
}));

jest.mock('@/services/scribeReviewThreadsApi', () => ({
  useLazyGetScribeCommentRepliesQuery: jest.fn(),
  useLazyGetScribeThreadsQuery: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

import type {ReviewApiHooks} from '../ReviewApiContext';
import {
  ReviewApiProvider,
  scribeApiHooks,
  simulationApiHooks,
  useReviewApiHooks,
} from '../ReviewApiContext';

const REQUIRED_KEYS: (keyof ReviewApiHooks)[] = [
  'reviewType',
  'useLazyGetThreadComments',
  'useAddReviewComment',
  'useDeleteComment',
  'useUpdateComment',
  'useUpdateCommentVisibility',
  'useUpdateReviewStatus',
  'useLazyGetThreads',
  'useLazyGetCommentReplies',
  'useLazyGetReactions',
  'useLazyGetReactionsCount',
  'useAddReactionToComment',
  'useAddReactionToReview',
  'useLazyGetGeneralReviewComments',
  'useGetGeneralReviewComments',
];

describe('ReviewApiContext', () => {
  it('useReviewApiHooks returns simulation hooks by default', () => {
    const {result} = renderHook(() => useReviewApiHooks());

    expect(result.current.reviewType).toBe('simulation');
    expect(result.current.useLazyGetThreads).toBe(
      simulationApiHooks.useLazyGetThreads,
    );
  });

  it('useReviewApiHooks returns scribe hooks when wrapped in ReviewApiProvider with scribeApiHooks', () => {
    const wrapper = ({children}: {children: React.ReactNode}) => (
      <ReviewApiProvider value={scribeApiHooks}>{children}</ReviewApiProvider>
    );

    const {result} = renderHook(() => useReviewApiHooks(), {wrapper});

    expect(result.current.reviewType).toBe('scribe');
    expect(result.current.useLazyGetThreads).toBe(
      scribeApiHooks.useLazyGetThreads,
    );
  });

  it('simulationApiHooks has all required properties', () => {
    REQUIRED_KEYS.forEach(key => {
      expect(simulationApiHooks[key]).toBeDefined();
    });
    expect(simulationApiHooks.reviewType).toBe('simulation');
  });

  it('scribeApiHooks has all required properties', () => {
    REQUIRED_KEYS.forEach(key => {
      expect(scribeApiHooks[key]).toBeDefined();
    });
    expect(scribeApiHooks.reviewType).toBe('scribe');
  });
});
