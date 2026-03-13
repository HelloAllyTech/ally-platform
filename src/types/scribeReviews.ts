import {ReviewStatus, ScribeSessionData, User} from './reviews';

export interface ScribeReviewItem {
  id: string;
  createdAt: string;
  scribeSession?: ScribeSessionData;
  reactions: {
    [reaction_code: string]: number;
  };
  createdBy: User;
  commentsCount: number;
  note: string;
  reviewStatus: ReviewStatus;
  summaryName?: string;
}

export interface GetScribeReviewByIdResponse {
  id: string;
  scribeSession: ScribeSessionData;
  commentsCount: number;
  createdBy: User;
  reactions: Record<string, number>;
  myReaction: string | null;
  reviewStatus: string;
  generalCommentsThreadId: string;
  note: string;
  noteEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
  summaryName?: string;
}

export interface ScribeReviewsResponse {
  data: ScribeReviewItem[];
  count: number;
}

export interface CreateScribeReviewRequest {
  scribeSessionId: number;
  note: string;
}

export interface CreateScribeReviewResponse {
  id: string;
  scribeSessionId: number;
  status: ReviewStatus;
  createdAt: string;
}
