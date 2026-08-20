import React from 'react';

import {useSimulationSessionRecordingUrl} from '@/hooks/useSimulationSessionRecordingUrl';
import {TranscriptFocusRequest} from '@/types';

import {SimulationTranscript} from '../';

interface TranscriptTabProps {
  scenarioSessionId: string;
  startedAt?: string;
  agentName?: string;
  /** A moment to scroll to, raised by a debrief note chip. */
  focusMessage?: TranscriptFocusRequest | null;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  scenarioSessionId,
  startedAt,
  agentName,
  focusMessage,
}) => {
  const recording = useSimulationSessionRecordingUrl(scenarioSessionId);

  if (!scenarioSessionId) {
    return null;
  }

  return (
    <>
      <SimulationTranscript
        sessionId={scenarioSessionId}
        startedAt={startedAt}
        agentName={agentName}
        audioUrl={recording.url}
        recordingUrlLoading={recording.isInitialLoad}
        onRecordingPlaybackFailed={
          recording.url ? recording.refreshFromPlaybackError : undefined
        }
        focusMessage={focusMessage}
      />
    </>
  );
};
