import {ms, ScaledSheet} from 'react-native-size-matters';

import {EndSessionIcon} from '@/assets/icons';
import {IllustratedModal} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

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

  let titleMain: string,
    titleItalic: string,
    description: string,
    actionButtonText: string;
  if (isMicrophoneMode) {
    titleMain = t('ListeningScreen.end');
    titleItalic = t('ListeningScreen.session');
    description = t('ListeningScreen.microphoneModeEndConfirmation');
    actionButtonText = t('ListeningScreen.endSession');
  } else {
    titleMain = t('ListeningScreen.end');
    titleItalic = t('ListeningScreen.call');
    description = t('ListeningScreen.callEndConfirmation');
    actionButtonText = t('ListeningScreen.endCall');
  }

  const illustration = <EndSessionIcon />;

  return (
    <IllustratedModal
      visible={visible}
      onClose={onClose}
      description={description}
      actionButtonText={actionButtonText}
      titleMain={titleMain}
      titleItalic={titleItalic}
      onActionPress={onConfirm}
      actionButtonColor={colors.brightRed}
      illustration={illustration}
      actionButtonStyle={{
        paddingHorizontal: ms(40),
      }}
    />
  );
};

const styles = ScaledSheet.create({
  illustration: {
    width: '171.05@ms',
    height: '154.99@ms',
  },
});
