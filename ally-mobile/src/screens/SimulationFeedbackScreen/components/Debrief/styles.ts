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
  listContent: {
    gap: '20@vs',
    paddingHorizontal: '16@ms',
    paddingTop: '16@vs',
    paddingBottom: '24@vs',
  },

  // ── Note ──────────────────────────────────────────────────────────
  noteRow: {
    flexDirection: 'row',
    gap: '10@ms',
  },
  noteAvatar: {
    width: '32@ms',
    height: '32@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: '2@vs',
  },
  noteAvatarGradient: {
    width: '32@ms',
    height: '32@ms',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '600@ms',
    borderColor: '#BFD4F6',
    borderWidth: 0.6,
  },
  noteBody: {
    flex: 1,
    gap: '10@vs',
  },
  noteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  noteFromLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
  },
  aiBadge: {
    borderRadius: '99@ms',
    paddingHorizontal: '8@ms',
    paddingVertical: '2@vs',
    backgroundColor: colors.ds.blue[50],
  },
  aiBadgeText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '10@ms',
    letterSpacing: '0.3@ms',
    textTransform: 'uppercase',
    color: colors.ds.blue[500],
  },
  tooltipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.white,
    lineHeight: '16@vs',
  },
  noteParagraph: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '19@vs',
    color: colors.ds.typography.highEmphasis,
  },
  momentChip: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '11@ms',
    color: colors.ds.blue[500],
    backgroundColor: colors.ds.blue[50],
    borderRadius: '99@ms',
    overflow: 'hidden',
  },
  boldText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
  },
  // Sections sit further apart than the paragraphs inside them, which is what
  // makes the structure readable without drawing rules across the note.
  noteSections: {
    gap: '16@vs',
  },
  noteSection: {
    gap: '4@vs',
  },
  noteSectionParagraphs: {
    gap: '10@vs',
  },
  // The heading is a signpost, not a title: set quieter than the prose it
  // introduces, so a scanning learner finds the part they want without the note
  // starting to read like a report.
  noteSectionHeading: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '11@ms',
    letterSpacing: '0.3@ms',
    textTransform: 'uppercase',
    color: colors.ds.typography.mediumEmphasis,
  },

  // ── Skeleton ──────────────────────────────────────────────────────
  skeletonRow: {
    flexDirection: 'row',
    gap: '10@ms',
  },
  skeletonAvatar: {
    width: '32@ms',
    height: '32@ms',
    borderRadius: '16@ms',
    backgroundColor: colors.lightGray2,
  },
  skeletonLines: {
    flex: 1,
    gap: '8@vs',
    paddingTop: '4@vs',
  },
  skeletonLine: {
    height: '10@vs',
    borderRadius: '6@ms',
    backgroundColor: colors.lightGray2,
  },
  skeletonLineShort: {
    width: '40%',
  },
  skeletonLineMedium: {
    width: '70%',
  },
  skeletonLineWide: {
    width: '90%',
  },
  generatingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '10@vs',
  },
  generatingHint: {
    color: colors.ds.typography.lowEmphasis,
  },
  failedText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
  },
  replyPromptText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '16@vs',
  },

  // ── Reply bubbles ─────────────────────────────────────────────────
  learnerBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.ds.blue[50],
    borderRadius: '20@ms',
    paddingHorizontal: '14@ms',
    paddingVertical: '10@vs',
  },
  learnerBubbleText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
  },
  allyReplyRow: {
    flexDirection: 'row',
    gap: '8@ms',
    maxWidth: '90%',
  },
  allyReplyText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '17@vs',
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },

  // ── Error / Retry ─────────────────────────────────────────────────
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ds.red[50],
    paddingHorizontal: '12@ms',
    paddingVertical: '8@vs',
    borderRadius: '8@ms',
    gap: '8@ms',
    marginTop: '8@vs',
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

  // ── Reply input ───────────────────────────────────────────────────
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
});
