import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    marginHorizontal: '10@ms',
    marginVertical: '10@vs',
    borderRadius: '16@ms',
    overflow: 'hidden',
  },
  gradientContainer: {
    flex: 1,
    borderRadius: '16@ms',
    overflow: 'hidden',
  },
  header: {
    paddingTop: '8@vs',
    paddingLeft: '16@ms',
    paddingRight: '16@ms',
    marginBottom: '8@vs',
  },
  headerText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.ds.neutral.white,
    letterSpacing: '0.25@ms',
    lineHeight: '20@vs',
  },
  scrollContent: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    marginHorizontal: '4@ms',
    marginBottom: '4@vs',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    padding: '16@ms',
    gap: '24@vs',
    backgroundColor: colors.white,
    borderRadius: '12@ms',
  },
  questionBubble: {
    backgroundColor: colors.ds.blue[50],
    paddingHorizontal: '12@ms',
    paddingVertical: '8@vs',
    borderRadius: '100@ms',
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  questionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.4@ms',
    lineHeight: '16@vs',
  },
  responseContainer: {
    flexDirection: 'row',
    gap: '8@ms',
    flex: 1,
  },
  rankBadgeContainer: {
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankBadgeGradient: {
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '600@ms',
    borderColor: '#BFD4F6',
    borderWidth: 0.6,
  },
  responseTextContainer: {
    flex: 1,
  },
  responseText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
    lineHeight: '16.9@vs',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lightGray2,
    borderRadius: '99@ms',
    paddingLeft: '16@ms',
    paddingRight: '4@ms',
    paddingVertical: '4@vs',
    gap: '10@ms',
  },
  input: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12.25@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: -0.0179,
    padding: 0,
  },
  sendButton: {
    width: '35@ms',
    height: '35@ms',
    borderRadius: '99@ms',
    backgroundColor: '#d1d5dc',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
