import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const styles = ScaledSheet.create({
  flex1: {
    flex: 1,
    backgroundColor: colors.white,
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
  },
  titleContainer: {
    position: 'absolute',
    alignSelf: 'flex-start',
    zIndex: 100,
    paddingHorizontal: '30@s',
    width: '100%',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '33@ms',
    lineHeight: '40@ms',
    color: colors.white,
    textAlign: 'left',
  },
  allyText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: 'italic',
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
    paddingTop: '50@ms',
    paddingHorizontal: '32@ms',
    paddingBottom: '44@ms',
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
});
