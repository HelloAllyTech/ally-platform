export type SessionBookmarkSource = "web" | "mobile";

export interface SaveSessionBookmarkRequest {
  sessionId: string;
  note?: string;
  source?: SessionBookmarkSource;
}

export interface SessionBookmark {
  id: string;
  sessionId: string;
  note: string | null;
  createdAt: string;
}
