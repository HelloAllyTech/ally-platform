import {ms, ScaledSheet} from 'react-native-size-matters';

import {WINDOW_HEIGHT} from '@/constants/general';
import {colors, fontFamily, radius, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  tabsContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  tabBar: {
    backgroundColor: colors.white,
  },
  tabBarIndicator: {
    backgroundColor: colors.ds.theme.primary,
    height: 2,
  },
  tabBarTab: {
    flex: 1,
    paddingHorizontal: 10,
  },
  tabBarLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    textAlign: 'center',
    fontWeight: '400',
  },
  lazyPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  summaryTabContainer: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.white,
    marginTop: 0,
    overflow: 'hidden',
    minHeight: WINDOW_HEIGHT * 0.8,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  contentContainer: {
    flex: 1,
  },
  paddingTop: {
    paddingTop: '80@ms',
  },
  height100: {
    height: '100%',
  },
  summaryButtonsContainer: {
    position: 'absolute',
    paddingBottom: '46@ms',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: '24@ms',
    flexDirection: 'column',
    gap: '10@ms',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    paddingTop: '10@ms',
    backgroundColor: colors.white,
  },
  viewSummaryButton: {
    backgroundColor: colors.azureBlue,
    paddingVertical: '10@ms',
    marginBottom: '4@ms',
  },
  viewSummaryButtonText: {
    color: colors.white,
    ...fontFamily.ROBOTO.REGULAR,
    fontWeight: '600',
    fontSize: '16@ms',
  },
  seeIfReadyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    backgroundColor: colors.white,
    borderColor: colors.lightGray4,
    borderWidth: 1,
    paddingVertical: '14@ms',
    width: '100%',
    borderRadius: '24@ms',
    justifyContent: 'center',
  },
  viewCallLogsButton: {
    backgroundColor: colors.white,
    paddingVertical: '2@ms',
    marginBottom: '4@ms',
  },
  viewCallLogsButtonBorder: {
    borderColor: colors.lightGray4,
    borderWidth: 1,
    paddingVertical: '10@ms',
  },
  marginB8: {
    marginBottom: '8@ms',
  },
  viewCallLogsButtonText: {
    color: colors.darkGray10,
    ...fontFamily.ROBOTO.REGULAR,
    fontWeight: '600',
    fontSize: '16@ms',
  },
  infoPopupContainer: {
    position: 'absolute',
    top: '50%',
    left: '30@ms',
    right: '30@ms',
    borderRadius: '10@ms',
    padding: '10@ms',
    backgroundColor: colors.black,
  },
  infoPopupText: {
    color: colors.white,
    fontSize: '14@ms',
    lineHeight: '20@ms',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
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
});
