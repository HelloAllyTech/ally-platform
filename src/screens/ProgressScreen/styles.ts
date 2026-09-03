import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {flex: 1, backgroundColor: colors.ds.neutral.white},
  scrollView: {flex: 1},
  content: {paddingHorizontal: '24@ms', paddingVertical: '16@ms'},

  hero: {
    borderRadius: '12@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    padding: '20@ms',
    marginBottom: '16@ms',
  },
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: '14@ms'},
  heroTextGroup: {flex: 1},
  heroLevel: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
  },
  heroCaption: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '4@ms',
  },
  progressTrack: {
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.grey[100],
    marginTop: '16@ms',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '4@ms',
    backgroundColor: colors.blue,
  },
  heroTotal: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '8@ms',
  },

  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: '12@ms'},
  statCard: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: '12@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
  },
  statValue: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
  },
  statLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.lowEmphasis,
    marginTop: '6@ms',
  },

  linkCard: {
    marginTop: '16@ms',
    borderRadius: '12@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
  },
  linkText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
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
});
