import React, {useEffect} from 'react';
import {useSharedValue} from 'react-native-reanimated';

import {
  AudioWaveform,
  shapeAmplitudes,
  SILENT_AMPLITUDES,
} from '../AudioWaveform/AudioWaveform';

/** How often a new frame of amplitudes reaches the waveform. */
const FRAME_INTERVAL_MS = 120;

interface AudioWaveformContainerProps {
  latestAmplitudesRef: React.MutableRefObject<number[] | null>;
  isCallPaused: boolean;
  isFocusMode: boolean;
}

/**
 * Feeds the waveform new audio frames without re-rendering it.
 *
 * This used to setState on every frame, which re-rendered ~85 bars — twice over,
 * because the gradient was masked with a second copy of them — and restarted a
 * Reanimated animation on each one. That is on the order of a thousand animation
 * starts a second for a decoration, enough to starve the UI thread on a low-end
 * phone while a session is being recorded. Frames now land in one shared value,
 * so React does no work after mount and the cost stays on the UI thread.
 *
 * While the recording is paused the timer stops entirely: a paused session
 * should cost nothing.
 */
export const AudioWaveformContainer: React.FC<AudioWaveformContainerProps> = ({
  latestAmplitudesRef,
  isCallPaused,
  isFocusMode,
}) => {
  const amplitudes = useSharedValue<number[]>(SILENT_AMPLITUDES);

  useEffect(() => {
    if (isCallPaused) {
      amplitudes.value = SILENT_AMPLITUDES;
      return;
    }

    const interval = setInterval(() => {
      amplitudes.value = shapeAmplitudes(latestAmplitudesRef.current);
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [amplitudes, isCallPaused, latestAmplitudesRef]);

  return <AudioWaveform amplitudes={amplitudes} isFocusMode={isFocusMode} />;
};
