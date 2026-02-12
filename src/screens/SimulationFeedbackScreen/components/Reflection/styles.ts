import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    marginVertical: '10@vs',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.white,
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginHorizontal: '10@ms',
  },
  titleContainer: {
    width: '100%',
    marginBottom: '16@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
    lineHeight: '20@vs',
  },
  divider: {
    height: '0.5@ms',
    backgroundColor: colors.ds.stroke.primary,
    width: '100%',
    marginBottom: '16@vs',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: '16@vs',
  },
  promptContainerWrapper: {
    marginBottom: '16@vs',
  },
  promptContainer: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    borderRadius: '4@ms',
    overflow: 'hidden',
  },
  promptContainerFocused: {
    borderColor: colors.ds.blue[400],
  },
  promptText: {
    paddingHorizontal: '16@ms',
    paddingVertical: '12@vs',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    paddingBottom: '12@vs',
    lineHeight: '20@vs',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.surface.background,
  },
  promptTextFocused: {
    borderBottomColor: colors.ds.blue[400],
    backgroundColor: 'rgba(226, 242, 255, 0.5)',
  },
  textInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    padding: '12@ms',
    minHeight: '100@vs',
    textAlignVertical: 'top',
  },
  textInputFocused: {
    borderColor: colors.ds.blue[400],
  },
  buttonContainer: {
    marginTop: '8@vs',
    flexDirection: 'row',
    gap: '12@ms',
  },
  clearButton: {
    flex: 1,
    paddingVertical: '12@vs',
    paddingHorizontal: '16@ms',
    borderRadius: '8@ms',
    borderWidth: '1@ms',
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
  },
  saveButton: {
    flex: 1,
    paddingVertical: '12@vs',
    paddingHorizontal: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.ds.theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.white,
    letterSpacing: '0.25@ms',
  },
});
