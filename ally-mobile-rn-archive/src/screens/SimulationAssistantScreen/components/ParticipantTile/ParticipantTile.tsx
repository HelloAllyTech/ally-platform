import React from 'react';
import {Participant, Track, TrackPublication} from 'livekit-client';
import {Image, Text, TouchableWithoutFeedback, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {MicOffWhiteIcon, UserIcon} from '@/assets/icons';
import {AUDIO} from '@/constants';
import {colors, fontFamily} from '@/theme';
import {TurnState} from '@/types';

import {useAudioLevel} from '../AudioWave/useAudioLevel';
import {ScenarioInfoOverlayRef} from '../ScenarioInfoOverlay';
import {SpeakingIndicator} from '../SpeakingIndicator';
import {TurnIndicator} from '../TurnIndicator';

interface ParticipantTileProps {
  participant?: Participant | null;
  publication?: TrackPublication;
  avatarUrl?: string | null;
  name?: string | null;
  topLeftOverlay?: React.ReactNode;
  overlayRef?: React.RefObject<ScenarioInfoOverlayRef> | null;
  isMicEnabled?: boolean;
  turnState?: TurnState;
  /** Small picture-in-picture self-view sizing: same name + turn-status info
   * as the full-size tile, just shrunk to fit a small bubble instead of an
   * equal-size tile of its own. */
  compact?: boolean;
}

const PLACEHOLDER_ICON_SIZE = ms(90);
const PLACEHOLDER_ICON_SIZE_COMPACT = ms(36);

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  publication,
  avatarUrl,
  name,
  topLeftOverlay,
  overlayRef,
  isMicEnabled = true,
  turnState,
  compact = false,
}) => {
  const trackRef = React.useMemo(
    () => ({
      participant: participant,
      source: Track.Source.Microphone,
      publication: publication,
    }),
    [participant, publication],
  );

  const audioLevel = useAudioLevel(trackRef);
  const isSpeaking = audioLevel > AUDIO.THRESHOLD;
  const showBorder = isSpeaking;

  const handleTilePress = () => {
    if (overlayRef?.current?.isOpen) {
      overlayRef.current.close();
    }
  };

  return (
    <TouchableWithoutFeedback onPress={handleTilePress}>
      <View
        style={[styles.container, showBorder && styles.activeContainerBorder]}>
        {avatarUrl ? (
          <Image
            source={{uri: avatarUrl}}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholderContainer}>
            <UserIcon
              width={
                compact ? PLACEHOLDER_ICON_SIZE_COMPACT : PLACEHOLDER_ICON_SIZE
              }
              height={
                compact ? PLACEHOLDER_ICON_SIZE_COMPACT : PLACEHOLDER_ICON_SIZE
              }
            />
          </View>
        )}

        {/* Top Left Overlay Slot - for scenario info, etc. */}
        {topLeftOverlay}

        {turnState && turnState !== TurnState.IDLE && (
          <View
            style={[
              styles.turnIndicatorOverlay,
              compact && styles.turnIndicatorOverlayCompact,
            ]}>
            <TurnIndicator turnState={turnState} compact={compact} />
          </View>
        )}

        {/* Active Speaker Overlay (Bottom Left) */}
        {name && (
          <View
            style={[
              styles.speakerOverlay,
              compact && styles.speakerOverlayCompact,
            ]}>
            <View style={styles.indicatorWrapper}>
              {isMicEnabled ? (
                <SpeakingIndicator isSpeaking={isSpeaking} />
              ) : (
                <MicOffWhiteIcon />
              )}
            </View>
            <Text
              style={[styles.speakerName, compact && styles.speakerNameCompact]}
              numberOfLines={1}
              ellipsizeMode="tail">
              {name}
            </Text>
          </View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    width: '100%',
    borderRadius: '12@ms',
    backgroundColor: colors.ds.whiteAlpha[50],
    borderWidth: '6@ms',
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  activeContainerBorder: {
    borderColor: colors.ds.theme.primaryLight,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: '12@ms',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  turnIndicatorOverlay: {
    position: 'absolute',
    top: '12@ms',
    right: '12@ms',
    zIndex: 2,
  },
  turnIndicatorOverlayCompact: {
    top: '6@ms',
    right: '6@ms',
  },
  speakerOverlay: {
    position: 'absolute',
    bottom: '12@ms',
    left: '12@ms',
    backgroundColor: colors.ds.blackAlpha[800],
    borderRadius: '4@ms',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '6@ms',
    paddingHorizontal: '10@ms',
    overflow: 'hidden',
    maxWidth: '85%',
  },
  speakerOverlayCompact: {
    bottom: '6@ms',
    left: '6@ms',
    paddingVertical: '3@ms',
    paddingHorizontal: '6@ms',
  },
  indicatorWrapper: {
    marginRight: '8@ms',
  },
  speakerName: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '12@ms',
    color: colors.white,
    maxWidth: '88%',
  },
  speakerNameCompact: {
    fontSize: '9@ms',
  },
});
