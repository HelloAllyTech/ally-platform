import {ms, ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, radius, stroke, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  tabsContainer: {
    flex: 1,
  },
  tabViewWrapper: {
    overflow: 'hidden',
  },
  tabBarIndicator: {
    backgroundColor: colors.ds.theme.primary,
    height: 2,
  },
  tabBar: {
    backgroundColor: colors.white,
  },
  tabBarLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    textAlign: 'center',
    fontWeight: '400',
  },
  tabBarTab: {
    width: 'auto' as const,
    paddingHorizontal: 10,
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
    alignItems: 'flex-start',
  },
  backArrowButton: {
    paddingRight: '1@ms',
    paddingTop: '3@vs',
  },
  title: {
    ...typography.headline.tiny,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.ds.typography.highEmphasis,
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
  privacyToggleContainer: {
    position: 'absolute',
    bottom: '20@vs',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  reviewIconButton: {
    position: 'absolute',
    width: '56@ms',
    height: '56@ms',
    right: '20@ms',
    bottom: '20@vs',
    backgroundColor: colors.ds.neutral.white,
    padding: '10@ms',
    borderWidth: 0.5,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#A09E9E',
    shadowOffset: {width: ms(8.52), height: ms(11.36)},
    shadowOpacity: 0.1,
    shadowRadius: ms(14.2),
    elevation: 8,
  },
  checklistContainer: {
    flex: 1,
    padding: '10@ms',
  },
  eventChecklistContainer: {
    marginHorizontal: '10@ms',
    marginBottom: '8@vs',
  },
  lazyPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    flexDirection: 'column',
    gap: '4@vs',
  },
  titleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    ...typography.body.small,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.ds.typography.lowEmphasis,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  tryAnotherSimulationButton: {
    position: 'absolute',
    bottom: '20@vs',
    width: '90%',
    alignSelf: 'center',
    paddingVertical: '8@vs',
  },
});
