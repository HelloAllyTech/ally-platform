import {CustomModal} from '@/components/Modal/CustomModal';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';

interface CallEndConfirmationModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isMicrophoneMode: boolean;
}

export const CallEndConfirmationModal = ({
  visible,
  onClose,
  onConfirm,
  isMicrophoneMode,
}: CallEndConfirmationModalProps) => {
  const {t} = useTranslate();

  let title: string, description: string, primaryButtonText: string;
  if (isMicrophoneMode) {
    title = t('ListeningScreen.endSession');
    description = t('ListeningScreen.microphoneModeEndConfirmation');
    primaryButtonText = t('ListeningScreen.endSession');
  } else {
    title = t('ListeningScreen.endCall');
    description = t('ListeningScreen.callEndConfirmation');
    primaryButtonText = t('ListeningScreen.endCall');
  }

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      title={title}
      description={description}
      primaryButtonText={primaryButtonText}
      secondaryButtonText={t('CallSummary.info.cancel')}
      onPrimaryPress={onConfirm}
      onSecondaryPress={onClose}
      primaryTextColor={colors.brightRed}
    />
  );
};
