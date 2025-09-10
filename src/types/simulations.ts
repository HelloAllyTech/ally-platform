import {AudioTrackRef} from './audio';

export interface Scenario {
  unique_id: string;
  title?: string;
  short_description?: string;
  long_description?: string;
  cover_image?: string | null;
  // TODO: Add enum when API is updated
  status?: string;
}

export interface ScenariosResponse {
  scenarios: Scenario[];
}

export interface SendOtpResponse {
  success: boolean;
  message?: string;
}

export interface LoginResponse {
  tokens: {
    access_token: string;
    refresh_token: string;
  };
  name: string;
}

export interface RoomCreationResponse {
  id: string;
  script_type: string;
  created_at: string;
  updated_at: string;
  access_token: string;
}

export interface RoomListResponse {
  rooms: Array<{
    id: string;
    script_type: string;
    created_at: string;
    updated_at: string;
  }>;
}

export interface RoomDeletionResponse {
  success: boolean;
  message?: string;
}

export interface FeedbackRequest {
  rating?: number;
  comment?: string;
}

export interface FeedbackResponse {
  success: boolean;
  message?: string;
  feedbackId?: number;
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

export interface SimulationEvent {
  timestamp: string;
  score: number;
  description: string;
}

export interface SimulationSummaryData {
  sessionDuration: string;
  totalScore: number;
  keyEvents: SimulationEvent[];
  whatWentWell: string[];
  areasForImprovement: string[];
}
