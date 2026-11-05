import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  flex1: {
    flex: 1,
    backgroundColor: colors.darkGreen,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  animationContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    top: 0,
    bottom: 0,
    zIndex: 1,
    flex: 1,
  },
  animation: {
    width: '100%',
    height: '100%',
    flex: 1,
    marginBottom: '-20@mvs',
  },
  titleContainer: {
    position: 'absolute',
    alignSelf: 'flex-start',
    zIndex: 100,
    paddingHorizontal: '30@s',
    width: '100%',
    marginTop: '-15@s',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '33@ms',
    lineHeight: '40@ms',
    color: colors.white,
    textAlign: 'left',
  },
  allyText: {
    ...fontFamily.YESEVA_ONE.REGULAR,
  },
  sheetContent: {
    padding: '20@ms',
  },
  sheetText: {
    fontSize: '16@ms',
    marginBottom: '16@ms',
    color: colors.white,
  },
  authContainer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: '24@ms',
    borderTopRightRadius: '24@ms',
    paddingHorizontal: '32@ms',
    height: '65%',
    zIndex: 50,
    marginTop: '-18@vs',
  },
  backButton: {
    width: '40@ms',
    height: '40@ms',
    borderRadius: '20@ms',
    backgroundColor: colors.white,
    opacity: 0.7,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: '62@s',
    left: '30@s',
    zIndex: 200,
  },
  bottomAbsoluteContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 200,
  },
  blurBackground: {
    borderRadius: '20@ms',
    marginHorizontal: '20@ms',
    marginBottom: '20@vs',
    padding: '20@ms',
  },
  loginButtonContainer: {
    marginTop: '20@vs',
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    width: '80%',
    marginLeft: '36@ms',
    marginRight: '36@ms',
    zIndex: 200,
    marginBottom: '60@vs',
  },
  loginButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.charcoalGray,
  },
  carouselContainer: {
    position: 'absolute',
    bottom: '100@vs',
    width: '100%',
    zIndex: 200,
  },
  welcomeGradientContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '58%',
    height: '25%',
    zIndex: 40,
  },
});
