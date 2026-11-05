import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button, ChipGroup, StarRating} from '@/components';
import {FEEDBACK_ISSUE_OPTIONS, isIOS, RATING_TEXT_MAP} from '@/constants';
import {colors, fontFamily, stroke, typography} from '@/theme';

import type {FeedbackPopupProps} from './types';

const DEFAULT_RATING = 0;

export const FeedbackPopup: React.FC<FeedbackPopupProps> = ({
  visible,
  onClose,
  onSubmit,
  customContainerStyle,
  customTitleStyle,
  customTextAreaStyle,
  customButtonStyle,
  customTitle,
  note = null,
  showChips = true,
  placeholder,
  initialFeedback,
  testID,
}) => {
  const {t} = useTranslation();
  const [rating, setRating] = useState(DEFAULT_RATING);
  const [suggestion, setSuggestion] = useState('');
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [slideAnim] = useState(new Animated.Value(1000));
  const [keyboardOffset] = useState(new Animated.Value(0));

  useEffect(() => {
    if (!isIOS) return;

    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      Animated.timing(keyboardOffset, {
        toValue: -e.endCoordinates.height,
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', e => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  useEffect(() => {
    if (visible) {
      setRating(initialFeedback?.rating ?? DEFAULT_RATING);
      setSuggestion(initialFeedback?.comment ?? '');
      setSelectedIssues([]);
      setSelectedTags(initialFeedback?.tags ?? []);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 1000,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim, initialFeedback]);

  const handleIssueSelectionChange = useCallback(
    (newSelectedIssues: string[]) => {
      setSelectedIssues(newSelectedIssues);
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    onSubmit({
      rating,
      issues: selectedIssues,
      comment: suggestion,
      tags: selectedTags,
    });
    onClose();
  }, [onSubmit, rating, suggestion, selectedIssues, selectedTags, onClose]);

  const issueOptions = useMemo(
    () =>
      FEEDBACK_ISSUE_OPTIONS.map(option => ({
        ...option,
        label: option.label,
      })),
    [],
  );

  const getRatingText = useMemo(() => {
    if (rating < 1) return '';
    const ratingKey =
      RATING_TEXT_MAP[rating] || RATING_TEXT_MAP[DEFAULT_RATING];
    return t(ratingKey);
  }, [t, rating]);

  const setStarRating = (newRating: number) => {
    setRating(newRating);
    setSelectedIssues([]);
    setSelectedTags([]);
  };

  const ratingTagOptions = useMemo(() => {
    if (rating <= 0) return [];
    const result = t(`postSim.feedback.dialog.rating.tags.${rating}`, {
      returnObjects: true,
    });
    return Array.isArray(result) ? result : [];
  }, [rating, t]);

  const handleTagSelectionChange = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag],
    );
  }, []);

  const renderSuggestionInput = (showTitle?: boolean) => {
    return (
      <>
        {showTitle && (
          <Text style={styles.suggestionPrompt}>
            {t('callFeedback.moreSuggestions')}
          </Text>
        )}
        <TextInput
          style={[styles.textArea, customTextAreaStyle]}
          value={suggestion}
          onChangeText={setSuggestion}
          placeholder={placeholder || t('callFeedback.suggestionPlaceholder')}
          placeholderTextColor={colors.ds.typography.lowEmphasis}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID={`${testID}-suggestion-input`}
        />
      </>
    );
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      {/* Overlay backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* Animated bottom sheet */}
      <Animated.View
        style={[
          styles.animatedContainer,
          {
            transform: [
              {translateY: slideAnim},
              {translateY: isIOS ? keyboardOffset : 0},
            ],
          },
        ]}>
        <KeyboardAvoidingView
          behavior={isIOS ? undefined : 'height'}
          keyboardVerticalOffset={0}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}>
            <TouchableWithoutFeedback>
              <View style={[styles.container, customContainerStyle]}>
                <Text style={[styles.title, customTitleStyle]}>
                  {customTitle || t('callFeedback.rateTitle')}
                </Text>
                <StarRating
                  rating={rating}
                  onRatingChange={starRating => setStarRating(starRating)}
                  testID={`${testID}-stars`}
                />
                {getRatingText?.length > 0 && (
                  <Text style={styles.ratingText}>{getRatingText}</Text>
                )}
                {rating > 0 && ratingTagOptions.length > 0 && (
                  <View style={styles.tagsContainer}>
                    {ratingTagOptions.map(tag => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => handleTagSelectionChange(tag)}
                          style={[
                            styles.tag,
                            isSelected && styles.tagSelected,
                          ]}>
                          <Text
                            style={[
                              styles.tagText,
                              isSelected && styles.tagTextSelected,
                            ]}>
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {rating !== 5 && rating !== 0 && showChips && (
                  <>
                    <ChipGroup
                      options={issueOptions}
                      selectedValues={selectedIssues}
                      onSelectionChange={handleIssueSelectionChange}
                      title={t('callFeedback.selectIssues')}
                      testID={`${testID}-issue-chips`}
                    />
                    <View style={styles.separator} />
                  </>
                )}
                {(rating === 5 ||
                  !showChips ||
                  selectedIssues.includes(
                    FEEDBACK_ISSUE_OPTIONS[FEEDBACK_ISSUE_OPTIONS.length - 1]
                      .value,
                  )) &&
                  renderSuggestionInput(
                    !placeholder && selectedIssues.length < 1,
                  )}
                {note && note?.length > 0 && (
                  <Text style={styles.instructionText}>{note}</Text>
                )}
                <Button
                  label={t('callFeedback.submit')}
                  onPress={handleSubmit}
                  customContainerStyle={customButtonStyle}
                  isDisabled={rating < 1}
                  testID={`${testID}-submit-button`}
                />
              </View>
            </TouchableWithoutFeedback>
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9998,
  },
  animatedContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    maxHeight: '90%',
  },
  scrollView: {
    maxHeight: '100%',
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    backgroundColor: colors.ds.neutral.white,
    borderTopLeftRadius: '12@ms',
    borderTopRightRadius: '12@ms',
    padding: '24@ms',
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
    marginBottom: '4@vs',
  },
  ratingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    textAlign: 'center',
    marginBottom: '14@vs',
    marginTop: '4@vs',
  },
  suggestionPrompt: {
    fontSize: '12@ms',
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray12,
    textAlign: 'center',
    marginTop: '4@vs',
    marginBottom: '12@vs',
  },
  textArea: {
    width: '100%',
    minHeight: '80@vs',
    borderWidth: 0.5,
    borderColor: stroke.primary,
    borderRadius: '8@ms',
    padding: '12@ms',
    backgroundColor: colors.ds.neutral.white,
    ...typography.body.medium,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.black,
    marginBottom: '16@vs',
  },
  separator: {
    width: '100%',
    height: 1,
    backgroundColor: colors.ds.typography.lowEmphasis,
    marginBottom: '16@vs',
  },
  instructionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
    marginBottom: '24@vs',
    lineHeight: '18@vs',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '8@ms',
    marginBottom: '14@vs',
    width: '100%',
  },
  tag: {
    paddingHorizontal: '12@ms',
    paddingVertical: '6@vs',
    borderRadius: '20@ms',
    borderWidth: 1,
    borderColor: stroke.primary,
    backgroundColor: colors.ds.neutral.white,
  },
  tagSelected: {
    backgroundColor: colors.ds.theme.primary,
    borderColor: colors.ds.theme.primary,
  },
  tagText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.ds.typography.highEmphasis,
  },
  tagTextSelected: {
    color: colors.ds.neutral.white,
  },
});
