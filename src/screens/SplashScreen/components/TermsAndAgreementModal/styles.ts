import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: '20@ms',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
  },
  contentContainer: {
    backgroundColor: colors.white,
    borderRadius: '16@ms',
    padding: '20@ms',
    maxHeight: '80%',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.headline.small,
    textAlign: 'center',
    color: colors.ds.typography.highEmphasis,
  },
  scrollView: {
    marginBottom: '10@ms',
  },
  termItem: {
    marginTop: '16@ms',
  },
  termHeading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: '600',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '4@ms',
  },
  termDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '8@ms',
    fontStyle: 'italic',
  },
  bulletContainer: {
    flexDirection: 'row',
    marginTop: '8@ms',
    marginLeft: '8@ms',
  },
  bulletPoint: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginRight: '8@ms',
  },
  termContent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    flex: 1,
  },
  boldText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: '700',
    color: colors.ds.typography.mediumEmphasis,
  },
  completeDetailsContainer: {
    marginTop: '24@ms',
    marginBottom: '8@ms',
  },
  completeDetailsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  linkText: {
    color: colors.ds.theme.primary,
    textDecorationLine: 'underline',
  },
  footer: {
    paddingTop: '10@ms',
  },
  separator: {
    height: 1,
    backgroundColor: colors.lightGray,
    marginBottom: '20@ms',
  },
  scrollToBottomButton: {
    alignSelf: 'center',
    paddingVertical: '10@ms',
  },
  scrollToBottomText: {
    ...typography.body.medium,
    color: colors.darkSlate,
    textDecorationLine: 'underline',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '20@ms',
  },
  checkboxLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    flex: 1,
  },
  agreeButton: {
    width: '100%',
  },
});
