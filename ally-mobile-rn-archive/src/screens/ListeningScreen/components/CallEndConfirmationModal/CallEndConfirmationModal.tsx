import {ms} from 'react-native-size-matters';

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
    titleMain = t('audioCall.endDialog.titleNormal');
    titleItalic = t('audioCall.endDialog.titleItalic');
    description = t('audioCall.endDialog.content');
    actionButtonText = t('audioCall.endDialog.endSession');
  } else {
    titleMain = t('audioCall.endDialog.titleNormal');
    titleItalic = t('listeningScreen.call');
    description = t('audioCall.endDialog.content');
    actionButtonText = t('listeningScreen.endCall');
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
