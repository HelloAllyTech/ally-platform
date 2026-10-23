export const AUDIO_INACTIVE_TIMEOUT = 2000; // Time in ms to wait before marking audio as inactive

export enum CHAT_TYPES {
  WEBRTC_CHAT = 'WEBRTC_CHAT',
  MICROPHONE_CHAT = 'MICROPHONE_CHAT',
  EXOTEL_CONFERENCE_CHAT = 'EXOTEL_CONFERENCE_CHAT',
  /** @deprecated Live dictation is retired; the server never returns this. */
  DICTATION_MODE = 'DICTATION_MODE',
}

export enum ScribeSessionMode {
  SCRIBE = 'SCRIBE',
  /**
   * Still very much in use for reading: every historical dictation recording
   * AND every manual "Create note" is stored with this mode. Only starting a
   * new live dictation session is gone.
   */
  DICTATION = 'DICTATION',
}
