import React, {useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {EditIcon, LeftArrowIcon, ThreeDotsIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP} from '@/constants/general';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';

interface HeaderProps {
  isFullyExpanded: boolean;
  onBackPress: () => void;
  onMenuPress: () => void;
  summaryName?: string;
  onSummaryNameChange?: (name: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  isFullyExpanded,
  onBackPress,
  onMenuPress,
  summaryName = '',
  onSummaryNameChange,
}) => {
  const {t} = useTranslate();
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(summaryName);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setEditedName(summaryName);
  }, [summaryName]);

  const handleEditPress = () => {
    setIsEditing(true);
  };

  const handleSubmitEditing = () => {
    handleBlur();
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (onSummaryNameChange && editedName !== summaryName) {
      onSummaryNameChange(editedName);
    }
  };

  const handleContainerPress = () => {
    if (isEditing) {
      Keyboard.dismiss();
      handleBlur();
    }
  };

  if (!isFullyExpanded) {
    return (
      <TouchableWithoutFeedback onPress={handleContainerPress}>
        <View style={styles.expandedTitleContainer}>
          <View style={styles.expandedTitleContent}>
            <View style={styles.expandedSummaryTitleContainer}>
              <TouchableOpacity
                style={styles.backButtonExpanded}
                onPress={onBackPress}>
                <LeftArrowIcon />
              </TouchableOpacity>
              <View>
                <Text style={styles.expandedSummaryTitle}>
                  {t('CallSummary.header.title')}{' '}
                  <Text style={styles.headerSubtitle}>
                    {t('CallSummary.header.subtitle')}
                  </Text>
                </Text>
                <View style={styles.nameContainer}>
                  {isEditing ? (
                    <TextInput
                      ref={inputRef}
                      style={[styles.summaryNameText, styles.nameInput]}
                      value={editedName}
                      onChangeText={setEditedName}
                      onBlur={handleBlur}
                      onSubmitEditing={handleSubmitEditing}
                      returnKeyType="done"
                      autoFocus
                    />
                  ) : (
                    <Text style={styles.summaryNameText} numberOfLines={1}>
                      {summaryName ? `#${summaryName}` : '-'}
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={handleEditPress}
                    style={styles.editButton}>
                    <EditIcon width={14} height={14} color={colors.darkSlate} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            <TouchableOpacity
              hitSlop={DEFAULT_HIT_SLOP}
              style={styles.moreOptionsContainer}
              onPress={onMenuPress}>
              <ThreeDotsIcon />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBackPress}>
        <LeftArrowIcon />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>
        {t('CallSummary.header.title')}{' '}
        <Text style={styles.headerSubtitle}>
          {t('CallSummary.header.subtitle')}
        </Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: '20@ms',
    paddingTop: '40@ms',
  },
  backButton: {
    backgroundColor: colors.ashGray,
    borderRadius: '22@ms',
    width: '44@ms',
    height: '44@ms',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: '12@ms',
    opacity: 0.8,
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '24@ms',
    color: colors.white,
    fontWeight: '400',
  },
  headerSubtitle: {
    fontStyle: 'italic',
    fontWeight: '500',
  },
  expandedSummaryTitleContainer: {
    flexDirection: 'row',
    height: '80@ms',
    alignItems: 'center',
    maxWidth: '80%',
  },
  expandedSummaryTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
  },
  backButtonExpanded: {
    paddingLeft: '4@ms',
    paddingRight: '12@ms',
  },
  expandedTitleContainer: {
    backgroundColor: colors.white,
    paddingTop: '12@ms',
    height: '90@ms',
    zIndex: 1000,
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  expandedTitleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moreOptionsContainer: {
    paddingRight: '20@ms',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '8@ms',
    marginBottom: '8@ms',
    maxWidth: '90%',
  },
  summaryNameText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.charcoal2,
  },
  nameInput: {
    minWidth: '200@ms',
  },
  editButton: {
    padding: '4@ms',
    marginLeft: '8@ms',
  },
});
