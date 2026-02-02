import {TouchableOpacity, View} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {AllyLogoIcon, DrawerMenuIcon} from '@/assets/icons';
import {isIOS} from '@/constants/general';
import {useTabScreenHeader, useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

export const SearchHeader = ({isFocused}: {isFocused: boolean}) => {
  const {t} = useTranslate();
  const {showHamburger, handleOpenDrawer} = useTabScreenHeader();
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

  return (
    <View style={styles.headerContainer}>
      {showHamburger && (
        <TouchableOpacity
          style={styles.hamburgerButton}
          onPress={handleOpenDrawer}>
          <DrawerMenuIcon />
        </TouchableOpacity>
      )}
      <View style={styles.logoContainer}>
        <AllyLogoIcon />
        <Animated.Text style={[styles.subHeader, subHeaderStyle]}>
          {t('SearchScreen.header.subTitle')}
        </Animated.Text>
      </View>
    </View>
  );
};
const styles = ScaledSheet.create({
  headerContainer: {
    alignItems: 'center',
    paddingHorizontal: '32@ms',
    marginTop: '80@mvs',
    position: 'relative',
  },
  hamburgerButton: {
    position: 'absolute',
    left: '16@ms',
    top: 0,
    padding: '4@ms',
    zIndex: 1,
  },
  logoContainer: {
    alignItems: 'center',
  },
  header: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontSize: '48@ms',
    color: colors.black,
    marginBottom: '12@vs',
    fontStyle: isIOS ? 'italic' : 'normal',
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
