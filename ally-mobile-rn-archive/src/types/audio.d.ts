import {RemoteParticipant, Track, TrackPublication} from 'livekit-client';

declare module '*.mp3' {
  const value: string;
  export default value;
}

declare module '*.ogg' {
  const value: string;
  export default value;
}

export interface CircleConfig {
  scale: number;
  isStatic: boolean;
}

export interface AudioTrackRef {
  participant?: RemoteParticipant;
  source?: Track.Source;
  publication?: TrackPublication;
}

export interface CircleProps {
  circleNumber: number;
  config: CircleConfig;
  audioLevel: number;
}
