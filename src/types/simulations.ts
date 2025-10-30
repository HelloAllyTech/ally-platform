import {ScenarioStatus} from '@/constants';

import {AudioTrackRef} from './audio';

export interface Scenario {
  id: string;
  title?: string;
  scenario?: string;
  description?: string;
  coverImageUrl?: string | null;
  status?: ScenarioStatus;
}

export interface ScenariosResponse {
  scenarios: Scenario[];
}

export interface RoomListResponse {
  rooms: Array<{
    id: string;
    script_type: string;
    created_at: string;
    updated_at: string;
  }>;
}

export interface FeedbackRequest {
  scenarioSessionId: string;
  rating?: number;
  comment?: string;
}

export interface FeedbackResponse {
  success: boolean;
  message?: string;
  feedbackId?: number;
}

export interface EndScenarioSessionResponse {
  message: string;
}

export interface ScenarioSession {
  tenantId: string;
  id: string;
  roomId: string;
  scenarioId: number;
  counselorId: number;
  startedAt: string;
  endedAt: string | null;
  score: number | null;
  createdAt: string;
  updatedAt: string;
  status: string;
}

export interface ScenarioSessionStartResponse {
  scenarioSession: ScenarioSession;
  accessToken: {
    token: string;
    roomName: string;
    serverUrl: string;
  };
}

export interface CircleWaveVisualizerProps {
  trackRef: AudioTrackRef;
}

export interface ControlButtonsProps {
  onMicPress: () => void;
  onStopPress: () => void;
  isMuted: boolean;
  isDisableMic?: boolean;
  isDisableStop?: boolean;
}

export interface SimulationTimerProps {
  startTime: Date;
}

export interface SimulationEventDetailsMeta {
  createdAt?: string;
  updatedAt?: string;
  id?: string;
  name?: string;
  description?: string;
  score?: number;
  emoji?: string;
  message?: string;
  branchInstruction?: string;
}

export interface SimulationEvent {
  createdAt?: string;
  updatedAt?: string;
  tenantId?: string;
  id?: string;
  scenarioSessionId?: string;
  eventId?: string;
  occurredAt?: string;
  metadata?: unknown;
  events?: SimulationEventDetailsMeta | null;
  timestamp?: string;
  score?: number | null;
  message?: string;
}

interface SummaryMetadata {
  sessionName?: string;
}

export interface SimulationSummaryData {
  events?: SimulationEvent[];
  whatWentWell?: string[];
  areasForImprovement?: string[];
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: string;
  roomId: string;
  scenarioId: number;
  counselorId: number;
  status: string;
  startedAt: string;
  endedAt: string;
  score: number | null;
  metadata: SummaryMetadata | null;
  hasFeedback: boolean;
  scenario?: {
    title?: string;
  };
  details?: {
    createdAt?: string;
    updatedAt?: string;
    tenantId?: string;
    id?: string;
    scenarioSessionId?: string;
    callDuration?: number;
    summary?: {
      feedback?: {
        positives?: string[];
        improvements?: string[];
      };
    };
  };
}

export type RoomData = {
  id: string;
  createdAt: string;
  accessToken: string;
  liveKitServerUrl: string;
};

export type Feedback = {id: number; text: string; emoji?: string} | null;

export type LiveEventPayload = {
  version?: string;
  data?: {
    score?: number | null;
    emoji?: string | null;
    message?: string | null;
  } | null;
  timestamp?: string;
} | null;
