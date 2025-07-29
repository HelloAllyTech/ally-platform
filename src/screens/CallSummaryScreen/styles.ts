import {ScaledSheet} from 'react-native-size-matters';

import {WINDOW_HEIGHT} from '@/constants/general';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  scrollView: {
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
  scrollToBottomButton: {
    position: 'absolute',
    bottom: '60@vs',
    left: '50%',
    // To take into account the width of the arrow button
    marginLeft: '-20@s',
    width: '40@s',
    height: '40@s',
    borderRadius: '20@s',
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  contentContainer: {
    flex: 1,
  },
  paddingTop: {
    paddingTop: '80@ms',
  },
  downArrow: {
    transform: [{rotate: '270deg'}],
  },
  height100: {
    height: '100%',
  },
  summaryButtonsContainer: {
    position: 'absolute',
    bottom: '30@ms',
    left: 0,
    right: 0,
    paddingHorizontal: '24@ms',
    paddingBottom: '16@ms',
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
  viewCallLogsButton: {
    backgroundColor: colors.white,
    paddingVertical: '7@ms',
    borderWidth: 1,
    borderColor: colors.lightGray4,
    marginBottom: '4@ms',
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
});
