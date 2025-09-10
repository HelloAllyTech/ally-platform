import React, {useEffect, useMemo, useRef} from 'react';
import {useRemoteParticipants} from '@livekit/react-native';
import {Track} from 'livekit-client';
import {Animated, Image, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {ScaledSheet} from 'react-native-size-matters';

import {AUDIO, CIRCLE, CIRCLE_CONFIGS} from '@/constants';
import type {CircleProps, CircleWaveVisualizerProps} from '@/types';

import {useAudioLevel} from './useAudioLevel';

type AudioWaveProps = {
  avatarUrl?: string | null;
};

const Circle: React.FC<CircleProps> = ({circleNumber, config, audioLevel}) => {
  const isActive = audioLevel > AUDIO.THRESHOLD;
  const scale =
    config.scale *
    (config.isStatic ? 1 : CIRCLE.MIN_SCALE + (audioLevel * circleNumber) / 3);
  const intensity = 1 / config.scale;

  const animatedScale = useRef(new Animated.Value(scale)).current;

  useEffect(() => {
    Animated.timing(animatedScale, {
      toValue: scale,
      duration: CIRCLE.TRANSITION_MS,
      useNativeDriver: true,
    }).start();
  }, [scale, animatedScale]);

  const animatedStyle = useMemo(
    () => ({
      width: CIRCLE.BASE_SIZE,
      height: CIRCLE.BASE_SIZE,
      transform: [{scale: animatedScale}],
      opacity: config.isStatic ? 1 : isActive ? 1 : 0,
    }),
    [config.isStatic, isActive, animatedScale],
  );

  return (
    <Animated.View style={[styles.circle, animatedStyle]}>
      <LinearGradient
        colors={[
          `rgba(${CIRCLE.GRADIENT.START_COLOR}, ${intensity})`,
          `rgba(${CIRCLE.GRADIENT.END_COLOR}, ${intensity})`,
        ]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
        style={styles.gradient}
      />
      {config.isStatic && isActive && (
        <View
          style={[
            styles.border,
            {
              borderWidth: CIRCLE.BORDER.WIDTH,
              borderColor: CIRCLE.BORDER.COLOR,
            },
          ]}
        />
      )}
    </Animated.View>
  );
};

const CircleWaveVisualizer: React.FC<CircleWaveVisualizerProps> = ({
  trackRef,
}) => {
  const audioLevel = useAudioLevel(trackRef);

  return (
    <View style={styles.visualizerContainer}>
      {CIRCLE_CONFIGS.map((config, index) => (
        <Circle
          key={index}
          circleNumber={index}
          config={config}
          audioLevel={audioLevel}
        />
      ))}
    </View>
  );
};

export const AudioWave: React.FC<AudioWaveProps> = ({avatarUrl}) => {
  const remoteParticipants = useRemoteParticipants();
  const remoteParticipant =
    remoteParticipants.length > 0 ? remoteParticipants[0] : null;
  const audioPublication = remoteParticipant
    ?.getTrackPublications()
    .find(pub => pub.kind === Track.Kind.Audio);

  return (
    <View style={styles.audioWaveContainer}>
      <CircleWaveVisualizer
        trackRef={{
          participant: remoteParticipant,
          source: Track.Source.Microphone,
          publication: audioPublication,
        }}
      />
      {!!avatarUrl && (
        <View pointerEvents="none" style={styles.avatarWrapper}>
          <View style={styles.avatarContainer}>
            <Image
              source={{uri: avatarUrl}}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          </View>
        </View>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  audioWaveContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualizerContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circle: {
    position: 'absolute',
    borderRadius: CIRCLE.BASE_SIZE / 2,
    overflow: 'hidden',
  },
  gradient: {
    width: '100%',
    height: '100%',
  },
  border: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CIRCLE.BASE_SIZE / 2,
  },
  avatarWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainer: {
    height: '100@ms',
    width: '100@ms',
    borderRadius: '50@ms',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: '50@ms',
    alignSelf: 'center',
  },
});
