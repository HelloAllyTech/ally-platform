import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '24@s',
    paddingVertical: '16@vs',
    backgroundColor: colors.white,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@s',
  },
  input: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.lightGray17,
    borderRadius: '100@ms',
    paddingVertical: '8@vs',
    paddingHorizontal: '8@s',
    backgroundColor: colors.white,
    minHeight: '36@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: 0.25,
  },
  sendButton: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '100@ms',
    backgroundColor: colors.ds.theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
});
