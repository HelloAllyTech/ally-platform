import {ThreadsResponse} from '@/services/reviewThreadsApi';

/**
 * Mock data for CommentsBottomSheet
 * This will be replaced when API is available
 */
export const generateMockThreadsData = (): ThreadsResponse => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  return {
    data: [
      {
        id: 'thread-1',
        selectedText: 'Selected text: "like too much at once"',
        commentCount: 3,
        comments: [
          {
            id: 'comment-1-1',
            content:
              'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.',
            createdAt: oneHourAgo.toISOString(),
            createdBy: {
              id: 'user-1',
              name: 'Emily Chen',
              profileImage: 'https://i.pravatar.cc/32?img=1',
            },
            reactions: {
              '👍': 5,
              '❤️': 2,
              '👏': 1,
            },
            replyCount: 2,
          },
        ],
      },
      {
        id: 'thread-2',
        selectedText: 'Selected text: "lorem ipsum expanded..."',
        commentCount: 6,
        comments: [
          {
            id: 'comment-2-1',
            content:
              'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.',
            createdAt: twoHoursAgo.toISOString(),
            createdBy: {
              id: 'user-2',
              name: 'Emily Chen',
              profileImage: 'https://i.pravatar.cc/32?img=2',
            },
            reactions: {
              '👍': 3,
              '❤️': 4,
              '👏': 1,
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
            createdAt: oneDayAgo.toISOString(),
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
            createdAt: threeDaysAgo.toISOString(),
            createdBy: {
              id: 'user-4',
              name: 'Evelyn Clark',
              profileImage: 'https://i.pravatar.cc/32?img=4',
            },
            reactions: {
              '👍': 2,
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
            createdAt: threeDaysAgo.toISOString(),
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
            createdAt: threeDaysAgo.toISOString(),
            createdBy: {
              id: 'user-6',
              name: 'Gina Rodriguez',
              profileImage: 'https://i.pravatar.cc/32?img=6',
            },
            reactions: {
              '❤️': 1,
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
            createdAt: threeDaysAgo.toISOString(),
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
