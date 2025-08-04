import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkGray7,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.darkGray7,
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    marginTop: '10@vs',
  },
  controlButtonsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusModeLayout: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: '40@vs',
  },
  takingNotesText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    textAlign: 'left',
  },
  nonFocusLabelBlock: {
    alignItems: 'flex-start',
    flex: 1,
    marginLeft: '10@s',
  },
  focusModeWaveformWrapper: {
    marginVertical: '40@vs',
    width: '96%',
  },
  nonFocusModeWaveformWrapper: {
    width: '50%',
  },
  nonFocusModeLayout: {
    flex: 1,
    alignItems: 'flex-start',
    paddingHorizontal: '20@s',
    marginTop: '40@vs',
  },
  micInDifferentPlatformContainer: {
    flex: 1,
    backgroundColor: colors.darkGray7,
    justifyContent: 'center',
    paddingHorizontal: '30@s',
    textAlign: 'center',
  },
  micInDifferentPlatformTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '18@ms',
    color: colors.white,
    textAlign: 'center',
  },
  micInDifferentPlatformDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.white,
    textAlign: 'center',
    marginTop: '10@vs',
  },
  micInDifferentPlatformGoBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: '32@s',
    paddingVertical: '5@vs',
    paddingLeft: '10@s',
    paddingRight: '17@s',
    marginTop: '40@vs',
  },
  micInDifferentPlatformGoBackText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
    fontSize: '16@ms',
  },
});
