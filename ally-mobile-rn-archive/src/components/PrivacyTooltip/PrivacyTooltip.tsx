import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Tooltip, {TooltipProps} from 'react-native-walkthrough-tooltip';

interface PrivacyTooltipProps {
  children: React.ReactNode;
  isVisible: boolean;
  tooltipContent: TooltipProps['content'];
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  onClose: () => void;
  displayInsets?: TooltipProps['displayInsets'];
}

export const PrivacyTooltip: React.FC<PrivacyTooltipProps> = ({
  children,
  isVisible,
  tooltipContent = <View />,
  onClose,
  placement = 'top',
  displayInsets,
}) => {
  return (
    <Tooltip
      isVisible={isVisible}
      content={tooltipContent}
      onClose={onClose}
      placement={placement}
      showChildInTooltip={false}
      displayInsets={displayInsets}
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
