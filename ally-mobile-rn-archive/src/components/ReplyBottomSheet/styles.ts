import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme';

import {commentBottomSheetStyles} from '../shared/commentBottomSheetStyles';

const localStyles = ScaledSheet.create({
  contentWrapper: {
    flex: 1,
    backgroundColor: colors.white,
  },
  listWrapper: {
    flex: 1,
  },
  originalCommentContainer: {
    paddingHorizontal: '24@s',
    paddingTop: '12@vs',
    paddingBottom: '12@vs',
  },
  listContent: {
    paddingLeft: '54@s',
    paddingRight: '24@s',
    paddingTop: '12@vs',
    paddingBottom: '12@vs',
    gap: '12@vs',
  },
});

export const styles = {
  ...commentBottomSheetStyles,
  ...localStyles,
  replyItemContainer: commentBottomSheetStyles.itemContainer,
};
