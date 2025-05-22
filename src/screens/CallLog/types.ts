export interface CallLog {
  id: number;
  startedAt: string;
  endedAt: string;
  status: string;
  details: {
    summary?: {
      tags?: {tag?: string; positivity_rating?: number}[];
      callQuality?: number;
    };
    chatId?: number;
    createdAt?: string;
  };
  client: {
    name: string;
  };
}
