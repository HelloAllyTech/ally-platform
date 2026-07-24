import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

export const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ds.grey[950],
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '16@ms',
  },
  centralContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '8@ms',
    marginTop: '10@mvs',
    backgroundColor: colors.darkGray3,
  },
  loadingWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: '40@ms',
  },
  loadingTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.white,
    textAlign: 'center',
    marginBottom: '4@mvs',
  },
  loadingItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  loadingDescription: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '14@ms',
    color: colors.lightGray3,
    textAlign: 'center',
  },
  scoreMeterContainer: {
    flexShrink: 0,
    width: '80%',
    marginVertical: '10@mvs',
    marginBottom: '20@mvs',
  },
  participantsContent: {
    flexShrink: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '8@mvs',
    marginBottom: '16@mvs',
    zIndex: 1,
  },
  // Only claim the full remaining height when there's nothing else (no tab
  // bar) below the agent tile to share space with — otherwise a fixed 100%
  // height here pushes the tab bar/content pane down past the fold, leaving
  // a large empty gap above them.
  participantsContentFull: {
    height: '100%',
  },
  participantsContainer: {
    flexShrink: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantsVertical: {
    flexGrow: 1,
    gap: '12@vs',
  },
  participantsHorizontal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: '280@ms',
    gap: '8@mvs',
  },
  participantWrapper: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantWrapperWithOverlay: {
    flex: 1,
    overflow: 'visible',
    zIndex: 10,
  },
  liveFeedbackWrapper: {
    marginVertical: '10@mvs',
    marginHorizontal: '14@ms',
    flexShrink: 0,
  },
  endButtonIcon: {
    width: '16@s',
    height: '16@s',
    backgroundColor: colors.coralRed,
    borderRadius: '2@ms',
  },
  stateProgressWrapper: {
    marginVertical: '10@mvs',
    width: '100%',
    flexShrink: 0,
  },
  participantsCompact: {
    height: '180@ms',
  },
  // Learner's self-view: a small inlaid picture-in-picture bubble over the AI
  // tile (like a WhatsApp video call) rather than an equal-size tile of its
  // own. participantWrapperWithOverlay is the positioning parent (RN Views
  // default to position:'relative', so no extra style needed there).
  pipWrapper: {
    position: 'absolute',
    bottom: '10@ms',
    right: '10@ms',
    width: '84@ms',
    height: '116@ms',
    borderRadius: '12@ms',
    overflow: 'hidden',
    borderWidth: '2@ms',
    borderColor: '#3D4045',
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  // Checklist/Reminders/Description live behind a tab bar under the agent
  // tile (tap to switch, no swipe) rather than the checklist being inlined
  // into the main call view.
  pagerPage: {
    flex: 1,
    width: '100%',
  },
  infoTabBar: {
    flexDirection: 'row',
    gap: '16@ms',
    marginBottom: '12@vs',
    borderBottomWidth: 1,
    borderBottomColor: '#3D4045',
  },
  infoTabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '6@ms',
    paddingVertical: '8@vs',
    paddingHorizontal: '4@ms',
  },
  infoTabLabel: {
    fontSize: '14@ms',
    fontWeight: '500',
    color: '#9CA3AF',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
  },
  infoTabLabelActive: {
    color: 'white',
  },
  infoTabIndicator: {
    position: 'absolute',
    bottom: '-1@vs',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#57f646',
    borderTopLeftRadius: '2@ms',
    borderTopRightRadius: '2@ms',
  },
});
