import {useCallback, useEffect, useRef, useState} from 'react';
import {ParticipantEvent, TrackPublication} from 'livekit-client';

// Custom hook for real-time audio level detection from remote participant
export const useAudioLevel = (trackRef: {
  participant?: any;
  publication?: TrackPublication;
}) => {
  const [audioLevel, setAudioLevel] = useState(1);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const participantRef = useRef<any>(null);

  // Helper function to calculate realistic audio level variations
  const calculateSimulatedAudioLevel = (): number => {
    const now = Date.now();
    const time1 = now / 800; // Slower wave for base level
    const time2 = now / 300; // Faster wave for voice variations
    const time3 = now / 150; // Even faster for speech patterns

    const baseWave = Math.sin(time1) * 0.15;
    const voiceWave = Math.sin(time2) * 0.25;
    const speechWave = Math.sin(time3) * 0.1;
    const randomVariation = (Math.random() - 0.5) * 0.2;

    return Math.max(
      0,
      Math.min(1, 0.3 + baseWave + voiceWave + speechWave + randomVariation),
    );
  };

  // Helper function to get audio level from participant
  const getParticipantAudioLevel = (participant: any): number => {
    const participantAudioLevel = participant?.audioLevel || 0;
    return participantAudioLevel > 0 ? Math.min(participantAudioLevel, 1) : 0;
  };

  // Start monitoring audio levels when participant is speaking
  const startAudioMonitoring = useCallback(() => {
    const updateAudioLevel = () => {
      if (!participantRef.current) return;

      const realAudioLevel = getParticipantAudioLevel(participantRef.current);

      if (realAudioLevel > 0) {
        setAudioLevel(realAudioLevel);
      } else {
        setAudioLevel(calculateSimulatedAudioLevel());
      }
    };

    intervalRef.current = setInterval(updateAudioLevel, 50);
    updateAudioLevel(); // Initial update
  }, []);

  // Stop monitoring and gradually decrease audio level
  const stopAudioMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Gradually decrease audio level when not speaking
    const decreaseLevel = () => {
      setAudioLevel(prev => (prev <= 0.05 ? 0 : prev - 0.05));
    };

    const decreaseInterval = setInterval(decreaseLevel, 50);
    setTimeout(() => clearInterval(decreaseInterval), 1000);
  }, []);

  useEffect(() => {
    const participant = trackRef.participant;

    if (!participant) {
      setAudioLevel(1);
      return;
    }

    participantRef.current = participant;

    const handleSpeakingChanged = (isSpeaking: boolean) => {
      if (isSpeaking) {
        startAudioMonitoring();
      } else {
        stopAudioMonitoring();
      }
    };

    // Add event listener for speaking changes
    participant.on(ParticipantEvent.IsSpeakingChanged, handleSpeakingChanged);

    // Check initial speaking state
    if (participant.isSpeaking) {
      handleSpeakingChanged(true);
    }

    // Cleanup function
    return () => {
      participant.off(
        ParticipantEvent.IsSpeakingChanged,
        handleSpeakingChanged,
      );
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [trackRef.participant, startAudioMonitoring, stopAudioMonitoring]);

  return audioLevel;
};
