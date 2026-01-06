import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingTop: '15@ms',
    paddingBottom: '20@vs',
  },
  contentContainer: {
    flexGrow: 1,
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
    marginBottom: '8@vs',
  },
  inputEnabled: {
    opacity: 1,
  },
  inputFocused: {
    borderColor: colors.brightBlue,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '30@vs',
    marginBottom: '22@vs',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.ds.stroke.primary,
  },
  dividerText: {
    ...typography.body.small,
    color: colors.mediumGray,
    marginHorizontal: '10@s',
  },
  bottomContainer: {
    width: '100%',
  },
  termsContainer: {
    paddingHorizontal: '12@ms',
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
