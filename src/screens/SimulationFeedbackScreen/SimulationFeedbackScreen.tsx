import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {StarIcon} from '@/assets';
import {PrimaryButton, useErrorToast} from '@/components';
import {FEEDBACK_OPTIONS, SCREEN_NAMES, WINDOW_HEIGHT} from '@/constants';
import {useAppNavigation} from '@/hooks';
import {useAddFeedbackMutation} from '@/services';
import {colors, fontFamily, typography} from '@/theme';

export const SimulationFeedbackScreen: React.FC = () => {
  const {t} = useTranslation();
  const [rating, setRating] = useState<number>(0);
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [additionalFeedback, setAdditionalFeedback] = useState<string>('');

  const navigation = useAppNavigation();
  const [addFeedback, {isLoading}] = useAddFeedbackMutation();
  const {showErrorToast} = useErrorToast();

  const handleStarPress = (starIndex: number) => {
    const feedback = starIndex + 1;
    setRating(feedback);

    setFeedbackText(
      FEEDBACK_OPTIONS[feedback as keyof typeof FEEDBACK_OPTIONS],
    );
  };

  const handleSubmit = async () => {
    try {
      const response = await addFeedback({
        rating,
        comment: additionalFeedback || feedbackText,
      });
      if (response.data) {
        navigation.reset({
          index: 1,
          routes: [
            {name: SCREEN_NAMES.CALL_LOG},
            {name: SCREEN_NAMES.SIMULATIONS},
          ],
        });
      } else {
        showErrorToast(response.error, 'Errors.submitFeedback');
      }
    } catch (error) {
      showErrorToast(error, 'Errors.submitFeedback');
    }
  };

  const renderStars = () => {
    return Array.from({length: 5}, (_, index) => (
      <TouchableOpacity
        key={index}
        onPress={() => handleStarPress(index)}
        style={styles.starContainer}>
        <StarIcon
          width={24}
          height={24}
          color={index < rating ? colors.starYellow : colors.lightGray4}
        />
      </TouchableOpacity>
    ));
  };

  const renderFeedbackCard = () => {
    return (
      <View style={styles.feedbackCard}>
        <Text style={styles.questionText}>
          {t('SimulationFeedback.questionText')}
        </Text>
        <View style={styles.starsContainer}>{renderStars()}</View>
        <Text style={styles.feedbackText}>{feedbackText}</Text>
        <TextInput
          style={styles.textInput}
          placeholder={t('SimulationFeedback.placeholderText')}
          placeholderTextColor={colors.lightGray3}
          value={additionalFeedback}
          onChangeText={setAdditionalFeedback}
          multiline
          textAlignVertical="top"
        />
      </View>
    );
  };

  const renderButtonContainer = () => {
    return (
      <View style={styles.buttonContainer}>
        <PrimaryButton
          label={
            isLoading
              ? t('SimulationFeedback.submittingButton')
              : t('SimulationFeedback.submitButton')
          }
          onPress={handleSubmit}
          customContainerStyle={styles.submitButton}
          isDisabled={isLoading}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.titleSection}>
          <Text style={styles.title}>
            {t('SimulationFeedback.title')}{' '}
            <Text style={styles.titleItalic}>
              {t('SimulationFeedback.titleEnded')}
            </Text>
          </Text>
        </View>
        <View style={styles.headerSection}>
          <Text style={styles.headerText}>
            {t('SimulationFeedback.headerText')}
          </Text>
          <View style={styles.headerLine} />
        </View>
        {renderFeedbackCard()}
        {renderButtonContainer()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: '20@ms',
    paddingTop: WINDOW_HEIGHT * 0.12,
    paddingBottom: '40@vs',
  },
  titleSection: {
    marginBottom: '10@vs',
  },
  title: {
    ...typography.headline.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '22@ms',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '16@vs',
  },
  headerText: {
    ...typography.label.medium,
    color: colors.lightGray3,
    letterSpacing: 1,
  },
  headerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.lightGray4,
    marginLeft: '10@ms',
  },
  feedbackCard: {
    borderRadius: '12@ms',
    padding: '16@ms',
    marginBottom: '20@vs',
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  questionText: {
    ...typography.headline.small,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray12,
    fontSize: '18@ms',
    textAlign: 'center',
    marginBottom: '12@vs',
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: '8@vs',
  },
  starContainer: {
    marginHorizontal: '4@ms',
  },
  feedbackText: {
    ...typography.body.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    fontSize: '15@ms',
    textAlign: 'center',
    marginBottom: '12@vs',
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '12@ms',
    minHeight: '120@vs',
    ...typography.body.medium,
    color: colors.darkGray2,
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  buttonContainer: {
    marginTop: 'auto',
  },
  submitButton: {
    marginTop: '20@vs',
  },
});
