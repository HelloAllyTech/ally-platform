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
  participant?: any;
  source?: any;
  publication?: any;
}

export interface CircleProps {
  circleNumber: number;
  config: CircleConfig;
  audioLevel: number;
}
