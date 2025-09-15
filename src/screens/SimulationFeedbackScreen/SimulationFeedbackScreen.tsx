import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {ArrowDown, ChevronDown, LeftArrowIcon, StarIcon} from '@/assets';
import {PrimaryButton, useErrorToast} from '@/components';
import {FEEDBACK_OPTIONS} from '@/constants';
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
import {colors, globalStyles} from '@/theme';
import {navigateToLearnTab} from '@/utils';

import {
  FeedbackDropdown,
  SimulationSummary,
  SimulationSummarySkeleton,
  SimulationTranscript,
} from './components';
import {styles} from './styles';

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
  const [showSummary, setShowSummary] = useState<boolean>(true);
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

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

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      const isNearBottom =
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
      setShowScrollButton(!isNearBottom);
    },
    [],
  );

  const onHeaderPress = () => setIsDropdownVisible(true);
  const hideHeaderDropdown = () => setIsDropdownVisible(false);

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

  const renderTitle = () => {
    return (
      <Text style={styles.title}>
        {t('SimulationFeedback.title')}{' '}
        <Text style={styles.titleItalic}>
          {showSummary
            ? !fromLogs
              ? t('CallSummary.header.subtitle')
              : t('SimulationFeedback.titleEnded')
            : t('SimulationFeedback.transcript')}
        </Text>
      </Text>
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
        <TouchableOpacity
          style={[
            globalStyles.rowCenter,
            !fromLogs && styles.titleExtraPadding,
          ]}
          onPress={onHeaderPress}
          disabled={!fromLogs}
          activeOpacity={0.8}>
          {renderTitle()}
          {fromLogs && (
            <View style={styles.arrowDownContainer}>
              <ArrowDown width={9} height={5} />
            </View>
          )}
        </TouchableOpacity>
      </View>
      {showSummary && (
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
              {!fromLogs && renderFeedback()}
              {!fromLogs && renderButtonContainer()}
            </>
          )}
        </KeyboardAwareScrollView>
      )}
      {!isSimulationDetailsLoading && !showSummary && (
        <SimulationTranscript
          sessionId={simulationId ?? ''}
          startedAt={simulationDetails?.startedAt}
        />
      )}
      <FeedbackDropdown
        visible={isDropdownVisible}
        onClose={hideHeaderDropdown}
        showSummary={showSummary}
        setShowSummary={setShowSummary}
      />
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
