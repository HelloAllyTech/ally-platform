import {ScaledSheet} from 'react-native-size-matters';

import {WINDOW_HEIGHT} from '@/constants/general';
import {colors} from '@/theme/colors';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  card: {
    backgroundColor: colors.white,
    marginTop: 0,
    overflow: 'hidden',
    minHeight: WINDOW_HEIGHT * 0.8,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: '60@vs',
    left: '50%',
    // To take into account the width of the arrow button
    marginLeft: '-20@s',
    width: '40@s',
    height: '40@s',
    borderRadius: '20@s',
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  contentContainer: {
    paddingTop: '80@ms',
  },
  paddingTop: {
    paddingTop: '80@ms',
  },
  downArrow: {
    transform: [{rotate: '270deg'}],
  },
});
