import {
  GetThreadCommentsResponse,
  MessageThreadComment,
  ThreadsResponse,
} from '@/types/reviews';

// Mock data constants
export const TOTAL_MOCK_COMMENTS = 25;
export const TOTAL_MOCK_REPLIES = 8;

export const MOCK_COMMENT_NAMES = [
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
  'Sarah Johnson',
  'Michael Brown',
  'Lisa Anderson',
  'Robert Taylor',
  'Jennifer White',
  'William Davis',
  'Maria Garcia',
  'James Wilson',
  'Patricia Martinez',
  'Richard Moore',
  'Linda Jackson',
  'Thomas Thompson',
  'Barbara Harris',
  'Christopher Young',
  'Jessica King',
];

export const MOCK_COMMENT_CONTENTS = [
  'Thank you James. Grief work is so nuanced - clients need to know all feelings are valid.',
  "That's a really insightful point about therapeutic approaches.",
  'I completely agree with this perspective.',
  'This resonates with my clinical experience.',
  "Great observation! This is something I've noticed too.",
  'Could you elaborate more on this aspect?',
  'I appreciate you sharing this perspective.',
  'This is a valuable contribution to the discussion.',
  'I have a similar experience with this approach.',
  'Well said! This captures the essence perfectly.',
  "I think there's another angle to consider here.",
  'This makes a lot of sense in practice.',
  'Thank you for bringing this up.',
  "I've found this to be particularly effective.",
  'This is an important point that deserves attention.',
  'I agree, and would add that...',
  'Excellent point! This aligns with current research.',
  'I appreciate the thoughtful response.',
  'This is a nuanced perspective worth exploring.',
  "I've seen similar patterns in my work.",
  'This discussion is really helpful.',
  'Thank you for the clarification.',
  'I think this approach has merit.',
  'This is a valuable insight.',
  "I completely understand where you're coming from.",
];

export const MOCK_REPLY_NAMES = [
  'Sarah Johnson',
  'Michael Brown',
  'Lisa Anderson',
  'Robert Taylor',
  'Jennifer White',
  'William Davis',
  'Maria Garcia',
  'James Wilson',
];

// Mock data generation functions
export const generateMockThreadsData = (): ThreadsResponse => {
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

const generateMockThreadCommentsData = (): GetThreadCommentsResponse => {
  const mockComments = Array.from({length: TOTAL_MOCK_COMMENTS}, (_, i) => {
    const nameIndex = i % MOCK_COMMENT_NAMES.length;
    const contentIndex = i % MOCK_COMMENT_CONTENTS.length;
    const hasReactions = i % 3 !== 0; // Every 3rd comment has no reactions
    const hasProfileImage = i % 2 === 0; // Every other comment has a profile image
    const replyCount = Math.floor(Math.random() * 5); // Random reply count 0-4

    return {
      id: `comment-${i + 1}`,
      content: MOCK_COMMENT_CONTENTS[contentIndex],
      createdAt: new Date(
        Date.now() - (TOTAL_MOCK_COMMENTS - i) * 60000,
      ).toISOString(), // Staggered timestamps
      createdBy: {
        id: `user-${i + 1}`,
        name: MOCK_COMMENT_NAMES[nameIndex],
        profileImage: hasProfileImage
          ? `https://i.pravatar.cc/32?img=${i + 1}`
          : null,
      },
      reactions: hasReactions
        ? (() => {
            const reactions: {[key: string]: number} = {
              '1F44D': Math.floor(Math.random() * 5) + 1, // thumbs up
              '2764-FE0F': Math.floor(Math.random() * 3), // heart
            };
            if (i % 5 === 0) {
              reactions['1F44F'] = Math.floor(Math.random() * 2) + 1; // clap (occasional)
            }
            return reactions;
          })()
        : {},
      replyCount,
    };
  });

  return {
    data: mockComments,
    count: TOTAL_MOCK_COMMENTS,
  };
};

export const generateMockThreadComments = (
  threadId: string | number,
  offset: number,
  limit: number,
): GetThreadCommentsResponse => {
  const mockComments = generateMockThreadCommentsData();

  // Apply pagination
  const startIndex = offset ?? 0;
  const endIndex = startIndex + (limit ?? 10);
  const paginatedComments = mockComments.data.slice(startIndex, endIndex);

  return {
    data: paginatedComments,
    count: TOTAL_MOCK_COMMENTS,
  };
};

export const generateMockCommentReplies = (
  commentId: string | number,
  offset: number,
  limit: number,
): GetThreadCommentsResponse => {
  const mockReplies: MessageThreadComment[] = Array.from(
    {length: TOTAL_MOCK_REPLIES},
    (_, i) => ({
      id: `reply-${commentId}-${i + 1}`,
      content: `This is a reply ${i + 1} to the comment.`,
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
      createdBy: {
        id: `user-reply-${i + 1}`,
        name: MOCK_REPLY_NAMES[i % MOCK_REPLY_NAMES.length],
        profileImage:
          i % 2 === 0 ? `https://i.pravatar.cc/32?img=${i + 10}` : null,
      },
      reactions: (i < 2
        ? {
            '1F44D': Math.floor(Math.random() * 3) + 1,
            '2764-FE0F': Math.floor(Math.random() * 2),
          }
        : {}) as MessageThreadComment['reactions'],
    }),
  );

  // Apply pagination
  const startIndex = offset ?? 0;
  const endIndex = startIndex + (limit ?? 10);
  const paginatedReplies = mockReplies.slice(startIndex, endIndex);

  return {
    data: paginatedReplies,
    count: TOTAL_MOCK_REPLIES,
  };
};
