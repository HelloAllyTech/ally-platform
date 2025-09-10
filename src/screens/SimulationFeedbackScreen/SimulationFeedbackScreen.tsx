import React, {useCallback, useEffect, useRef, useState} from 'react';
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

import {ChevronDown, StarIcon} from '@/assets';
import {PrimaryButton, useErrorToast} from '@/components';
import {FEEDBACK_OPTIONS} from '@/constants';
import {useAppNavigation} from '@/hooks';
import {useAddSimulationFeedbackMutation} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {navigateToLearnTab} from '@/utils';

import {SimulationSummary, SimulationSummarySkeleton} from './components';

export const SimulationFeedbackScreen: React.FC = () => {
  const {t} = useTranslation();
  const [rating, setRating] = useState<number>(0);
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [additionalFeedback, setAdditionalFeedback] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);

  const navigation = useAppNavigation();
  const [addFeedback] = useAddSimulationFeedbackMutation();
  const {showErrorToast} = useErrorToast();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => {
      setIsLoading(false);
    }, 5000);
  }, []);

  const handleSubmitFeedback = async (text: string) => {
    setAdditionalFeedback(text);
    try {
      await addFeedback({
        rating,
        comment: additionalFeedback,
      });
    } catch (error) {
      showErrorToast(error, 'Errors.submitFeedback');
    }
  };

  const handleStarPress = (starIndex: number) => {
    const feedback = starIndex + 1;
    setRating(feedback);

    setFeedbackText(
      FEEDBACK_OPTIONS[feedback as keyof typeof FEEDBACK_OPTIONS],
    );
  };

  const handleSubmit = () => {
    navigateToLearnTab(navigation);
  };

  const handleScrollToBottom = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({animated: true});
  }, []);

  const handleScroll = useCallback((event: any) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const isNearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
    setShowScrollButton(!isNearBottom);
  }, []);

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

  const renderSectionHeader = (headerText: string) => {
    return (
      <View style={styles.headerSection}>
        <Text style={styles.headerText}>{headerText}</Text>
        <View style={styles.headerLine} />
      </View>
    );
  };

  const renderFeedback = () => {
    return (
      <>
        {renderSectionHeader(t('SimulationFeedback.headerText'))}
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
            onChangeText={text => handleSubmitFeedback(text)}
            multiline
            textAlignVertical="top"
          />
        </View>
      </>
    );
  };

  const renderSummary = () => {
    return (
      <>
        {renderSectionHeader(t('SimulationFeedback.sessionSummary'))}
        <SimulationSummary />
      </>
    );
  };

  const renderButtonContainer = () => {
    return (
      <View style={styles.buttonContainer}>
        <PrimaryButton
          label={t('SimulationFeedback.tryAnother')}
          onPress={handleSubmit}
          customContainerStyle={styles.submitButton}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleSection}>
        <Text style={styles.title}>
          {t('SimulationFeedback.title')}{' '}
          <Text style={styles.titleItalic}>
            {t('SimulationFeedback.titleEnded')}
          </Text>
        </Text>
      </View>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}>
        {isLoading ? (
          <SimulationSummarySkeleton />
        ) : (
          <>
            {renderSummary()}
            {renderFeedback()}
            {renderButtonContainer()}
          </>
        )}
      </ScrollView>
      {showScrollButton && !isLoading && (
        <TouchableOpacity
          onPress={handleScrollToBottom}
          style={styles.scrollToBottomButton}>
          <ChevronDown width={14} height={14} color={colors.lightGray4} />
        </TouchableOpacity>
      )}
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
    paddingBottom: '40@vs',
  },
  titleSection: {
    marginBottom: '10@vs',
    paddingHorizontal: '20@ms',
  },
  title: {
    ...typography.headline.large,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray2,
    fontSize: '18@ms',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginTop: '16@vs',
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
    backgroundColor: colors.lightGray1,
    borderRadius: '8@ms',
    padding: '12@ms',
    minHeight: '80@vs',
    ...typography.body.medium,
    color: colors.darkGray2,
    borderWidth: 0.5,
    borderColor: colors.lightGray4,
  },
  buttonContainer: {
    marginTop: 'auto',
  },
  submitButton: {
    marginTop: '10@vs',
    paddingVertical: '8@vs',
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: '60@vs',
    right: '16@ms',
    zIndex: 1000,
    borderRadius: '50%',
    backgroundColor: colors.whiteTransparent10,
    borderWidth: 1,
    borderColor: colors.lightGray4,
    justifyContent: 'center',
    alignItems: 'center',
    width: '30@ms',
    height: '30@ms',
    paddingTop: '3@ms',
  },
});
