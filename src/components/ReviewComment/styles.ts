import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    gap: '10@s',
    alignSelf: 'stretch',
    width: '100%',
  },
  avatarContainer: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.lightGray17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.black,
  },
  contentContainer: {
    flex: 1,
    width: '100%',
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: '6@s',
  },
  nameTimeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@s',
    minWidth: 0,
  },
  nameContainer: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.highEmphasis,
  },
  timeAgo: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '15@ms',
    color: colors.ds.typography.mediumEmphasis,
    flexShrink: 0,
  },
  commentText: {
    marginTop: '4@mvs',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '16@ms',
    color: colors.ds.typography.highEmphasis,
    alignSelf: 'stretch',
  },
  hiddenCommentText: {
    color: 'rgba(0, 0, 0, 0.38)',
  },
  footerRow: {
    marginTop: '8@mvs',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  hiddenFooterRow: {
    opacity: 0.6,
  },
  footerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  likeButton: {
    padding: 0,
  },
  likeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '16@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  reactionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  reactionEmojis: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionEmojiContainer: {
    width: '16@ms',
    height: '16@ms',
    borderRadius: '11.08@ms',
    borderWidth: 0.31,
    borderColor: colors.lightGray17,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    padding: '2.46@ms',
  },
  reactionEmojiFirst: {
    zIndex: 3,
    marginLeft: 0,
  },
  reactionEmojiSecond: {
    zIndex: 2,
    marginLeft: '-6@ms',
  },
  reactionEmojiThird: {
    zIndex: 1,
    marginLeft: '-6@ms',
  },
  reactionEmoji: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '8.62@ms',
    lineHeight: '12@ms',
    fontWeight: fontWeights.bold,
    color: colors.darkGray17,
  },
  reactionCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '21@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  separatorDot: {
    width: '3@ms',
    height: '3@ms',
    borderRadius: '1.5@ms',
    backgroundColor: colors.lightGrayD9,
  },
  repliesButton: {
    padding: 0,
    height: '18@ms',
    justifyContent: 'center',
  },
  repliesText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'right',
  },
  actionsMenuContainer: {
    marginLeft: 'auto',
  },
  hiddenContainer: {
    padding: '12@s',
    backgroundColor: colors.lightGray,
    borderRadius: '8@s',
    marginVertical: '4@s',
  },
  hiddenText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '16@ms',
    color: colors.ds.typography.mediumEmphasis,
    fontStyle: 'italic',
  },
  hiddenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@s',
    backgroundColor: colors.lightGray,
    paddingHorizontal: '4@s',
    paddingVertical: '2@s',
    borderRadius: '100@s',
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  hiddenBadgeText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    lineHeight: '14@ms',
    color: colors.black,
    opacity: 0.8,
  },
});
