import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '20@ms',
  },
  contentContainer: {
    flex: 1,
  },
  headerText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.headline.small,
    fontSize: '20@ms',
    color: colors.darkSlate,
    marginBottom: '24@ms',
  },
  inputContainer: {
    gap: '8@s',
  },
  inputLabel: {
    ...typography.body.small,
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.charcoal2,
  },
  input: {
    ...fontFamily.ROBOTO.REGULAR,
    minHeight: '40@vs',
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
    marginRight: '2@s',
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
