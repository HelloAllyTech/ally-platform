import {ScenarioStatus} from '@/constants';

import {AudioTrackRef} from './audio';
import {ReviewStatus} from './reviews';

export interface TriggerWarning {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LanguageOption {
  language_id: number;
  label: string;
  active: boolean;
  translationCode?: string;
  value?: string;
}

export interface ScenarioMetadata {
  age?: number;
  name?: string;
  tone?: string;
  gender?: string;
  context?: string;
  voiceId?: string;
  agentGoal?: string;
  profession?: string;
  lifeHistory?: string;
  personality?: string;
  coreMemories?: string;
  startingState?: string;
  emotionalNeeds?: string;
  genderIdentity?: string;
  currentLocation?: string;
  openingStatements?: string[];
  sexualOrientation?: string;
  sessionBehaviorGuidelines?: string;
  experienceMode?: string;
  /**
   * Which post-session tabs this roleplay shows: the debrief note and the
   * annotated transcript. The backend always sends this RESOLVED, so the
   * client never has to re-implement the "absent means on" default — but it
   * stays optional here because a cached or older response may predate it, in
   * which case treat both tabs as on (see DEFAULT_FEEDBACK_TABS in
   * constants/simulationSummary).
   *
   * Both false is the wholesale opt-out. There is no master switch above these
   * two: `enableFeedback` was retired on 2026-08-31 and folded into them by
   * ally-be migration 1944200000000.
   */
  feedbackTabs?: {
    debrief: boolean;
    transcript: boolean;
  };
}

export interface Scenario {
  id: number;
  title: string;
  scenario?: string;
  description?: string;
  /** Text reminders shown to the learner during the roleplay. */
  reminders?: string[];
  /** Whether reminders are shown to the learner during the roleplay — reminders should only render when this is true. */
  remindersEnabled?: boolean;
  /** Named conversational states (e.g. "Defensive" → "Cautiously Openness")
   * the learner progresses through, mapped from score + difficultyLevel. */
  stateNames?: StateInstruction[];
  difficultyLevel?: string;
  coverImageUrl?: string | null;
  coverVideoUrl?: string | null;
  status?: ScenarioStatus;
  triggerWarnings?: TriggerWarning[];
  createdAt?: string;
  updatedAt?: string;
  prompt?: string | null;
  metadata?: ScenarioMetadata;
  createdBy?: number;
  updatedBy?: number;
  deletedAt?: string | null;
  isGlobal?: boolean;
  terminationEvent?: unknown;
  timerMode?: boolean;
  maxTimeValue?: string;
  checklistType?: ChecklistType;
  experienceMode?: string;
  checklistEvents?: ChecklistItem[];
  showScoreMeter?: boolean;
  pauseEnabled?: boolean;
  availableLanguages?: LanguageOption[];
  completion?: ScenarioCompletion | null;
}

/**
 * The current learner's completion record for a scenario. Null/absent means
 * they have never completed it — guard on the object, not on `attemptCount`.
 */
export interface ScenarioCompletion {
  attemptCount: number;
  lastCompletedAt: string | null;
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
  tags?: string[];
}

export interface FeedbackResponse {
  success: boolean;
  message?: string;
  feedbackId?: number;
}

export interface SessionFeedbackData {
  rating?: number | null;
  tags?: string[] | null;
  feedback?: string | null;
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
  scenario: Scenario;
}

export interface CircleWaveVisualizerProps {
  trackRef: AudioTrackRef;
}

export interface ControlButtonsProps {
  isMaximized: boolean;
  onToggleMaximized: () => void;
  isFocusMode: boolean;
  isFocusModeDisabled?: boolean;
  onFocusModeButtonPress: () => void;
  isSimulationEndDisabled?: boolean;
  onSimulationEndPress: () => void;
  isMicDisabled?: boolean;
  onMicButtonPress: () => void;
  isMuted: boolean;
}

export interface SimulationTimerProps {
  startTime: Date;
  timeLimit?: number; // seconds; if provided, triggers onWarning and onTimeLimit
  onWarning?: () => void; // fired when timeLimit - elapsed <= WARNING_THRESHOLD_SECONDS
  onTimeLimit?: () => void; // fired when elapsed >= timeLimit
  isPaused?: boolean; // when true, the elapsed clock holds (paused time isn't counted)
  pausedOffsetMs?: number; // cumulative completed paused milliseconds to exclude
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

export interface UpNextSimulation {
  id?: number;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  scenarioPathSessionItemStatus?: SessionItemStatus;
  caseSessionItemStatus?: SessionItemStatus;
  order?: number;
  scenarioPathSessionItemId?: string;
  caseSessionItemId?: string;
}

export interface CurrentSessionInfo {
  scenarioId?: number;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  scenarioPathSessionItemStatus?: SessionItemStatus;
  caseSessionItemStatus?: SessionItemStatus;
  scenarioPathSessionItemId?: string;
  caseSessionItemId?: string;
  transitionMessageTitle?: string;
  transitionMessageContent?: string;
  isScenarioPathSessionCompleted?: boolean;
  isCaseSessionCompleted?: boolean;
  eventStatus?: string;
  sessionGlimpse?: string;
}

export interface UpcomingScenarioResponse {
  upcomingScenario?: UpNextSimulation;
  currentSession?: CurrentSessionInfo;
}

export interface AreaOfGrowth {
  improvement: string;
  recommendation: string;
}

export interface FeedbackItem {
  text: string;
  recommendation?: string;
}

export interface SimulationDetails {
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
      areasOfGrowth?: AreaOfGrowth[];
      /**
       * Ally's post-session debrief note, written in a supervisor's voice.
       * Anchors specific transcript moments as `[[msg:<scenarioSessionMessageId>]]`
       * — see SupervisorNote, which turns those into tappable chips.
       */
      supervisorNote?: string;
    };
    errorMessage?: string;
  };
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
  feedbackRating?: number | null;
  feedbackTags?: string[] | null;
  sessionFeedback?: SessionFeedbackData | null;
  scenarioPathSessionId?: string | null;
  reviewId?: string | null;
  reviewStatus?: ReviewStatus | null;
  scenario?: {
    title?: string;
    description?: string;
    coverImageUrl?: string;
    coverVideoUrl?: string;
    metadata?: ScenarioMetadata;
  };
  details?: SimulationDetails;
}

