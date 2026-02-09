import React, {useEffect, useMemo} from 'react';
import {Animated, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArchiveIcon, LeftArrow, ReplayIcon} from '@/assets';
import {ActionsMenu, TabScreenHeader} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

interface CallLogHeaderProps {
  search: string;
  onSearchChange: (text: string) => void;
  onRefresh?: () => void;
  onArchivePress?: () => void;
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
                label: t('CallSummary.header.actionsMenu.archive'),
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
    gap: '8@ms',
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
