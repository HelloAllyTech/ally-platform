import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, stroke, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: '20@ms',
    paddingBottom: '40@vs',
  },
  titleSection: {
    marginBottom: '10@vs',
    paddingRight: '20@ms',
    paddingLeft: '10@ms',
    paddingBottom: '8@vs',
    marginTop: '8@vs',
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
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
});
