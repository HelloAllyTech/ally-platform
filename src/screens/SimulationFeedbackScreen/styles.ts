import {ScaledSheet} from 'react-native-size-matters';

import {isIOS} from '@/constants';
import {colors, fontFamily, typography} from '@/theme';

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
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '10@vs',
    paddingRight: '20@ms',
    paddingLeft: '10@ms',
    paddingBottom: '8@vs',
    marginTop: '8@vs',
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  backButton: {
    paddingRight: '1@ms',
  },
  title: {
    ...typography.headline.large,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray2,
    fontSize: '18@ms',
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
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: '5@vs',
  },
  headerText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '12@ms',
    color: colors.lightGray12,
    letterSpacing: '4@ms',
    fontWeight: '700',
  },
  headerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.lightGray4,
    marginLeft: '10@ms',
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
    backgroundColor: colors.whiteTransparent10,
    borderWidth: 1,
    borderColor: colors.lightGray4,
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
