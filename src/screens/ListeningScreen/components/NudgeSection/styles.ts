import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const styles = ScaledSheet.create({
  container: {
    minHeight: '120@vs',
    borderRadius: '16@ms',
    borderWidth: 0.5,
    borderColor: colors.gray99,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    marginHorizontal: '27@s',
  },
  content: {
    padding: '16@ms',
  },
  scrollView: {
    marginBottom: '12@vs',
    maxHeight: '160@vs',
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    lineHeight: '41@ms',
    color: colors.white,
  },
  feedbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: '16@vs',
    borderTopWidth: '0.5@ms',
    borderTopColor: colors.teal,
  },
  feedbackText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    letterSpacing: 0.25,
    color: colors.white,
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: '9@s',
    marginLeft: '9@s',
  },
  thumbContainer: {
    width: '16@ms',
    height: '16@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbDown: {
    transform: [{rotate: '180deg'}],
  },
});
