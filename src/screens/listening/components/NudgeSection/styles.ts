import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

export const styles = ScaledSheet.create({
  container: {
    position: 'absolute',
    bottom: '0@ms',
    width: '85%',
    maxHeight: '300@vs',
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
  },
  gradient: {
    flex: 1,
    padding: '16@ms',
  },
  scrollView: {
    flex: 1,
    marginBottom: '12@vs',
  },
  title: {
    ...fontFamily.REPLAY_PRO.BOLD,
    fontSize: '16@ms',
    lineHeight: '41@ms',
    color: colors.white,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.paleBlue,
    lineHeight: '22@ms',
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
  feedbackIcon: {
    fontSize: '16@ms',
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 100,
  },
  listeningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 100,
  },
  listeningText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    color: colors.white,
    opacity: 0.7,
  },
});
