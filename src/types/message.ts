import {AllyPlatforms} from '@/constants/general';

import {User} from './user';

export type ChatMessage = {
  chatId: number;
  content: string;
  context?: {
    source: string;
  };
  createdAt: string;
  id: number;
  senderId: number;
  type: MessageType;
};

export enum ChatStatus {
  ENDED = 'ENDED',
  PAUSED = 'PAUSED',
  ACTIVE = 'ACTIVE',
}

export enum ChatProvider {
  EXOTEL_CONFERENCE_CALL = 'EXOTEL_CONFERENCE_CALL',
  MICROPHONE = 'MICROPHONE',
  WEBRTC = 'WEBRTC',
  OZONETEL = 'OZONETEL',
  AUDIO_UPLOAD = 'AUDIO_UPLOAD',
}

export const ConferenceCallProviders = [
  ChatProvider.EXOTEL_CONFERENCE_CALL,
  ChatProvider.OZONETEL,
];

export interface Chat {
  chatId: number;
  client: User;
  clientId: number;
  counselor: User;
  counselorId: number;
  endedAt: string | null;
  messages: ChatMessage[];
  startedAt: string;
  status: ChatStatus;
  provider: ChatProvider;
  platform: AllyPlatforms;
}

export enum QueueStatus {
  WAITING = 'WAITING',
  MATCHED = 'MATCHED',
}

export interface FeedbackResponse {
  rating: number;
  messageId: number;
  userId: number;
  modifiedContent: string | null;
  createdAt: string;
  updatedAt: string;
  feedbackId: number;
}

export type SocketMessage = {
  type: SocketEvent | string;
  payload?: {
    id: number;
    chatId: number;
    senderId: number;
    type: MessageType | string;
    content: string;
    context?: {
      source: string;
    };
    createdAt: string;
    updatedAt: string;
    feedback?: FeedbackResponse;
    audioData: string;
  };
  content?: string;
  context?: {
    source: string;
  };
  createdAt?: string;
};

export interface Transcription {
  id: number;
  message: string;
  senderId: number;
  timestamp: string;
  isFinal?: boolean;
  isSentenceComplete?: boolean;
}

export enum MessageType {
  TEXT = 'TEXT',
  NUDGE = 'NUDGE',
  STAGE = 'STAGE',
}

export enum SocketEvent {
  NUDGE = 'NUDGE',
  STAGE = 'STAGE',
  SEND_MESSAGE = 'SEND_MESSAGE',
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  AUDIO_MESSAGE = 'AUDIO_MESSAGE',
  START_AUDIO_CHAT = 'START_AUDIO_CHAT',
  CHAT_ENDED = 'CHAT_ENDED',
  UTTERANCE_ENDED = 'UTTERANCE_ENDED',
  USER_JOINED = 'USER_JOINED',
  USER_DISCONNECTED = 'USER_DISCONNECTED',
  AUDIO_STREAM = 'AUDIO_STREAM',
  AUDIO_CHAT_PAUSED = 'AUDIO_CHAT_PAUSED',
  AUDIO_CHAT_RESUMED = 'AUDIO_CHAT_RESUMED',
  SESSION_CREATED = 'SESSION_CREATED',
  AUDIO_CHAT_ENDED = 'AUDIO_CHAT_ENDED',
  /**
   * Diagnostic only, client -> server, never acted on. Reports why the
   * recording screen has not started a session yet. The server logs one line
   * and does nothing else; if it is running a build without the handler,
   * socket.io drops the event silently.
   */
  SCRIBE_START_DIAGNOSTIC = 'SCRIBE_START_DIAGNOSTIC',
}

export interface WaitingClientChat {
  chatId: number;
  roomId: number;
  clientId: number;
  counselorId: number | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface WaitingClient {
  userId: number;
  email: string;
  name: string;
  role: string;
  status: string;
  chat: WaitingClientChat;
  createdAt: string;
  updatedAt: string | null;
}

export interface GetWaitingClientsResponse {
  totalWaiting: number;
  clients: WaitingClient[];
}

export interface Nudge {
  id: number;
  content: string;
  chatId: number;
  senderId: number;
  createdAt: string;
  feedback?: FeedbackResponse;
}

export enum DisconnectedType {
  SOCKET = 'socket',
  NETWORK = 'network',
  MICROPHONE_FAILURE = 'microphone_failure',
}
