export const AUDIO_INACTIVE_TIMEOUT = 2000; // Time in ms to wait before marking audio as inactive

export enum CHAT_TYPES {
  WEBRTC_CHAT = 'WEBRTC_CHAT',
  MICROPHONE_CHAT = 'MICROPHONE_CHAT',
  EXOTEL_CONFERENCE_CHAT = 'EXOTEL_CONFERENCE_CHAT',
  DICTATION_MODE = 'DICTATION_MODE',
}

export enum ScribeSessionMode {
  SCRIBE = 'SCRIBE',
  DICTATION = 'DICTATION',
}
