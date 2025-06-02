import {CustomModal} from '@/components';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

interface CallEndModalProps {
  showCallEndConfirmation: boolean;
  setShowCallEndConfirmation: (show: boolean) => void;
  handleEndCall: () => void;
}

export const CallEndModal = ({
  showCallEndConfirmation,
  setShowCallEndConfirmation,
  handleEndCall,
}: CallEndModalProps) => {
  const {t} = useTranslate();
  return (
    <CustomModal
      visible={showCallEndConfirmation}
      onClose={() => setShowCallEndConfirmation(false)}
      description={t('ListeningScreen.callEndConfirmation')}
      onPrimaryPress={handleEndCall}
      onSecondaryPress={() => setShowCallEndConfirmation(false)}
      primaryButtonText={t('ListeningScreen.endCall')}
      secondaryButtonText={t('CallSummary.info.cancel')}
      title={t('ListeningScreen.endCall')}
      primaryTextColor={colors.brightRed}
    />
  );
};
