import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {AddReactionIcon} from '@/assets/icons';
import {colors} from '@/theme';

import {EmojiPickerProps} from './types';
import {EMOJI_UNICODE_MAP, PLATFORM_EMOJIS} from './utils';

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  selectedEmoji,
  onEmojiSelect,
  containerOffsetX = 0,
  icon,
  emojiSize = ms(20),
  testID,
  disabled = false,
  error = '',
}) => {
  const [visible, setVisible] = useState(false);
  const [currentEmoji, setCurrentEmoji] = useState<string | null>(
    selectedEmoji || null,
  );
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setCurrentEmoji(selectedEmoji || null);
  }, [selectedEmoji]);

  useEffect(() => {
    if (disabled && visible) {
      setVisible(false);
    }
  }, [disabled, visible]);

  useEffect(() => {
    const animation = Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, fadeAnim]);

  const togglePicker = () => {
    setVisible(!visible);
  };

  const handleEmojiPress = (unicode: string) => {
    onEmojiSelect(currentEmoji, unicode);
    if (error) {
      return;
    }
    const isSelected = currentEmoji === unicode;
    if (!isSelected) {
      setCurrentEmoji(unicode);
    } else {
      setCurrentEmoji(null);
    }
    setVisible(false);
  };

  const emojiContainerStyle = useMemo(() => {
    const emojiButtonWidth = ms(36);
    const gap = ms(4);
    const totalWidth =
      PLATFORM_EMOJIS.length * emojiButtonWidth +
      (PLATFORM_EMOJIS.length - 1) * gap;
    const centerOffset = -totalWidth / 2;

    return [
      styles.emojiContainer,
      {
        opacity: fadeAnim as unknown as number,
        transform: [
          {
            translateY: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-10, 0],
            }) as unknown as number,
          },
          {
            translateX: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [
                centerOffset + containerOffsetX,
                centerOffset + containerOffsetX,
              ],
            }) as unknown as number,
          },
        ],
      },
    ];
  }, [fadeAnim, containerOffsetX]);

  const overlayStyle = useMemo(
    () => [styles.overlay, {opacity: fadeAnim}],
    [fadeAnim],
  );

  const IconComponent = icon || (
    <AddReactionIcon
      width={ms(19)}
      height={ms(19)}
      color={colors.ds.icon.default}
    />
  );

  return (
    <>
      <View style={styles.wrapper} testID={testID}>
        <TouchableOpacity
          onPress={togglePicker}
          activeOpacity={0.7}
          style={[styles.iconButton, disabled && styles.iconButtonDisabled]}
          disabled={disabled}
          testID={testID ? `${testID}-button` : undefined}>
          {currentEmoji ? (
            <Text>{EMOJI_UNICODE_MAP[currentEmoji]}</Text>
          ) : (
            IconComponent
          )}
        </TouchableOpacity>

        {visible && (
          <Animated.View style={emojiContainerStyle}>
            {PLATFORM_EMOJIS.map((unicode, idx) => {
              const isSelected = currentEmoji === unicode;
              const emojiChar = EMOJI_UNICODE_MAP[unicode];
              return (
                <TouchableOpacity
                  key={`${unicode}-${idx}`}
                  style={[
                    styles.emojiButton,
                    isSelected && styles.emojiButtonSelected,
                  ]}
                  onPress={() => handleEmojiPress(unicode)}
                  activeOpacity={0.7}
                  testID={testID ? `${testID}-emoji-${idx}` : undefined}>
                  <Text style={[styles.emoji, {fontSize: emojiSize}]}>
                    {emojiChar}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        )}
      </View>

      {visible && (
        <View style={styles.container}>
          <Animated.View style={overlayStyle}>
            <TouchableOpacity
              style={styles.overlayTouchable}
              activeOpacity={1}
              onPress={() => setVisible(false)}
            />
          </Animated.View>
        </View>
      )}
    </>
  );
};

const styles = ScaledSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 1,
    alignItems: 'center',
    width: '100%',
  },
  iconButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  overlayTouchable: {
    flex: 1,
  },
  emojiContainer: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: '8@ms',
    left: '50%',
    backgroundColor: colors.white,
    borderRadius: '24@ms',
    paddingHorizontal: '8@ms',
    paddingVertical: '6@ms',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  androidShadow: {
    elevation: 5,
  },
  emojiButton: {
    width: '36@ms',
    height: '36@ms',
    borderRadius: '18@ms',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
    shadowColor: colors.lightGray5,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  emojiButtonSelected: {
    backgroundColor: colors.ds.grey[200],
  },
  emoji: {
    fontSize: '20@ms',
  },
  iconButtonDisabled: {
    opacity: 0.5,
  },
});
