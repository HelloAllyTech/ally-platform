import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Animated, Easing, StyleProp, Text, View, ViewStyle} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily} from '@/theme';

type StyleOverrides = {
  container?: StyleProp<ViewStyle>;
  bar?: StyleProp<ViewStyle>;
  pointer?: StyleProp<ViewStyle>;
  segment?: StyleProp<ViewStyle>;
};

type SessionScoreMeterProps = {
  /** Continuous score in the range -100 (min) to +100 (max). */
  score: number;
  segments?: number;
  /** Animate pointer when score changes. Default true. */
  animate?: boolean;
  /** Optional style overrides. */
  styleOverrides?: StyleOverrides;
};

const COLORS_LIST = [
  colors.tomatoRed,
  colors.salmonRed,
  colors.platinumGray,
  colors.sageGreen,
  colors.jadeGreen,
];

export const SessionScoreMeter: React.FC<SessionScoreMeterProps> = ({
  score,
  segments = 5,
  animate = true,
  styleOverrides,
}) => {
  const [barWidth, setBarWidth] = useState(0);
  const pointerX = useRef(new Animated.Value(0)).current;
  const {t} = useTranslation();

  const pointerRadius = ms(9);
  const minScore = -100;
  const maxScore = 100;
  const clamp = (val: number, min: number, max: number) =>
    Math.min(Math.max(val, min), max);
  const clampedScore = useMemo(
    () => clamp(Math.round(score), minScore, maxScore),
    [score, minScore, maxScore],
  );
  const palette = useMemo(() => COLORS_LIST.slice(0, segments), [segments]);

  // Determine color based on where the score falls across the segments
  const normalized = useMemo(
    () => (clampedScore - minScore) / (maxScore - minScore),
    [clampedScore, minScore, maxScore],
  );
  const colorIndex = useMemo(
    () => clamp(Math.round(normalized * (segments - 1)), 0, segments - 1),
    [normalized, segments],
  );
  const activeColor = useMemo(
    () => palette[colorIndex] ?? palette[palette.length - 1],
    [palette, colorIndex],
  );

  useEffect(() => {
    if (barWidth <= 0) return;
    // Map -100..100 to absolute bar edges (extremes)
    const leftEdgeX = -pointerRadius;
    const rightEdgeX = barWidth - pointerRadius;
    const toValue = leftEdgeX + normalized * (rightEdgeX - leftEdgeX);
    if (animate) {
      // Prevent stacking animations if score updates rapidly
      pointerX.stopAnimation();
      Animated.timing(pointerX, {
        toValue,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      pointerX.setValue(toValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barWidth, normalized, animate, pointerX]);

  return (
    <View
      style={[styles.container, styleOverrides?.container]}
      accessibilityElementsHidden>
      <Text style={styles.label}>{t('simulationPage.simulationScore')}</Text>

      <View
        style={[styles.bar, styleOverrides?.bar]}
        onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
        {Array.from({length: segments}).map((_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              {backgroundColor: palette[i] || colors.white},
              styleOverrides?.segment,
              i === 0 ? styles.segmentLeftEdge : undefined,
              i === segments - 1 ? styles.segmentRightEdge : undefined,
            ]}
          />
        ))}

        {/* Pointer (outer circle adopts active color; inner dot stays white) */}
        <Animated.View
          style={[
            styles.pointer,
            styleOverrides?.pointer,
            {
              backgroundColor: activeColor,
              transform: [{translateX: pointerX}],
            },
          ]}>
          <View style={styles.pointerInnerDot} />
        </Animated.View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    width: '100%',
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    textAlign: 'center',
    color: colors.lightGray12,
    fontSize: '12@s',
    marginBottom: '14@vs',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    height: '3@vs',
  },
  segment: {
    flexGrow: 1,
    height: '100%',
    borderRadius: '999@ms',
    marginHorizontal: '1.5@ms',
  },
  segmentLeftEdge: {
    marginLeft: 0,
  },
  segmentRightEdge: {
    marginRight: 0,
  },
  pointer: {
    position: 'absolute',
    width: '16@ms',
    height: '16@ms',
    borderRadius: '9@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pointerInnerDot: {
    width: '8@ms',
    height: '8@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.white,
  },
});
