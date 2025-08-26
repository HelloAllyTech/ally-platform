import {ChatSummaryStatus} from '@/constants';

export interface CallLog {
  id: number;
  startedAt: string;
  endedAt: string;
  status: string;
  summaryStatus: ChatSummaryStatus;
  details: {
    summary?: {
      tags?: {tag?: string; positivity_rating?: number}[];
      callQuality?: number;
    };
    chatId?: number;
    createdAt?: string;
    callInfo?: {
      summaryName?: string;
    };
  };
  client: {
    name: string;
  };
}
