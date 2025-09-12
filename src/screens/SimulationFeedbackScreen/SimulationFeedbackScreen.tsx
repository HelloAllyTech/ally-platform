import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronDown, LeftArrowIcon, StarIcon} from '@/assets';
import {PrimaryButton, useErrorToast} from '@/components';
import {FEEDBACK_OPTIONS, isIOS} from '@/constants';
import {
  useAppNavigation,
  useDebounce,
  useHardwareBackPressHandler,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation/types';
import {
  useAddSimulationFeedbackMutation,
  useLazyGetSimulationDetailsQuery,
} from '@/services';
import {colors, fontFamily, typography} from '@/theme';
import {navigateToLearnTab} from '@/utils';

import {SimulationSummary, SimulationSummarySkeleton} from './components';

export const SimulationFeedbackScreen: React.FC<
  RootStackScreenProps<'SimulationFeedback'>
> = ({route}) => {
  const simulationId = route.params?.simulationId;
  const fromLogs = route.params?.fromLogs;

  const {t} = useTranslation();
  const insets = useSafeAreaInsets();

  const [rating, setRating] = useState<number>(0);
  const [feedbackText, setFeedbackText] = useState<string>('');
  const [additionalFeedback, setAdditionalFeedback] = useState<string>('');
  const [showScrollButton, setShowScrollButton] = useState<boolean>(false);

  const navigation = useAppNavigation();
  const [addSimulationFeedback] = useAddSimulationFeedbackMutation();
  const [
    getSimulationDetails,
    {data: simulationDetails, isLoading: isSimulationDetailsLoading},
  ] = useLazyGetSimulationDetailsQuery();
  const {showErrorToast} = useErrorToast();
  const scrollViewRef = useRef<KeyboardAwareScrollView>(null);

  useHardwareBackPressHandler(() => {
    if (fromLogs) {
      navigation.goBack();
      return true;
    }
    navigateToLearnTab(navigation);
    return true;
  });

  const debouncedSubmitFeedback = useDebounce(
    async (comment: string, currentRating: number) => {
      if (rating === 0) return;
      try {
        await addSimulationFeedback({
          scenarioSessionId: simulationId?.toString() || '',
          rating: currentRating,
          comment,
        });
      } catch (error) {
        showErrorToast(error, 'Errors.submitFeedback');
      }
    },
    {delay: 500},
  );

  useEffect(() => {
    if (simulationId) {
      getSimulationDetails({id: simulationId?.toString()});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationId]);

  const handleTextChange = (text: string) => {
    debouncedSubmitFeedback(text, rating);
    setAdditionalFeedback(text);
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
    scrollViewRef.current?.scrollToEnd();
  }, []);

  const handleScroll = useCallback((event: any) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const isNearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
    setShowScrollButton(!isNearBottom);
  }, []);

  const renderStars = (disabled?: boolean) => {
    return Array.from({length: 5}, (_, index) => (
      <TouchableOpacity
        key={index}
        onPress={() => handleStarPress(index)}
        disabled={disabled}
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
            onChangeText={handleTextChange}
            multiline
            textAlignVertical="top"
          />
        </View>
      </>
    );
  };

  const renderSummary = () => {
    return (
      <View>
        {renderSectionHeader(t('SimulationFeedback.sessionSummary'))}
        <SimulationSummary data={simulationDetails} />
      </View>
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
    <SafeAreaView
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.titleSection}>
        {fromLogs && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}>
            <LeftArrowIcon />
          </TouchableOpacity>
        )}
        <Text style={[styles.title, !fromLogs && styles.titleExtraPadding]}>
          {t('SimulationFeedback.title')}{' '}
          <Text style={styles.titleItalic}>
            {fromLogs
              ? t('SimulationFeedback.titleDetails')
              : t('SimulationFeedback.titleEnded')}
          </Text>
        </Text>
      </View>
      <KeyboardAwareScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        extraScrollHeight={100}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}>
        {isSimulationDetailsLoading ? (
          <SimulationSummarySkeleton />
        ) : (
          <>
            {renderSummary()}
            {/* TODO: Remove this later. Future enhancement to show added feedback for logs */}
            {!fromLogs && renderFeedback()}
            {!fromLogs && renderButtonContainer()}
          </>
        )}
      </KeyboardAwareScrollView>
      {showScrollButton && !isSimulationDetailsLoading && (
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
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: '10@vs',
    paddingRight: '20@ms',
    paddingLeft: '10@ms',
    paddingBottom: '8@vs',
    marginTop: '8@vs',
    borderBottomWidth: 1,
    borderBottomColor: colors.ashGray,
  },
  backButton: {
    paddingRight: '1@ms',
  },
  title: {
    ...typography.headline.large,
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray2,
    fontSize: '18@ms',
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: '5@vs',
  },
  headerText: {
    ...fontFamily.ROBOTO.REGULAR,
    fontSize: '12@ms',
    color: colors.lightGray12,
    letterSpacing: '4@ms',
    fontWeight: '700',
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
    minHeight: '90@vs',
    maxHeight: '120@vs',
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
  titleExtraPadding: {
    paddingLeft: '10@vs',
  },
});
