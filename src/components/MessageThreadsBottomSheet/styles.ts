import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingHorizontal: '24@s',
    alignItems: 'center',
    paddingBottom: '8@mvs',
  },
  headerTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '18@ms',
    lineHeight: '32@ms',
    color: colors.darkGray2,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: '48@vs',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.lowEmphasis,
    textAlign: 'center',
  },
  loadingContainer: {
    paddingVertical: '32@vs',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentItemContainer: {
    marginBottom: '12@vs',
  },
  footerLoader: {
    paddingVertical: '16@vs',
    alignItems: 'center',
  },
  contentContainer: {
    paddingHorizontal: '16@s',
    paddingBottom: '24@vs',
  },
  threadContainer: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.lightGray17,
    borderRadius: '8@ms',
    paddingVertical: '8@mvs',
    paddingHorizontal: '16@s',
    gap: '10@vs',
  },
  selectedTextContainer: {
    paddingBottom: '8@vs',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray17,
  },
  selectedText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: 0.25,
    maxLines: 1,
    textOverflow: 'ellipsis',
  },
  commentWrapper: {
    position: 'relative',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '83@ms',
    pointerEvents: 'none',
  },
  separatorLine: {
    height: 0.5,
    backgroundColor: colors.lightGray17,
    width: '100%',
  },
  moreCommentsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '5@s',
    paddingBottom: '2@mvs',
  },
  moreCommentsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: '24@ms',
    paddingTop: '16@vs',
    paddingBottom: '32@vs',
    gap: '16@vs',
  },
  listStyle: {
    flex: 1,
  },
});
