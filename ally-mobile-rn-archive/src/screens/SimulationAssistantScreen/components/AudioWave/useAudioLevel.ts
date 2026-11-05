import {useCallback, useEffect, useRef, useState} from 'react';
import {Participant, ParticipantEvent, TrackPublication} from 'livekit-client';

/**
 * Real-time audio level for a participant.
 *
 * Typed against `Participant`, not `RemoteParticipant`: the only members used
 * here — `audioLevel`, `isSpeaking`, `on`, `off` — are all on the base class,
 * and a local participant has an audio level too. The narrower type rejected
 * `ParticipantTile`, which holds a plain `Participant`, for no benefit.
 *
 * `null` is accepted alongside `undefined` because callers holding a
 * "nobody selected yet" ref reach for `null`, and both mean the same thing
 * here: emit zero.
 */
export const useAudioLevel = (trackRef: {
  participant?: Participant | null;
  publication?: TrackPublication;
}) => {
  const [audioLevel, setAudioLevel] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const participantRef = useRef<Participant | null>(null);

  // Helper function to get audio level from participant
  const getParticipantAudioLevel = (participant: Participant): number => {
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
        // When speaking but no audio level detected (or very low), set a small non-zero value
        // to indicate activity so the border can show up.
        setAudioLevel(0.1);
      }
    };

    intervalRef.current = setInterval(updateAudioLevel, 100);
    updateAudioLevel(); // Initial update
  }, []);

  // Stop monitoring and reset audio level
  const stopAudioMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  useEffect(() => {
    const participant = trackRef.participant;

    if (!participant) {
      setAudioLevel(0);
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
    } else if (getParticipantAudioLevel(participant) > 0) {
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
