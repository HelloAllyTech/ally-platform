import React from 'react';
import {Participant, Track, TrackPublication} from 'livekit-client';
import {Image, Text, TouchableWithoutFeedback, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {MicOffWhiteIcon, UserIcon} from '@/assets/icons';
import {AUDIO} from '@/constants';
import {colors, fontFamily} from '@/theme';

import {useAudioLevel} from '../AudioWave/useAudioLevel';
import {ScenarioInfoOverlayRef} from '../ScenarioInfoOverlay';
import {SpeakingIndicator} from '../SpeakingIndicator';

interface ParticipantTileProps {
  participant?: Participant | null;
  publication?: TrackPublication;
  avatarUrl?: string | null;
  name?: string | null;
  topLeftOverlay?: React.ReactNode;
  overlayRef?: React.RefObject<ScenarioInfoOverlayRef> | null;
  isMicEnabled?: boolean;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  publication,
  avatarUrl,
  name,
  topLeftOverlay,
  overlayRef,
  isMicEnabled = true,
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
            <UserIcon />
          </View>
        )}

        {/* Top Left Overlay Slot - for scenario info, etc. */}
        {topLeftOverlay}

        {/* Active Speaker Overlay (Bottom Left) */}
        {name && (
          <View style={styles.speakerOverlay}>
            <View style={styles.indicatorWrapper}>
              {isMicEnabled ? (
                <SpeakingIndicator isSpeaking={isSpeaking} />
              ) : (
                <MicOffWhiteIcon />
              )}
            </View>
            <Text
              style={styles.speakerName}
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
  indicatorWrapper: {
    marginRight: '8@ms',
  },
  speakerName: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '12@ms',
    color: colors.white,
    maxWidth: '88%',
  },
});
