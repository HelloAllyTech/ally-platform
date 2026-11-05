import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: '20@ms',
    height: '20@ms',
    borderWidth: 1,
    borderColor: colors.ds.grey[600],
    borderRadius: '4@ms',
    marginRight: '10@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    borderColor: colors.ds.theme.primary,
    backgroundColor: colors.ds.theme.primary,
  },
  checkboxDisabled: {
    borderColor: colors.ds.grey[500],
    backgroundColor: colors.ds.grey[100],
  },
});
