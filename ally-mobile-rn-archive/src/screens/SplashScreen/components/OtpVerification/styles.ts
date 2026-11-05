import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, globalStyles, typography} from '@/theme';

export const styles = ScaledSheet.create({
  contentContainer: {
    flex: 1,
    paddingTop: '30@ms',
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: '54@vs',
  },
  containerWrapper: {
    flex: 1,
  },
  headerText: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.headline.small,
    fontSize: '20@ms',
    color: colors.darkSlate,
    marginBottom: '24@ms',
  },
  emailText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.headline.small,
    fontSize: '20@ms',
  },
  otpContainer: {
    marginBottom: '16@ms',
  },
  errorContainer: {
    ...globalStyles.center,
    backgroundColor: colors.roseWhite,
    padding: '12@ms',
    borderRadius: '8@ms',
    marginBottom: '16@ms',
    marginTop: '8@ms',
  },
  errorText: {
    ...typography.body.small,
    color: colors.vividRed,
  },
  expiryContainer: {
    marginTop: '8@ms',
  },
  expiryText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.darkSlate,
    lineHeight: '20@ms',
  },
  expiryBoldText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
  },
  resendInlineButton: {
    alignSelf: 'flex-start',
    marginTop: '2@ms',
  },
  resendButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.theme.primary,
  },
  resendButtonDisabled: {
    color: colors.ds.typography.lowEmphasis,
  },
});
