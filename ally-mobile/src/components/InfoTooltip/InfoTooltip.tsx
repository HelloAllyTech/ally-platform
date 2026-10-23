import React, {ReactElement} from 'react';
import {StatusBar} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import Tooltip, {TooltipProps} from 'react-native-walkthrough-tooltip';

import {isIOS} from '@/constants';
import {colors} from '@/theme';

interface InfoTooltipProps {
  content: ReactElement;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  displayInsets?: TooltipProps['displayInsets'];
}

export const InfoTooltip = ({
  content,
  placement = 'top',
  isVisible,
  onClose,
  children,
}: InfoTooltipProps) => {
  return (
    <Tooltip
      backgroundColor="transparent"
      backgroundStyle={styles.tooltipBackground}
      content={content}
      placement={placement}
      contentStyle={styles.tooltipContent}
      isVisible={isVisible}
      onClose={onClose}
      showChildInTooltip={false}
      topAdjustment={isIOS ? 0 : -(StatusBar.currentHeight ?? 0)}>
      {children}
    </Tooltip>
  );
};

const styles = ScaledSheet.create({
  tooltipContent: {
    maxWidth: '260@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '8@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.darkGray17,
  },
  tooltipBackground: {
    backgroundColor: 'transparent',
  },
});
