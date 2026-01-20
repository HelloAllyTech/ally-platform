export interface AddReviewCommentRequest {
  reviewId: string;
  threadId?: string;
  parentCommentId?: string;
  messageId?: string;
  selection?: Record<string, unknown>;
  comment: string;
}

export interface AddReviewCommentResponse {
  success: boolean;
}

export interface MessageThreadComment {
  id: string;
  content: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
    profileImage: string | null;
  };
  reactions: {
    [reactionCode: string]: number;
  };
  replyCount?: number;
}

export interface MessageThread {
  id: string;
  comments: MessageThreadComment[];
  selection: Record<string, unknown>;
  createdBy: {
    id: string;
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
}

export interface GetMessagesRequest {
  reviewId: string;
  offset?: number;
  limit?: number;
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
export interface ReviewScenario {
  title: string;
  createdAt: string;
  duration: string;
  description: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
}
export interface User {
  id: string;
  name: string;
  profileImage: string;
}
export interface ReviewItem {
  id: string;
  createdAt: string;
  scenario: ReviewScenario;
  reactions: {
    [reaction_code: string]: number;
  };
  createdBy: User;
  commentsCount: number;
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
  commentCount: number;
  selectedText?: string;
}

export interface RepliesParams {
  commentId: string;
  offset?: number;
  limit?: number;
}
