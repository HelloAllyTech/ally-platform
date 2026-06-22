import React from 'react';

import {CallIcon, TickIcon, TranscriptIcon} from '@/assets/icons';
import {DropdownMenu} from '@/components';
import {useTranslate} from '@/hooks';

interface SummaryDropdownProps {
  visible: boolean;
  onClose: () => void;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
}

export const SummaryDropdown: React.FC<SummaryDropdownProps> = ({
  visible,
  onClose,
  showSummary,
  setShowSummary,
}) => {
  const {t} = useTranslate();

  const items = [
    {
      icon: <CallIcon width={24} height={24} />,
      text: t('callSummary.header.callSummary'),
      isSelected: showSummary,
      selectedIcon: <TickIcon width={24} height={24} />,
      onPress: () => setShowSummary(true),
    },
    {
      icon: <TranscriptIcon width={24} height={24} />,
      text: t('callSummary.header.callTranscript'),
      isSelected: !showSummary,
      selectedIcon: <TickIcon width={24} height={24} />,
      onPress: () => setShowSummary(false),
    },
  ];

  return <DropdownMenu visible={visible} onClose={onClose} items={items} />;
};
