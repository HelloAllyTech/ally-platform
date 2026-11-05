import React, {ReactElement, useCallback, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  Platform,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DrawerMenuIcon, InfoIcon} from '@/assets/icons';
import {useTabScreenHeader} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {InfoTooltip} from '../InfoTooltip';
import {ProgressHeaderWidget} from '../ProgressHeaderWidget';

interface TabScreenHeaderProps {
  title: string;
  subtitle?: string;
  italicSubtitle?: boolean;
  rightContent?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  showBorder?: boolean;
  tooltipContent?: ReactElement;
  isTooltipRequired?: boolean;
}

/**
 * Reusable header component for tab screens with optional hamburger menu
 * The hamburger menu automatically shows only on the first visible tab
 */
export const TabScreenHeader: React.FC<TabScreenHeaderProps> = ({
  title,
  subtitle,
  italicSubtitle = false,
  rightContent,
  containerStyle,
  showBorder = true,
  isTooltipRequired = false,
  tooltipContent,
}) => {
  const {showHamburger, handleOpenDrawer} = useTabScreenHeader();
  const {t} = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const handleShowTooltip = useCallback(() => {
    setShowTooltip(prev => !prev);
  }, []);

  return (
    <View
      style={[styles.container, showBorder && styles.border, containerStyle]}>
      <View style={styles.leftGroup}>
        {showHamburger && (
          <TouchableOpacity
            style={styles.hamburgerButton}
            onPress={handleOpenDrawer}
            accessibilityLabel={t('accessibility.openMenu')}>
            <DrawerMenuIcon />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>
          {title}
          {subtitle && (
            <Text
              style={[
                styles.subtitle,
                italicSubtitle && styles.subtitleItalic,
              ]}>
              {' '}
              {subtitle}
            </Text>
          )}
        </Text>
        {isTooltipRequired && (
          <InfoTooltip
            content={tooltipContent || <View />}
            placement="bottom"
            isVisible={showTooltip}
            onClose={handleShowTooltip}>
            <TouchableOpacity
              style={styles.tooltipIcon}
              onPress={handleShowTooltip}>
              <InfoIcon width={16} height={16} color={colors.ds.icon.default} />
            </TouchableOpacity>
          </InfoTooltip>
        )}
      </View>
      <View style={styles.trailingGroup}>
        {/* Rendered here rather than passed in per screen so it is genuinely on every
            header, and so it does not compete with `rightContent`, which the busiest
            screens already use for credits and badge counts. Returns null until the
            org gate resolves true. */}
        <ProgressHeaderWidget />
        {rightContent && (
          <View style={styles.rightContent}>{rightContent}</View>
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingVertical: '12@ms',
    marginTop: '16@ms',
  },
  border: {
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    flex: 1,
  },
  hamburgerButton: {
    padding: '4@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
  },
  subtitle: {
    fontWeight: fontWeights.light,
  },
  subtitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontWeight: fontWeights.light,
    fontStyle: Platform.OS === 'ios' ? 'italic' : 'normal',
  },
  rightContent: {
    flexShrink: 0,
  },
  trailingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    flexShrink: 0,
  },
  tooltipIcon: {
    marginRight: '12@ms',
  },
});
