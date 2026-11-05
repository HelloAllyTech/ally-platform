import React from 'react';
import {useTranslation} from 'react-i18next';

import {HourGlassIcon} from '@/assets/icons';
import {IllustratedActionModal} from '@/components';

interface EndingSoonModalProps {
  visible: boolean;
  titleMain: string;
  titleItalic: string;
  description: string;
  onContinue: () => void;
  onEndSession: () => void;
}

export const EndingSoonModal: React.FC<EndingSoonModalProps> = ({
  visible,
  titleMain,
  titleItalic,
  description,
  onContinue,
  onEndSession,
}) => {
  const {t} = useTranslation();

  return (
    <IllustratedActionModal
      visible={visible}
      titleMain={titleMain}
      titleItalic={titleItalic}
      description={description}
      illustration={<HourGlassIcon />}
      actions={[
        {
          label: t('simulationPage.endSession'),
          onPress: onEndSession,
          variant: 'secondary',
        },
        {
          label: t('common.continue'),
          onPress: onContinue,
          variant: 'primary',
        },
      ]}
    />
  );
};
