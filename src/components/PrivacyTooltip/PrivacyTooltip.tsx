import React from 'react';
import {View} from 'react-native';
import Tooltip, {TooltipProps} from 'react-native-walkthrough-tooltip';

import {tooltipDisplayInsets} from '@/constants';

interface PrivacyTooltipProps {
  children: React.ReactNode;
  isVisible: boolean;
  tooltipContent: TooltipProps['content'];
  onClose: () => void;
}

export const PrivacyTooltip: React.FC<PrivacyTooltipProps> = ({
  children,
  isVisible,
  tooltipContent = <View />,
  onClose,
}) => {
  return (
    <Tooltip
      isVisible={isVisible}
      content={tooltipContent}
      onClose={onClose}
      placement="top"
      showChildInTooltip={false}
      displayInsets={tooltipDisplayInsets}
      contentStyle={{
        paddingBottom: 10,
        marginRight: 10,
      }}>
      {children}
    </Tooltip>
  );
};
