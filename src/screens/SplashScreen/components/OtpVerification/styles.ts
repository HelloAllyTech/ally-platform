import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {globalStyles} from '@/theme/helpers';
import {typography} from '@/theme/typography';

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
  phoneNumberText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.headline.small,
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
  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '4@ms',
  },
  helperText: {
    ...typography.body.small,
    color: colors.darkSlate,
  },
  resendButton: {
    marginLeft: '4@ms',
  },
  resendButtonText: {
    ...typography.body.small,
    color: colors.brightBlue,
  },
  resendButtonDisabled: {
    color: colors.mediumGray,
  },
});
