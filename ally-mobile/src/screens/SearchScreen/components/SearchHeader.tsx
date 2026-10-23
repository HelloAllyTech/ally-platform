import {View} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {AllyLogoIcon} from '@/assets/icons';
import {TabScreenHeader} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

export const SearchHeader = ({isFocused}: {isFocused: boolean}) => {
  const {t} = useTranslate();
  const subHeaderStyle = useAnimatedStyle(() => {
    const opacity = interpolate(isFocused ? 1 : 0, [0, 1], [1, 0]);
    const translateY = interpolate(isFocused ? 1 : 0, [0, 1], [0, -10]);
    const height = interpolate(isFocused ? 1 : 0, [0, 1], [50, 0]);
    const marginBottom = interpolate(isFocused ? 1 : 0, [0, 1], [24, 0]);

    return {
      opacity: withTiming(opacity, {duration: 300}),
      transform: [{translateY: withTiming(translateY, {duration: 300})}],
      height: withTiming(height, {duration: 300}),
      marginBottom: withTiming(marginBottom, {duration: 300}),
    };
  });

  const renderCenterContent = () => (
    <View style={styles.logoContainer}>
      <AllyLogoIcon />
      <Animated.Text style={[styles.subHeader, subHeaderStyle]}>
        {t('search.headerDescription')}
      </Animated.Text>
    </View>
  );

  return (
    <View style={styles.headerContainer}>
      <TabScreenHeader
        title=""
        rightContent={renderCenterContent()}
        containerStyle={styles.tabHeaderContainer}
        showBorder={false}
      />
    </View>
  );
};
const styles = ScaledSheet.create({
  headerContainer: {
    marginTop: '80@mvs',
  },
  tabHeaderContainer: {
    justifyContent: 'center',
    paddingHorizontal: '32@ms',
  },
  logoContainer: {
    alignItems: 'center',
    flex: 1,
  },
  subHeader: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    color: colors.black,
    marginBottom: '24@vs',
    marginTop: '10@ms',
    textAlign: 'center',
  },
});
