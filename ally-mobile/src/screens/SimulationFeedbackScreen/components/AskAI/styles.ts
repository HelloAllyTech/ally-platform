import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typographyColors} from '@/theme';

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
    flexGrow: 1,
  },
  contentContainer: {
    flex: 1,
    marginHorizontal: '4@ms',
    marginBottom: '4@vs',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: '12@ms',
  },
  messageList: {
    flex: 1,
    paddingHorizontal: '16@ms',
    paddingTop: '16@vs',
  },
  messageListContent: {
    gap: '16@vs',
    paddingBottom: '24@vs',
  },
  emptyListContent: {
    flex: 1,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '32@ms',
  },
  emptyStateText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.lowEmphasis,
    textAlign: 'center',
    lineHeight: '18@vs',
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
  streamingIndicator: {
    flexDirection: 'row',
    gap: '8@ms',
    paddingTop: '4@vs',
    alignItems: 'center',
  },
  typingDot: {
    width: '4@ms',
    height: '4@ms',
    borderRadius: '2@ms',
    backgroundColor: colors.ds.typography.lowEmphasis,
  },
  maxMessagesText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.lowEmphasis,
    textAlign: 'center',
    paddingVertical: '8@vs',
  },
  inputWrapper: {
    paddingHorizontal: '16@ms',
    paddingTop: '8@vs',
    paddingBottom: '16@vs',
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
  inputContainerDisabled: {
    opacity: 0.5,
  },
  inputContainerError: {
    borderColor: colors.ds.red[500],
  },
  charLimitText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.red[500],
    textAlign: 'left',
    marginTop: '4@vs',
    marginLeft: '18@ms',
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
  sendButtonActive: {
    backgroundColor: colors.ds.blue[500],
  },

  // ── Error / Retry ─────────────────────────────────────────────
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ds.red[50],
    marginHorizontal: '16@ms',
    paddingHorizontal: '12@ms',
    paddingVertical: '8@vs',
    borderRadius: '8@ms',
    gap: '8@ms',
    marginBottom: '4@vs',
  },
  errorText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.red[500],
    flex: 1,
    lineHeight: '16@vs',
  },
  retryButton: {
    paddingHorizontal: '12@ms',
    paddingVertical: '6@vs',
    borderRadius: '99@ms',
    backgroundColor: colors.ds.blue[500],
  },
  retryButtonText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '12@ms',
    color: colors.white,
  },

  // ── Citations Table ─────────────────────────────────────────
  citationsContainer: {
    marginTop: '10@vs',
    borderWidth: 1,
    borderColor: colors.ds.blue[500],
    borderRadius: '8@ms',
    overflow: 'hidden',
  },
  citationsHeader: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.highEmphasis,
    paddingHorizontal: '10@ms',
    paddingVertical: '10@vs',
    backgroundColor: colors.ds.blueAlpha[50],
  },
  citationRow: {
    flexDirection: 'row',
    paddingHorizontal: '10@ms',
    paddingVertical: '8@vs',
    gap: '8@ms',
  },
  citationTimestamp: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '11@ms',
    color: typographyColors.mediumEmphasis,
    lineHeight: '15@vs',
    minWidth: '36@ms',
  },
  citationContent: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '11@ms',
    color: colors.ds.typography.highEmphasis,
    lineHeight: '15@vs',
    flex: 1,
  },
  citationSpeaker: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '11@ms',
    color: colors.ds.typography.highEmphasis,
  },

  // ── Loading ───────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thinkingLottie: {
    width: '24@ms',
    height: '24@ms',
  },
});