export type SessionData = {
  id: string;
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
    detected_event_ids?: string[];
  } | null;
  timestamp?: string;
} | null;

export enum SessionItemStatus {
  LOCKED = 'LOCKED',
  UNLOCKED = 'UNLOCKED',
  COMPLETED = 'COMPLETED',
}

export interface PathScenario {
  id: string;
  scenarioId: number;
  order: number;
  messageTitle?: string;
  messageContent?: string;
  minimumScore?: number;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  sessionId: string | null;
  status: SessionItemStatus;
  triggerWarnings?: TriggerWarning[];
  availableLanguages?: LanguageOption[];
}

export interface SimulationPathDetails {
  id: string;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  status: string;
  isGlobal: boolean;
  completedScenarios: number;
  completedAt: Date | null;
  scenarioPathSessionId: string | null;
  caseSessionId?: string | null;
  scenarios: PathScenario[];
}

export interface SimulationPath {
  id: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  totalScenarios: number;
  completedScenarios?: number;
}

export interface SimulationPathsResponse {
  data: SimulationPath[];
  count: number;
}

export enum ChecklistType {
  OFF = 'OFF',
  GUIDED = 'GUIDED',
  UNGUIDED = 'UNGUIDED',
  LIST = 'LIST',
}

export enum ExperienceMode {
  FEEDBACK = 'FEEDBACK',
  CHECKLIST = 'CHECKLIST',
  NONE = 'NONE',
}

export interface ChecklistItem {
  id: string;
  name: string;
  rank?: number;
  score?: number;
  message?: string;
}

export interface StateInstruction {
  name: string;
  stateId: string;
}

/**
 * Case list item type - uses same structure as SimulationPath
 */
export type Case = SimulationPath;

/**
 * Case detail type - uses same structure as SimulationPathDetails
 */
export type CaseDetails = SimulationPathDetails;

/**
 * Individual scenario within a Case - uses same structure as PathScenario
 */
export type CaseSimulation = PathScenario;

/**
 * Cases list response type - uses same structure as SimulationPathsResponse
 */
export type CasesResponse = SimulationPathsResponse;

export interface EventChecklistItem {
  id: string;
  name: string;
  hasOccurred: boolean;
}

export interface EventChecklistResponse {
  eventChecklist: EventChecklistItem[];
}

export enum RoomStatus {
  CONNECTED = 'connected',
  CONNECTING = 'connecting',
  DISCONNECTED = 'disconnected',
  DISCONNECTING = 'disconnecting',
  AGENT_JOINED = 'agent_joined',
}

export type AgentTurnStatus = 'thinking' | 'speaking' | 'user_turn';

export type AgentStatePayload = {
  type: 'AGENT_STATE';
  state: 'thinking' | 'done_thinking' | 'speaking';
};

export enum TurnState {
  AI_SPEAKING = 'ai_speaking',
  AI_LISTENING = 'ai_listening',
  USER_TURN_TO_SPEAK = 'user_turn_to_speak',
  USER_TURN_TO_LISTEN = 'user_turn_to_listen',
  THINKING = 'thinking',
  PAUSED = 'paused',
  IDLE = 'idle',
}
