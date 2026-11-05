export interface TextSelection {
  selectedText: string;
  startIndex: number;
  endIndex: number;
}

export interface AddReviewCommentRequest {
  reviewId: string;
  threadId?: string;
  parentCommentId?: string;
  messageId?: string;
  selection?: TextSelection;
  content: string;
}

export interface AddReviewCommentResponse {
  comment?: {
    id: string;
    createdAt: string;
  };
  thread?: {
    id: string;
    createdAt: string;
  };
  reply?: {
    id: string;
    createdAt: string;
  };
}

export interface MessageThreadComment {
  id: string;
  content?: string;
  createdAt?: string;
  createdBy: {
    id?: number;
    name?: string;
    profileImage?: string | null;
  };
  reactions?: {
    [reactionCode: string]: number;
  };
  replyCount?: number;
  myReaction?: string | null;
  hidden?: boolean;
}

export interface MessageThread {
  id: string;
  comments: MessageThreadComment[];
  selection: Record<string, unknown>;
  createdBy: {
    id: number;
    name: string;
    profileImage: string | null;
  };
}

export interface Message {
  id: string;
  content: string;
  createdAt: string;
  startSeconds: number;
  endSeconds: number;
  senderId: number;
  threads: MessageThread[];
}

export interface GetMessagesResponse {
  data: Message[];
  count?: number;
}

export interface GetMessagesRequest {
  reviewId: string;
  offset?: number;
  limit?: number;
  sortOrder?: string;
  sortBy?: string;
}

export interface GetThreadCommentsRequest {
  threadId: string;
  offset?: number;
  limit?: number;
}

export interface GetThreadCommentsResponse {
  data: MessageThreadComment[];
  count: number;
}

export interface ScenarioSessionData {
  id: string;
  duration: string;
  createdAt: string;
  audioUrl?: string | null;
}
export interface ScribeSessionData {
  id: number;
  createdAt: string;
  duration: string;
  summaryName: string;
}

export interface ReviewScenario {
  title: string;
  description: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  createdAt: string;
}
export interface User {
  id: number;
  name: string;
  profileImage: string;
}
export interface ReviewItem {
  id: string;
  createdAt: string;
  scenario?: ReviewScenario;
  scenarioSession?: ScenarioSessionData;
  scribeSession?: ScribeSessionData;
  reactions: {
    [reaction_code: string]: number;
  };
  createdBy: User;
  commentsCount: number;
  note: string;
  reviewStatus?: ReviewStatus;
  summaryName?: string;
}

export interface GetReviewByIdResponse {
  id: string;
  scenario: {
    title: string;
    createdAt: string;
    description: string;
    coverImageUrl: string;
    coverVideoUrl: string;
  };
  scenarioSession: {
    id: string;
    createdAt: string;
    duration: string;
    audioUrl?: string | null;
  };
  commentsCount: number;
  createdBy: {
    id: number;
    name: string;
    profileImage: string;
  };
  reactions: Record<string, number>;
  myReaction: string | null;
  reviewStatus: string;
  generalCommentsThreadId: string;
  note: string;
  noteEditedAt: string;
  createdAt: string;
}
export interface ReviewsResponse {
  data: ReviewItem[];
  count: number;
}

export interface MessagePart {
  text: string;
  commentIds: string[];
  start: number;
  end: number;
}

export interface MessageData {
  id: string;
  content: string;
  createdAt: string;
  startSeconds: number;
  endSeconds: number;
  senderId: number;
  messagePart: MessagePart[];
}

export interface GetThreadsParams {
  reviewId: string;
  offset?: number;
  limit?: number;
}

export interface ThreadsResponse {
  data: Thread[];
  count: number;
}

export interface Thread {
  id: string;
  comments: MessageThreadComment[];
  commentCount: number;
  selection: Record<string, unknown>;
  createdBy: {
    id: number;
    name: string;
    profileImage: string | null;
  };
  message?: MessageData;
}

export interface RepliesParams {
  commentId: string;
  offset?: number;
  limit?: number;
}

export type MessageList = Record<string, MessageData[]> | [];
export interface CreateReviewRequest {
  scenarioSessionId: string;
  note: string;
}

export interface CreateReviewResponse {
  id: string;
  scenarioSessionId: string;
  status: ReviewStatus;
  createdAt: string;
}

export enum ReviewStatus {
  HIDDEN = 'HIDDEN',
  IN_REVIEW = 'IN_REVIEW',
}

export interface UpdateReviewStatusRequest {
  status: ReviewStatus;
  note?: string;
}

export interface UpdateReviewStatusResponse {
  id: string;
  status: ReviewStatus;
  updatedAt: string;
}

export interface GetReviewResponse {
  id: string;
  commentCount: number;
  scenario: ReviewScenario;
  scenarioSession: {
    createdAt: string;
    duration: number;
    id: string;
  };
  createdBy: User;
  reactions: {
    [reaction_code: string]: number;
  };
  myReaction?: string;
  note: string;
}

export interface ShareScreenSessionData {
  coverImageUrl?: string;
  coverVideoUrl?: string;
  title: string;
  description?: string;
  createdAt: string;
  duration?: string;
}

export enum ReplySource {
  THREAD = 'thread',
  GENERAL = 'general',
  INLINE_GENERAL = 'inline_general',
}
