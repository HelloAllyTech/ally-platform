import {CustomModal} from '@/components';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

interface CallEndModalProps {
  showCallEndConfirmation: boolean;
  setShowCallEndConfirmation: (show: boolean) => void;
  handleEndCall: () => void;
  isMicrophoneMode: boolean;
}

export const CallEndModal = ({
  showCallEndConfirmation,
  setShowCallEndConfirmation,
  handleEndCall,
  isMicrophoneMode,
}: CallEndModalProps) => {
  const {t} = useTranslate();
  return (
    <CustomModal
      visible={showCallEndConfirmation}
      onClose={() => setShowCallEndConfirmation(false)}
      description={t(
        isMicrophoneMode
          ? 'ListeningScreen.microphoneModeEndConfirmation'
          : 'ListeningScreen.callEndConfirmation',
      )}
      onPrimaryPress={handleEndCall}
      onSecondaryPress={() => setShowCallEndConfirmation(false)}
      primaryButtonText={t(
        isMicrophoneMode
          ? 'ListeningScreen.endSession'
          : 'ListeningScreen.endCall',
      )}
      secondaryButtonText={t(
        isMicrophoneMode
          ? 'CallSummary.info.cancel'
          : 'CallSummary.info.cancel',
      )}
      title={t(
        isMicrophoneMode
          ? 'ListeningScreen.endSession'
          : 'ListeningScreen.endCall',
      )}
      primaryTextColor={colors.brightRed}
    />
  );
};
