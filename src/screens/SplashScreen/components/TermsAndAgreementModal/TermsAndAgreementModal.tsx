import React, {useCallback, useRef, useState} from 'react';
import {
  LayoutChangeEvent,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Checkbox, PrimaryButton} from '@/components';
import {TermsAndAgreementData} from '@/constants';
import {useTranslate} from '@/hooks';

import {styles} from './styles';

interface TermsAndAgreementModalProps {
  visible: boolean;
  onAgree: () => void;
  isLoading?: boolean;
}

export const TermsAndAgreementModal: React.FC<TermsAndAgreementModalProps> = ({
  visible,
  onAgree,
  isLoading,
}) => {
  const [isAgreed, setIsAgreed] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollDimensions = useRef({
    contentHeight: 0,
    visibleHeight: 0,
  });
  const {t} = useTranslate();

  const handleLinkPress = useCallback(async (url: string) => {
    await Linking.openURL(url);
  }, []);

  const checkScrollToBottom = () => {
    const {contentHeight, visibleHeight} = scrollDimensions.current;
    if (contentHeight > 0 && visibleHeight > 0) {
      if (contentHeight <= visibleHeight + 20) {
        setIsScrolledToBottom(true);
      }
    }
  };

  const handleContentSizeChange = (w: number, h: number) => {
    scrollDimensions.current.contentHeight = h;
    checkScrollToBottom();
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    scrollDimensions.current.visibleHeight = event.nativeEvent.layout.height;
    checkScrollToBottom();
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {layoutMeasurement, contentOffset, contentSize} = event.nativeEvent;
    const isCloseToBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 20;

    if (isCloseToBottom) {
      setIsScrolledToBottom(true);
    }
  };

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({animated: true});
    setIsScrolledToBottom(true);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent>
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.contentContainer}>
            <Text style={styles.title}>{t('TermsAndAgreement.title')}</Text>

            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              showsVerticalScrollIndicator
              indicatorStyle="black"
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onContentSizeChange={handleContentSizeChange}
              onLayout={handleLayout}
              testID="terms-scroll-view">
              {TermsAndAgreementData.map((item, index) => (
                <View key={index} style={styles.termItem}>
                  <View style={styles.termHeader}>
                    <Text style={[styles.termHeading, styles.termIndex]}>
                      {index + 1}.
                    </Text>
                    <Text style={styles.termHeading}>{item.heading}</Text>
                  </View>
                  <Text style={styles.termContent}>
                    {item.content}
                    {item.link && (
                      <Text
                        style={styles.linkText}
                        onPress={() => handleLinkPress(item.link.href)}>
                        {item.link.text}.
                      </Text>
                    )}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.footer}>
              {!isScrolledToBottom ? (
                <>
                  <View style={styles.separator} />
                  <TouchableOpacity
                    style={styles.scrollToBottomButton}
                    onPress={scrollToBottom}
                    testID="scroll-to-bottom-button">
                    <Text style={styles.scrollToBottomText}>
                      {t('TermsAndAgreement.scrollToBottom')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.separator} />
                  <TouchableOpacity
                    style={styles.checkboxContainer}
                    activeOpacity={0.7}
                    onPress={() => setIsAgreed(prev => !prev)}
                    testID="agree-checkbox-container">
                    <Checkbox
                      checked={isAgreed}
                      onPress={() => setIsAgreed(!isAgreed)}
                    />
                    <Text style={styles.checkboxLabel}>
                      {t('TermsAndAgreement.iHaveReadAndAgree')}
                    </Text>
                  </TouchableOpacity>

                  <PrimaryButton
                    label={t('TermsAndAgreement.agree')}
                    onPress={onAgree}
                    isDisabled={!isAgreed}
                    isLoading={isLoading}
                    customContainerStyle={styles.agreeButton}
                  />
                </>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};
