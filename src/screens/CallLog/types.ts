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
  };
  client: {
    name: string;
  };
}
