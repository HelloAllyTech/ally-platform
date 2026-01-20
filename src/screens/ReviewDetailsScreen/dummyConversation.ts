// TODO_M: Remove this once the API is implemented
export const dummyConversationMessages = [
  {
    id: '1',
    content:
      "Hello amazing world, have a nice day! Let's test highlights with multiple threads and overlapping selections.",
    createdAt: '2024-06-01T10:00:00Z',
    startSeconds: 5,
    endSeconds: 9,
    senderId: 'UserA',
    threads: [
      // A: parent-ish range
      {
        id: 'thread-1-A',
        selection: {startIndex: 6, endIndex: 19}, // "amazing world"
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-1-A',
            content: 'Thread A: overall phrase.',
            createdAt: '2024-06-01T10:00:30Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {like: 2},
            replyCount: 0,
          },
        ],
      },
      // B: completely inside A (complete overlap)
      {
        id: 'thread-1-B',
        selection: {startIndex: 14, endIndex: 19}, // "world"
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-1-B',
            content: 'Thread B: inside Thread A (complete overlap).',
            createdAt: '2024-06-01T10:00:40Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {heart: 1},
            replyCount: 1,
          },
        ],
      },
      // C: partially overlaps A (partial overlap)
      {
        id: 'thread-1-C',
        selection: {startIndex: 14, endIndex: 26}, // "world, have a"
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-1-C',
            content:
              'Thread C: partial overlap with A (starts inside A, extends beyond).',
            createdAt: '2024-06-01T10:00:50Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {like: 1, laugh: 1},
            replyCount: 0,
          },
        ],
      },
    ],
  },

  {
    id: '2',
    content:
      "React Native Text selection test: touch events won't give character index unless you split spans or use native mapping.",
    createdAt: '2024-06-01T10:01:00Z',
    startSeconds: 10,
    endSeconds: 14,
    senderId: 'UserB',
    threads: [
      // A: base range
      {
        id: 'thread-2-A',
        selection: {startIndex: 0, endIndex: 22}, // "React Native Text sel"
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-2-A',
            content: 'General comment on the opening phrase.',
            createdAt: '2024-06-01T10:01:15Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {like: 3},
            replyCount: 0,
          },
        ],
      },
      // B: overlaps partially with A on the right, extends further right
      {
        id: 'thread-2-B',
        selection: {startIndex: 14, endIndex: 46}, // overlaps A: 14..22, then continues
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-2-B',
            content: 'Partial overlap example with Thread A.',
            createdAt: '2024-06-01T10:01:25Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {dislike: 1},
            replyCount: 2,
          },
        ],
      },
      // C: fully inside B (complete overlap relative to B)
      {
        id: 'thread-2-C',
        selection: {startIndex: 30, endIndex: 40},
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-2-C',
            content: 'Child range inside B (complete overlap).',
            createdAt: '2024-06-01T10:01:35Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {heart: 2},
            replyCount: 0,
          },
        ],
      },
    ],
  },

  {
    id: '3',
    content:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    createdAt: '2024-06-01T10:02:00Z',
    startSeconds: 15,
    endSeconds: 19,
    senderId: 'UserA',
    threads: [
      // A
      {
        id: 'thread-3-A',
        selection: {startIndex: 6, endIndex: 27}, // "ipsum dolor sit amet"
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-3-A',
            content: 'Thread A highlight.',
            createdAt: '2024-06-01T10:02:10Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {like: 1},
            replyCount: 0,
          },
        ],
      },
      // B: completely overlaps inside A
      {
        id: 'thread-3-B',
        selection: {startIndex: 12, endIndex: 22}, // "dolor sit"
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-3-B',
            content: 'Thread B is inside A (complete overlap).',
            createdAt: '2024-06-01T10:02:20Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {like: 2, heart: 1},
            replyCount: 1,
          },
        ],
      },
      // C: partial overlap with A but also extends left of A
      {
        id: 'thread-3-C',
        selection: {startIndex: 0, endIndex: 10}, // "Lorem ipsu" overlaps A? (A starts 6) => partial on left side 6..10
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-3-C',
            content: 'Partial overlap with A (ends inside A).',
            createdAt: '2024-06-01T10:02:30Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {laugh: 1},
            replyCount: 0,
          },
        ],
      },
    ],
  },

  {
    id: '4',
    content:
      'We can attach onPress handlers to each highlighted span to know which thread range was tapped.',
    createdAt: '2024-06-01T10:03:00Z',
    startSeconds: 20,
    endSeconds: 24,
    senderId: 'UserB',
    threads: [
      // A
      {
        id: 'thread-4-A',
        selection: {startIndex: 3, endIndex: 39}, // "can attach onPress handlers to"
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-4-A',
            content: 'Long selection for testing.',
            createdAt: '2024-06-01T10:03:10Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {like: 4},
            replyCount: 0,
          },
        ],
      },
      // B: partial overlap inside the middle and extends beyond right
      {
        id: 'thread-4-B',
        selection: {startIndex: 28, endIndex: 74}, // overlaps with A on 28..39, extends beyond
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-4-B',
            content: 'Partial overlap with A, extends right.',
            createdAt: '2024-06-01T10:03:20Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {dislike: 1, like: 1},
            replyCount: 2,
          },
        ],
      },
      // C: completely inside B
      {
        id: 'thread-4-C',
        selection: {startIndex: 46, endIndex: 60},
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-4-C',
            content: 'Nested inside B.',
            createdAt: '2024-06-01T10:03:30Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {heart: 1},
            replyCount: 0,
          },
        ],
      },
    ],
  },

  {
    id: '5',
    content:
      'Edge case: two ranges partially overlap; choose one winner by createdAt and split/truncate the other for rendering.',
    createdAt: '2024-06-01T10:04:00Z',
    startSeconds: 25,
    endSeconds: 29,
    senderId: 'UserA',
    threads: [
      // A
      {
        id: 'thread-5-A',
        selection: {startIndex: 11, endIndex: 47}, // "two ranges partially overlap; choose"
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-5-A',
            content: 'Primary selection (A).',
            createdAt: '2024-06-01T10:04:10Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {like: 2},
            replyCount: 0,
          },
        ],
      },
      // B: partial overlap (starts before A ends, ends after A ends)
      {
        id: 'thread-5-B',
        selection: {startIndex: 35, endIndex: 76}, // overlaps A on 35..47
        createdBy: {id: 'UserA', name: 'User A', profileImage: null},
        comments: [
          {
            id: 'comment-5-B',
            content: 'Overlaps with A (partial), good for conflict tests.',
            createdAt: '2024-06-01T10:04:20Z',
            createdBy: {id: 'UserA', name: 'User A', profileImage: null},
            reactions: {like: 1, laugh: 1},
            replyCount: 1,
          },
        ],
      },
      // C: a disjoint range (no overlap) to ensure normal highlighting
      {
        id: 'thread-5-C',
        selection: {startIndex: 0, endIndex: 9}, // "Edge case"
        createdBy: {id: 'UserB', name: 'User B', profileImage: null},
        comments: [
          {
            id: 'comment-5-C',
            content: 'Disjoint small highlight.',
            createdAt: '2024-06-01T10:04:30Z',
            createdBy: {id: 'UserB', name: 'User B', profileImage: null},
            reactions: {heart: 2},
            replyCount: 0,
          },
        ],
      },
    ],
  },
];
