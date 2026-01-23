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
    position: 'relative',
  },
  backButton: {
    padding: '8@s',
    marginLeft: '-8@s',
    zIndex: 1,
  },
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '18@ms',
    lineHeight: '32@ms',
    color: colors.ds.typography.highEmphasis,
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  headerSpacer: {
    width: '28@s', // Approximate width of back button (12 + 8*2 padding)
    zIndex: 1,
  },
  listContent: {
    paddingHorizontal: '24@s',
    paddingTop: '12@vs',
    paddingBottom: '12@vs',
    gap: '12@vs',
  },
  listStyle: {
    flex: 1,
  },
  commentItemContainer: {
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
  addCommentContainer: {
    paddingHorizontal: '24@s',
    paddingTop: '16@vs',
    paddingBottom: 0,
    backgroundColor: colors.white,
  },
  addCommentInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@s',
  },
  addCommentInput: {
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
  sendButtonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  arrowIcon: {
    transform: [{rotate: '180deg'}],
  },
});
