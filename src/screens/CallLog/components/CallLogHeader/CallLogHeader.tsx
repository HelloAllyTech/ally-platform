import React, {useEffect, useMemo} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArchiveIcon, FilterIcon, LeftArrow, ReplayIcon} from '@/assets';
import {ActionsMenu, TabScreenHeader} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface CallLogHeaderProps {
  search: string;
  onSearchChange: (text: string) => void;
  onRefresh?: () => void;
  onArchivePress?: () => void;
  onFilterPress?: () => void;
  /** Number of active filters, shown as a badge on the filter button. */
  activeFilterCount?: number;
  isFetching?: boolean;
  title?: string;
  subtitle?: string;
  showActionsMenu?: boolean;
  showBackButton?: boolean;
  onGoBack?: () => void;
}

export const CallLogHeader: React.FC<CallLogHeaderProps> = ({
  search: _search,
  onSearchChange: _onSearchChange,
  onRefresh,
  onArchivePress,
  onFilterPress,
  activeFilterCount = 0,
  isFetching = false,
  title,
  subtitle,
  showActionsMenu = false,
  showBackButton = false,
  onGoBack,
}) => {
  const {t} = useTranslate();
  const rotationAnimation = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (isFetching) {
      Animated.timing(rotationAnimation, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start();
    } else {
      setTimeout(() => {
        rotationAnimation.setValue(0);
      }, 600);
    }
  }, [isFetching, rotationAnimation]);

  const rotation = rotationAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const renderRefreshButton = () => {
    if (!onRefresh) return null;

    return (
      <View
        style={[
          styles.actionsContainer,
          showBackButton ? styles.rightContentOptionalPadding : undefined,
        ]}>
        {onFilterPress && (
          <TouchableOpacity
            onPress={onFilterPress}
            accessibilityLabel="Filter"
            style={styles.filterButton}>
            <FilterIcon width={16} height={16} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onRefresh} accessibilityLabel="Refresh">
          <Animated.View
            style={[styles.iconContainer, {transform: [{rotate: rotation}]}]}>
            <ReplayIcon width={16} height={16} />
          </Animated.View>
        </TouchableOpacity>

        {showActionsMenu && (
          <ActionsMenu
            options={[
              {
                leftIcon: <ArchiveIcon width={16} height={16} />,
                label: t('callSummary.header.actionsMenu.archive'),
                onPress: onArchivePress || (() => {}),
              },
            ]}
            iconSize={16}
          />
        )}
      </View>
    );
  };

  if (!title) {
    return <TabScreenHeader title="" rightContent={renderRefreshButton()} />;
  }

  return (
    <View style={styles.headerContainer}>
      {showBackButton && (
        <TouchableOpacity onPress={onGoBack} style={styles.backButton}>
          <LeftArrow width={14} height={14} color={colors.ds.icon.default} />
        </TouchableOpacity>
      )}
      <TabScreenHeader
        title={title}
        subtitle={subtitle}
        italicSubtitle
        rightContent={renderRefreshButton()}
        containerStyle={showBackButton ? styles.tabScreenHeader : undefined}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  iconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  filterButton: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: '-6@ms',
    right: '-8@ms',
    minWidth: '14@ms',
    height: '14@ms',
    paddingHorizontal: '3@ms',
    borderRadius: '7@ms',
    backgroundColor: colors.azureBlue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    ...typography.body.nano,
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.white,
  },
  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '12@ms',
    marginTop: '16@ms',
    paddingLeft: '16@ms',
  },
  tabScreenHeader: {
    paddingHorizontal: '16@ms',
    borderBottomWidth: 0,
  },
  rightContentOptionalPadding: {
    paddingRight: '24@ms',
  },
});
