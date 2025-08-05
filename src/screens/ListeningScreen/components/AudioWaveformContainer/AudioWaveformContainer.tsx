import React, {useEffect, useState} from 'react';

import {AudioWaveform} from '../AudioWaveform/AudioWaveform';

interface AudioWaveformContainerProps {
  latestAmplitudesRef: React.MutableRefObject<number[] | null>;
  isCallPaused: boolean;
  isFocusMode: boolean;
}

export const AudioWaveformContainer: React.FC<AudioWaveformContainerProps> = ({
  latestAmplitudesRef,
  isCallPaused,
  isFocusMode,
}) => {
  const [amplitudes, setAmplitudes] = useState<number[] | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setAmplitudes(latestAmplitudesRef.current);
    }, 120);

    return () => clearInterval(interval);
  }, [latestAmplitudesRef]);

  return (
    <AudioWaveform
      amplitudes={isCallPaused ? null : amplitudes}
      isFocusMode={isFocusMode}
    />
  );
};
