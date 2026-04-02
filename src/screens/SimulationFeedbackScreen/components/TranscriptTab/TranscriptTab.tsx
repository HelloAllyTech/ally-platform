import React from 'react';

import {useSimulationSessionRecordingUrl} from '@/hooks/useSimulationSessionRecordingUrl';

import {SimulationTranscript} from '../';

interface TranscriptTabProps {
  scenarioSessionId: string;
  startedAt?: string;
  agentName?: string;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  scenarioSessionId,
  startedAt,
  agentName,
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
      />
    </>
  );
};
