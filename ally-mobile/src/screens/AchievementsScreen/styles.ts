import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.neutral.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    marginRight: '16@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
    fontWeight: '400',
  },
  filterContainer: {
    marginHorizontal: '24@ms',
    marginTop: '16@ms',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgesLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
  },
  tabViewWrapper: {
    width: '65%',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: '24@ms',
    paddingVertical: '16@ms',
  },
  section: {
    marginBottom: '24@ms',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '12@ms',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.lowEmphasis,
    marginRight: '8@ms',
    alignItems: 'center',
  },
  tooltipIcon: {
    marginRight: '12@ms',
  },
  sectionLine: {
    flex: 1,
    height: '0.5@ms',
    backgroundColor: colors.ds.stroke.primary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
    paddingVertical: '48@ms',
  },
  emptyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: '48@ms',
  },
  errorText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.feedback.error,
    textAlign: 'center',
  },
  tooltipText: {
    color: colors.ds.neutral.white,
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
  },
  badgesLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
});
