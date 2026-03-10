import React from 'react';

// import {View} from 'react-native';
// import {ScaledSheet} from 'react-native-size-matters';

// import {useToast} from '@/components';
// import {useTranslate} from '@/hooks';
// import {
//   useCreateReviewMutation,
//   useUpdateReviewStatusMutation,
// } from '@/services';
// import {ReviewStatus} from '@/types';

import {SimulationTranscript} from '../';

interface TranscriptTabProps {
  scenarioSessionId: string;
  reviewId?: string;
  setReviewId: (reviewId: string) => void;
  startedAt?: string;
  agentName?: string;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  scenarioSessionId,
  // reviewId,
  // setReviewId,
  // isPrivate,
  // setIsPrivate,
  startedAt,
  agentName,
}) => {
  if (!scenarioSessionId) {
    return null;
  }

  return (
    <>
      <SimulationTranscript
        sessionId={scenarioSessionId}
        startedAt={startedAt}
        agentName={agentName}
      />
      {/* <View style={styles.privacyToggleContainer}>
        <PrivacyToggle isPrivate={isPrivate} onToggle={handlePrivacyToggle} />
      </View> */}
    </>
  );
};

// const styles = ScaledSheet.create({
//   privacyToggleContainer: {
//     position: 'absolute',
//     bottom: '30@vs',
//     left: 0,
//     right: 0,
//   },
// });
