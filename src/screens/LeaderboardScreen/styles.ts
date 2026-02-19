import {StyleSheet} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  badgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  leaderboardHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingVertical: '10@ms',
  },
  dropdownHeader: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    paddingVertical: '6@ms',
    paddingHorizontal: '8@ms',
  },
  dropdownText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '20@ms',
    color: colors.ds.typography.highEmphasis,
  },
  badgeCount: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.medium,
    color: colors.ds.blue[500],
  },
  listContainer: {
    flex: 1,
    marginBottom: '100@ms',
  },
  tabContainer: {
    paddingHorizontal: '21@ms',
    marginBottom: '16@ms',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: '12@ms',
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray2,
    marginBottom: '8@ms',
    paddingHorizontal: '21@ms',
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.tiny,
    color: colors.ds.typography.mediumEmphasis,
  },
  listContent: {
    paddingBottom: '100@ms',
  },
  emptyListContent: {
    flexGrow: 1,
  },
  leaderboardRow: {
    paddingVertical: '10@ms',
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.ds.stroke.primary,
    marginHorizontal: '21@ms',
    marginTop: '12@ms',
  },
  highlightedRow: {
    backgroundColor: colors.ds.blue[50],
    borderWidth: '0.5@ms',
    borderColor: colors.ds.theme.primary,
    marginHorizontal: '8@ms',
    paddingLeft: '5@ms',
    borderRadius: '8@ms',
  },
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
  },
  rankColumn: {
    width: '38@ms',
    alignItems: 'flex-start',
    marginLeft: '21@ms',
  },
  highlightedRankColumn: {
    marginLeft: '9@ms',
  },
  rankColumnHeader: {
    width: '45@ms',
    alignItems: 'flex-start',
  },
  userColumnHeader: {
    flex: 1,
    minWidth: '160@ms',
  },
  durationColumnHeader: {
    width: '88@ms',
  },
  badgesColumnHeader: {
    width: '60@ms',
  },
  rankBadge: {
    width: '26@ms',
    height: '26@ms',
    borderRadius: '13@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topThreeBadge: {
    width: '30@ms',
    height: '30@ms',
    borderRadius: '15@ms',
  },
  rankText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.label.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  topThreeRankText: {
    color: colors.white,
    fontWeight: '600',
  },
  userColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    marginRight: '10@ms',
    minWidth: '160@ms',
  },
  avatarContainer: {
    width: '36@ms',
    height: '36@ms',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: '20@ms',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: '20@ms',
    backgroundColor: colors.ds.blue[50],
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: colors.ds.stroke.primary,
    borderWidth: 0.5,
  },
  avatarInitial: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    color: colors.ds.icon.default,
    fontWeight: '600',
  },
  userName: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
    fontWeight: '600',
  },
  highlightedUserName: {
    color: colors.blue,
    fontWeight: '500',
  },
  durationColumn: {
    width: '95@ms',
  },
  durationText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
  },
  badgesColumn: {
    width: '60@ms',
  },
  badgesText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.tiny,
    color: colors.ds.typography.highEmphasis,
  },
  highlightedText: {
    color: colors.blue,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '40@ms',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '40@ms',
    paddingVertical: '60@ms',
  },
  emptyStateTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.small,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
    marginBottom: '12@ms',
  },
  emptyStateDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: '20@ms',
    alignItems: 'center',
  },
  marginL21: {
    marginLeft: '21@ms',
  },
  tooltipText: {
    color: colors.ds.neutral.white,
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
  },
});
