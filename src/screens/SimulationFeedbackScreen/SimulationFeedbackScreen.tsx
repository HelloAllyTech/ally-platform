import React, {useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {StarIcon} from '@/assets/icons';
import {PrimaryButton} from '@/components/Button';
import {useAppNavigation} from '@/hooks';
import {useAddFeedbackMutation} from '@/services/simulationsApi';
import {colors, fontFamily, typography} from '@/theme';

export const SimulationFeedbackScreen: React.FC = () => {
  const [rating, setRating] = useState<number>(4);
  const [feedbackText, setFeedbackText] = useState<string>('Nice Experience!');
  const [additionalFeedback, setAdditionalFeedback] = useState<string>('');

  const navigation = useAppNavigation();
  const [addFeedback, {isLoading}] = useAddFeedbackMutation();

  const handleStarPress = (starIndex: number) => {
    setRating(starIndex + 1);
    // Update feedback text based on rating
    const feedbackOptions = [
      'Poor Experience',
      'Below Average',
      'Average',
      'Nice Experience!',
      'Excellent Experience!',
    ];
    setFeedbackText(feedbackOptions[starIndex]);
  };

  const handleSubmit = async () => {
    try {
      await addFeedback({
        rating,
        comment: additionalFeedback || feedbackText,
      });

      // Navigate back on success
      navigation.pop();
    } catch (error) {
      // Handle error - you might want to show a toast or alert
      console.error('Failed to submit feedback:', error);
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>
            Simulation <Text style={styles.titleItalic}>Ended</Text>
          </Text>
        </View>

        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.headerText}>REVIEW AND RATING</Text>
          <View style={styles.headerLine} />
        </View>

        {/* Feedback Card */}
        <View style={styles.feedbackCard}>
          <Text style={styles.questionText}>How was your experience?</Text>

          {/* Star Rating */}
          <View style={styles.starsContainer}>{renderStars()}</View>

          {/* Pre-filled Feedback */}
          <Text style={styles.feedbackText}>{feedbackText}</Text>

          {/* Text Input */}
          <TextInput
            style={styles.textInput}
            placeholder="How was your Experience ?"
            placeholderTextColor={colors.lightGray3}
            value={additionalFeedback}
            onChangeText={setAdditionalFeedback}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Submit Button */}
        <View style={styles.buttonContainer}>
          <PrimaryButton
            label={isLoading ? 'Submitting...' : 'Submit Feedback'}
            onPress={handleSubmit}
            customContainerStyle={styles.submitButton}
            disabled={isLoading}
          />
        </View>
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
    paddingTop: '40@vs',
    paddingBottom: '40@vs',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: '40@vs',
  },
  title: {
    ...typography.headline.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    textAlign: 'center',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '30@vs',
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
    backgroundColor: colors.lightGray8,
    borderRadius: '12@ms',
    padding: '24@ms',
    marginBottom: '40@vs',
    borderWidth: 1,
    borderColor: colors.lightGray4,
  },
  questionText: {
    ...typography.headline.small,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    textAlign: 'center',
    marginBottom: '20@vs',
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: '16@vs',
  },
  starContainer: {
    marginHorizontal: '4@ms',
  },
  feedbackText: {
    ...typography.body.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.darkGray2,
    textAlign: 'center',
    marginBottom: '24@vs',
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    minHeight: '120@vs',
    ...typography.body.medium,
    color: colors.darkGray2,
    borderWidth: 1,
    borderColor: colors.lightGray4,
  },
  buttonContainer: {
    marginTop: 'auto',
  },
  submitButton: {
    marginTop: '20@vs',
  },
});
