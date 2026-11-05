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
  tabBar: {
    backgroundColor: colors.white,
  },
  tabBarTab: {
    flex: 1,
  },
  tabBarLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    textAlign: 'center',
    fontWeight: '400',
  },
  tabBarIndicator: {
    backgroundColor: colors.ds.theme.primary,
    height: 2,
  },
  listContent: {
    paddingHorizontal: '24@ms',
    paddingTop: '16@vs',
    gap: '16@vs',
  },
  listStyle: {
    flex: 1,
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
  commentItemContainer: {
    width: '100%',
  },
});
