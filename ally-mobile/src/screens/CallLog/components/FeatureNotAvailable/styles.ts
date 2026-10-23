import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants/general';
import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  clientContainer: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '40@s',
  },
  oopsText: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    color: colors.black,
    fontSize: '48@ms',
    lineHeight: '56@ms',
    textAlign: 'center',
    marginBottom: '30@mvs',
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  messageContainer: {
    marginBottom: '15@mvs',
    alignItems: 'center',
  },
  messageText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.mediumGray,
    fontSize: '18@ms',
    lineHeight: '24@ms',
    textAlign: 'center',
  },
  learnMoreButton: {
    paddingVertical: '8@mvs',
    paddingHorizontal: '24@ms',
  },
  learnMoreText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.brightBlue,
    fontSize: '16@ms',
    lineHeight: '20@ms',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
