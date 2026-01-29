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
  senderId: string;
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
  duration: string;
  createdAt: string;
}
export interface ReviewScenario {
  title: string;
  description: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
}
export interface User {
  id: number;
  name: string;
  profileImage: string;
}
export interface ReviewItem {
  id: string;
  createdAt: string;
  scenario: ReviewScenario;
  scenarioSession: ScenarioSessionData;
  reactions: {
    [reaction_code: string]: number;
  };
  createdBy: User;
  commentsCount: number;
}

export interface GetReviewByIdResponse extends ReviewItem {
  myReaction: string | null;
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
  senderId: string;
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
}
