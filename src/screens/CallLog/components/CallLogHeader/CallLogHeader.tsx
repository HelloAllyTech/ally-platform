import React, {useEffect, useMemo} from 'react';
import {Animated, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ReplayIcon} from '@/assets/icons';
import {TabScreenHeader} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

interface CallLogHeaderProps {
  search: string;
  onSearchChange: (text: string) => void;
  onRefresh?: () => void;
  isFetching?: boolean;
  showTitle?: boolean;
}

export const CallLogHeader: React.FC<CallLogHeaderProps> = ({
  search: _search,
  onSearchChange: _onSearchChange,
  onRefresh,
  isFetching = false,
  showTitle = true,
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
      <TouchableOpacity onPress={onRefresh} accessibilityLabel="Refresh">
        <Animated.View
          style={[styles.iconContainer, {transform: [{rotate: rotation}]}]}>
          <ReplayIcon width={16} height={16} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  if (!showTitle) {
    return (
      <TabScreenHeader
        title=""
        rightContent={renderRefreshButton()}
        containerStyle={styles.headerRow}
        showBorder={false}
      />
    );
  }

  return (
    <TabScreenHeader
      title={t('CallLogs.header.title')}
      subtitle={t('CallLogs.header.subtitle')}
      italicSubtitle
      rightContent={renderRefreshButton()}
      containerStyle={styles.headerRow}
      showBorder={false}
    />
  );
};

const styles = ScaledSheet.create({
  headerRow: {
    marginTop: '16@mvs',
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  iconContainer: {
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
