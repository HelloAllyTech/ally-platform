import {ScaledSheet} from 'react-native-size-matters';

import {colors, radius, typography} from '@/theme';

export const styles = ScaledSheet.create({
  button: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  buttonDisabled: {
    backgroundColor: colors.ds.state.disabledContainer,
  },
  buttonLoading: {
    paddingVertical: '10@vs',
  },
  buttonText: {
    ...typography.body.medium,
  },
  loader: {
    marginVertical: '2.5@ms',
  },
  sizeSm: {
    paddingVertical: '6@vs',
    minHeight: '32@vs',
  },
  sizeMd: {
    paddingVertical: '10@vs',
    minHeight: '44@vs',
  },
  sizeLg: {
    paddingVertical: '14@vs',
    minHeight: '56@vs',
  },
});
