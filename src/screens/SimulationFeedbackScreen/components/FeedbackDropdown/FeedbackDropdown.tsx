import React from 'react';

import {SimulationIcon, TickIcon, TranscriptIcon} from '@/assets';
import {DropdownMenu} from '@/components';
import {useTranslate} from '@/hooks';

interface FeedbackDropdownProps {
  visible: boolean;
  onClose: () => void;
  showSummary: boolean;
  setShowSummary: (show: boolean) => void;
}

export const FeedbackDropdown: React.FC<FeedbackDropdownProps> = ({
  visible,
  onClose,
  showSummary,
  setShowSummary,
}) => {
  const {t} = useTranslate();

  const items = [
    {
      icon: <SimulationIcon width={24} height={24} />,
      text: `${t('SimulationFeedback.title')} ${t('CallSummary.header.subtitle')}`,
      isSelected: showSummary,
      selectedIcon: <TickIcon width={24} height={24} />,
      onPress: () => setShowSummary(true),
    },
    {
      icon: <TranscriptIcon width={24} height={24} />,
      text: `${t('SimulationFeedback.title')} ${t('SimulationFeedback.transcript')}`,
      isSelected: !showSummary,
      selectedIcon: <TickIcon width={24} height={24} />,
      onPress: () => setShowSummary(false),
    },
  ];

  return <DropdownMenu visible={visible} onClose={onClose} items={items} />;
};
