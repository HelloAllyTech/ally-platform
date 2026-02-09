import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, stroke, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  tabsContainer: {
    marginHorizontal: '20@ms',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: '10@ms',
    paddingBottom: '40@vs',
  },
  titleSection: {
    marginBottom: '8@vs',
    paddingRight: '20@ms',
    paddingLeft: '10@ms',
    marginTop: '8@vs',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backArrowButton: {
    paddingRight: '1@ms',
  },
  title: {
    ...typography.headline.tiny,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
  },
  subTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  arrowDownContainer: {
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: '6@ms',
  },
  buttonContainer: {
    marginTop: 'auto',
  },
  submitButton: {
    marginTop: '10@vs',
    paddingVertical: '8@vs',
  },
  pathNavigationContainer: {
    flexDirection: 'row',
    gap: '12@ms',
    marginTop: '20@vs',
  },
  retryButton: {
    flex: 1,
  },
  nextButton: {
    flex: 1,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: '60@vs',
    right: '16@ms',
    zIndex: 1000,
    borderRadius: '50%',
    backgroundColor: colors.ds.whiteAlpha[500],
    borderWidth: 1,
    borderColor: stroke.primary,
    justifyContent: 'center',
    alignItems: 'center',
    width: '30@ms',
    height: '30@ms',
    paddingTop: '3@ms',
  },
  titleExtraPadding: {
    paddingLeft: '10@vs',
  },
  backButton: {
    flex: 1,
    paddingVertical: '8@vs',
    borderRadius: '100@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    color: colors.ds.typography.highEmphasis,
  },
  transitionMessageContainer: {
    marginBottom: '16@vs',
  },
  transitionMessageTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '8@vs',
  },
  transitionMessageContent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  privacyToggleContainer: {
    position: 'absolute',
    bottom: '20@vs',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  reviewIconButton: {
    marginLeft: 'auto',
  },
});
