import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
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
      contentStyle={styles.content}>
      {children}
    </Tooltip>
  );
};

const styles = ScaledSheet.create({
  content: {
    paddingBottom: 10,
    marginRight: 10,
  },
});
