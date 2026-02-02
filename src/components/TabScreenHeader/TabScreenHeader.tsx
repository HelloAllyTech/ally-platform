import React from 'react';
import {
  Platform,
  StyleProp,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DrawerMenuIcon} from '@/assets/icons';
import {useTabScreenHeader} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

interface TabScreenHeaderProps {
  title: string;
  subtitle?: string;
  italicSubtitle?: boolean;
  rightContent?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  showBorder?: boolean;
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
}) => {
  const {showHamburger, handleOpenDrawer} = useTabScreenHeader();

  return (
    <View
      style={[styles.container, showBorder && styles.border, containerStyle]}>
      <View style={styles.leftGroup}>
        {showHamburger && (
          <TouchableOpacity
            style={styles.hamburgerButton}
            onPress={handleOpenDrawer}
            accessibilityLabel="Open menu">
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
      </View>
      {rightContent && <View style={styles.rightContent}>{rightContent}</View>}
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
    gap: '12@ms',
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
    flex: 1,
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
});
