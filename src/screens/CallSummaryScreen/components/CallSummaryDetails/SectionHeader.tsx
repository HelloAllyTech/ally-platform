import React, {useEffect, useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {
  CheckIcon,
  CloseCircle,
  EditSquareIcon,
  WandStarsIcon,
} from '@/assets/icons';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface SectionHeaderProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  canEdit: boolean;
  isEditing: boolean;
  onTickPress: () => void;
  onClosePress: () => void;
  onEditPress: () => void;
  onPressWand: () => void;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  label,
  isExpanded,
  onToggle,
  icon,
  canEdit = true,
  isEditing,
  onTickPress,
  onClosePress,
  onEditPress,
  onPressWand,
}) => {
  const [shouldRenderButtons, setShouldRenderButtons] = useState(false);

  const animValue = useSharedValue(0);

  useEffect(() => {
    if (isEditing) {
      setShouldRenderButtons(true);
      animValue.value = withTiming(1, {duration: 600});
    } else {
      animValue.value = withTiming(0, {duration: 400}, () => {
        runOnJS(setShouldRenderButtons)(false);
      });
    }
  }, [isEditing, animValue]);

  const editButtonStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isEditing ? 0 : 1, {duration: 200}),
    };
  });

  const editButtonsContainerStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(isEditing ? 1 : 0, {duration: 600}),
      transform: [
        {
          translateX: withTiming(isEditing ? 0 : 20, {duration: 600}),
        },
      ],
    };
  });

  return (
    <TouchableOpacity
      style={styles.sectionHeader}
      onPress={onToggle}
      activeOpacity={0.7}>
      <View style={styles.leftContent}>
        <Text style={styles.sectionArrow}>{isExpanded ? '▼' : '▶'}</Text>
        <View style={styles.iconContainer}>{icon}</View>
        <View style={styles.titleContainer}>
          <Text
            style={styles.sectionTitle}
            numberOfLines={1}
            ellipsizeMode="tail">
            {label}
          </Text>
        </View>
      </View>

      {isExpanded && canEdit && (
        <>
          {!shouldRenderButtons && (
            <Animated.View style={editButtonStyle}>
              <TouchableOpacity onPress={onEditPress} style={styles.editButton}>
                <EditSquareIcon />
              </TouchableOpacity>
            </Animated.View>
          )}

          {shouldRenderButtons && (
            <Animated.View
              style={[styles.editButtonContainer, editButtonsContainerStyle]}>
              <TouchableOpacity
                style={styles.buttonContainer}
                onPress={onPressWand}>
                <WandStarsIcon />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonContainer}
                onPress={onTickPress}>
                <CheckIcon />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buttonContainer}
                onPress={onClosePress}>
                <CloseCircle />
              </TouchableOpacity>
            </Animated.View>
          )}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '14@ms',
    paddingHorizontal: '10@ms',
    justifyContent: 'space-between',
  },
  leftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: '10@ms',
  },
  sectionArrow: {
    fontSize: '16@ms',
    marginRight: '14@ms',
    color: colors.darkSlate,
    width: '18@ms',
    textAlign: 'center',
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.black,
    width: '85%',
  },
  iconContainer: {
    marginRight: '8@ms',
  },
  titleContainer: {
    flex: 1,
    marginLeft: '6@ms',
  },
  editButton: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12@ms',
    borderWidth: 0.3,
    borderColor: colors.lightGray4,
  },
  editButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContainer: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '12@ms',
    borderWidth: 0.3,
    borderColor: colors.lightGray4,
    marginHorizontal: '4@ms',
  },
});
