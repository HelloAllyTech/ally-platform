import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    borderRadius: '16@ms',
    borderWidth: 0.5,
    borderColor: colors.gunmetal,
    backgroundColor: colors.smokyBlack,
    overflow: 'hidden',
    marginTop: '10@vs',
    alignSelf: 'stretch',
  },
  content: {
    padding: '12@ms',
  },
  scrollView: {
    maxHeight: '80@vs',
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.white,
  },
  feedbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: '8@vs',
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
