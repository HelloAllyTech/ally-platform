import {ChatSummaryStatus} from '@/constants';
import {ChatProvider} from '@/types';

export interface CallLog {
  id: number;
  startedAt: string;
  endedAt: string;
  status: string;
  summaryStatus?: ChatSummaryStatus;
  details?: {
    summary?: {
      tags?: {tag?: string; positivity_rating?: number}[];
      callQuality?: number;
    };
    chatId?: number;
    createdAt?: string;
    callInfo?: {
      summaryName?: string;
      isSummaryFeedbackAdded?: boolean;
    };
  };
  client: {
    name: string;
  };
}

export interface SimulationLog {
  id: number;
  startedAt: string;
  endedAt: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  tenantId?: string;
  roomId?: string;
  scenarioId?: number;
  counselorId?: number;
  score?: number | null;
  metadata?: unknown;
  scenario?: {
    createdAt: string;
    updatedAt: string;
    id: number;
    title: string;
    scenario: string;
    description: string;
    coverImageUrl: string;
    status: string;
    prompt: unknown;
    metadata: unknown;
  };
  counselor?: {
    createdAt: string;
    updatedAt: string;
    tenantId: string;
    id: number;
    email: string;
    name: string;
    role: string;
    status: string;
    username: string;
    metadata: unknown;
    phone: string;
    externalId: unknown;
  };
}

export type LogItem = {
  id: number;
  startedAt: string;
  endedAt: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  tenantId?: string;
  roomId?: string;
  scenarioId?: number;
  counselorId?: number;
  score?: number | null;
  metadata?: unknown;
  scenario?: {
    createdAt: string;
    updatedAt: string;
    id: number;
    title: string;
    scenario: string;
    description: string;
    coverImageUrl: string;
    status: string;
    prompt: unknown;
    metadata: unknown;
  };
  counselor?: {
    createdAt: string;
    updatedAt: string;
    tenantId: string;
    id: number;
    email: string;
    name: string;
    role: string;
    status: string;
    username: string;
    metadata: unknown;
    phone: string;
    externalId: unknown;
  };
  summaryStatus?: ChatSummaryStatus;
  details?: {
    summary?: {
      tags?: {tag?: string; positivity_rating?: number}[];
      callQuality?: number;
    };
    chatId?: number;
    createdAt?: string;
    callInfo?: {
      summaryName?: string;
      provider?: ChatProvider;
      mode?: string;
    };
  };
  client: {
    name: string;
  };
};
