import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '24@s',
    paddingTop: '8@vs',
    paddingBottom: '8@mvs',
    gap: '11@s',
  },
  backButton: {
    padding: '8@s',
    marginLeft: '-8@s',
  },
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '18@ms',
    lineHeight: '32@ms',
    color: colors.ds.typography.highEmphasis,
    flex: 1,
    textAlign: 'center',
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
  listStyle: {
    flex: 1,
  },
  replyItemContainer: {
    width: '100%',
  },
  footer: {
    paddingVertical: '20@vs',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '40@vs',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  addReplyContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: '24@s',
    paddingTop: '16@vs',
    backgroundColor: colors.white,
  },
  addReplyInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@s',
  },
  addReplyInput: {
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
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
});
