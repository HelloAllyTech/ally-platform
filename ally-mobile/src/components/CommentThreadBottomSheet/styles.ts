import {ScaledSheet} from 'react-native-size-matters';

import {commentBottomSheetStyles} from '../shared/commentBottomSheetStyles';

const localStyles = ScaledSheet.create({
  listContent: {
    paddingHorizontal: '24@s',
    paddingTop: '12@vs',
    paddingBottom: '12@vs',
    gap: '12@vs',
  },
});

export const styles = {
  ...commentBottomSheetStyles,
  ...localStyles,
  commentItemContainer: commentBottomSheetStyles.itemContainer,
};
