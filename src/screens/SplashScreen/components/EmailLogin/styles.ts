import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  contentContainer: {
    flex: 1,
  },
  headerText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.headline.small,
    color: colors.darkSlate,
    marginBottom: '24@ms',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    fontSize: '14@ms',
    letterSpacing: 0.25,
    fontWeight: '400',
    color: colors.black,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.lightGray2,
    borderRadius: '8@ms',
    paddingHorizontal: '16@s',
    paddingVertical: '10@vs',
  },
  inputEnabled: {
    opacity: 1,
  },
  inputFocused: {
    borderColor: colors.brightBlue,
  },
  bottomContainer: {
    width: '100%',
  },
  termsContainer: {
    paddingHorizontal: '16@ms',
    marginBottom: '24@ms',
  },
  termsText: {
    ...typography.body.small,
    color: colors.mediumGray,
    textAlign: 'center',
  },
  termsLink: {
    color: colors.brightBlue,
    textDecorationLine: 'none',
  },
});
