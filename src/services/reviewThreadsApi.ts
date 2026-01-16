import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

// Mock data for development
const generateMockThreadsData = (): ThreadsResponse => {
  return {
    data: [
      {
        id: 'thread-1',
        selectedText: 'like too much at once',
        commentCount: 3,
        comments: [
          {
            id: 'comment-1-1',
            content:
              'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.',
            createdAt: '2025-02-18T11:05:00Z',
            createdBy: {
              id: 'user-1',
              name: 'Emily Chen',
              profileImage: 'https://i.pravatar.cc/32?img=1',
            },
            reactions: {
              '1F44D': 5,
              '2764-FE0F': 2,
              '1F44F': 1,
            },
            replyCount: 2,
          },
        ],
      },
      {
        id: 'thread-2',
        selectedText: 'lorem ipsum expanded...',
        commentCount: 6,
        comments: [
          {
            id: 'comment-2-1',
            content:
              'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.',
            createdAt: '2025-02-18T09:30:00Z',
            createdBy: {
              id: 'user-2',
              name: 'Emily Chen',
              profileImage: 'https://i.pravatar.cc/32?img=2',
            },
            reactions: {
              '1F44D': 3,
              '2764-FE0F': 4,
              '1F44F': 1,
            },
            replyCount: 5,
          },
        ],
      },
      {
        id: 'thread-3',
        commentCount: 1,
        comments: [
          {
            id: 'comment-3-1',
            content:
              'Thanks, Dr. Smith. I appreciate your insights on managing client expectations.',
            createdAt: '2025-02-17T14:20:00Z',
            createdBy: {
              id: 'user-3',
              name: 'David Lee',
              profileImage: null,
            },
            reactions: {},
            replyCount: 0,
          },
        ],
      },
      {
        id: 'thread-4',
        commentCount: 2,
        comments: [
          {
            id: 'comment-4-1',
            content:
              'Thanks, Dr. Smith. I appreciate your insights on managing client expectations.',
            createdAt: '2025-02-15T10:15:00Z',
            createdBy: {
              id: 'user-4',
              name: 'Evelyn Clark',
              profileImage: 'https://i.pravatar.cc/32?img=4',
            },
            reactions: {
              '1F44D': 2,
            },
            replyCount: 1,
          },
        ],
      },
      {
        id: 'thread-5',
        commentCount: 1,
        comments: [
          {
            id: 'comment-5-1',
            content:
              'Thanks, Dr. Smith. I appreciate your insights on managing client expectations.',
            createdAt: '2025-02-15T10:15:00Z',
            createdBy: {
              id: 'user-5',
              name: 'Frank Martin',
              profileImage: null,
            },
            reactions: {},
            replyCount: 0,
          },
        ],
      },
      {
        id: 'thread-6',
        commentCount: 3,
        comments: [
          {
            id: 'comment-6-1',
            content:
              'Thanks, Dr. Smith. I appreciate your insights on managing client expectations.',
            createdAt: '2025-02-15T10:15:00Z',
            createdBy: {
              id: 'user-6',
              name: 'Gina Rodriguez',
              profileImage: 'https://i.pravatar.cc/32?img=6',
            },
            reactions: {
              '2764-FE0F': 1,
            },
            replyCount: 2,
          },
        ],
      },
      {
        id: 'thread-7',
        commentCount: 1,
        comments: [
          {
            id: 'comment-7-1',
            content:
              'Thanks, Dr. Smith. I appreciate your insights on managing client expectations.',
            createdAt: '2025-02-15T10:15:00Z',
            createdBy: {
              id: 'user-7',
              name: 'Harry Styles',
              profileImage: null,
            },
            reactions: {},
            replyCount: 0,
          },
        ],
      },
    ],
    count: 7,
  };
};

export interface CommentUser {
  id: string | number;
  name: string;
  profileImage?: string | null;
}

export interface CommentReactions {
  [reactionCode: string]: number;
}

export interface Comment {
  id: string | number;
  content: string;
  createdAt: string;
  createdBy: CommentUser;
  reactions: CommentReactions;
  replyCount: number;
}

export interface Thread {
  id: string | number;
  comments: Comment[];
  commentCount: number;
  selectedText?: string;
}

export interface ThreadsResponse {
  data: Thread[];
  count: number;
}

export interface ThreadsParams {
  reviewId: string | number;
  offset: number;
  limit: number;
}

export interface ThreadComment {
  id: string | number;
  content: string;
  createdAt: string;
  createdBy: CommentUser;
  reactions: CommentReactions;
}

export interface ThreadCommentsResponse {
  data: ThreadComment[];
  count: number;
}

export interface ThreadCommentsParams {
  threadId: string | number;
  offset: number;
  limit: number;
}

export const reviewThreadsApi = api.injectEndpoints({
  endpoints: builder => ({
    getThreads: builder.query<ThreadsResponse, ThreadsParams>({
      queryFn: async (
        {reviewId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        // Return mock data in development mode
        if (__DEV__) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));
          const allData = generateMockThreadsData();
          const paginatedData = allData.data.slice(offset, offset + limit);
          return {
            data: {
              data: paginatedData,
              count: allData.count,
            },
          };
        }

        // In production, make actual API call using baseQuery
        const result = await baseQuery({
          url: API_ROUTES.REVIEWS.THREADS(reviewId),
          method: API_METHODS.GET,
          params: {
            offset,
            limit,
          },
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as ThreadsResponse};
      },
    }),
    getThreadComments: builder.query<
      ThreadCommentsResponse,
      ThreadCommentsParams
    >({
      queryFn: async (
        {threadId, offset, limit},
        _queryApi,
        _extraOptions,
        baseQuery,
      ) => {
        // Return mock data in development mode
        if (__DEV__) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 300));
          // Generate mock comments for the thread
          const mockComments: ThreadComment[] = Array.from(
            {length: 10},
            (_, i) => ({
              id: `comment-${threadId}-${i + 1}`,
              content:
                i === 0
                  ? 'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.'
                  : `That's a good point ${i}`,
              createdAt: new Date(Date.now() - i * 60000).toISOString(),
              createdBy: {
                id: `user-${i + 1}`,
                name: [
                  'Emily Chen',
                  'Yedhu Krishnan',
                  'Arjun Menon',
                  'Sita Nair',
                  'David Lee',
                  'Evelyn Clark',
                  'Frank Martin',
                  'Gina Rodriguez',
                  'Harry Styles',
                  'John Doe',
                ][i],
                profileImage:
                  i % 2 === 0 ? `https://i.pravatar.cc/32?img=${i + 1}` : null,
              },
              reactions: (i < 3
                ? {
                    '1F44D': Math.floor(Math.random() * 5) + 1,
                    '2764-FE0F': Math.floor(Math.random() * 3),
                  }
                : {}) as CommentReactions,
            }),
          );

          const paginatedComments = mockComments.slice(offset, offset + limit);
          return {
            data: {
              data: paginatedComments,
              count: mockComments.length,
            },
          };
        }

        // In production, make actual API call using baseQuery
        const result = await baseQuery({
          url: API_ROUTES.REVIEWS.THREAD_COMMENTS(threadId),
          method: API_METHODS.GET,
          params: {
            offset,
            limit,
          },
        });

        if (result.error) {
          return {error: result.error};
        }

        return {data: result.data as ThreadCommentsResponse};
      },
    }),
  }),
});

export const {useLazyGetThreadsQuery, useLazyGetThreadCommentsQuery} =
  reviewThreadsApi;
