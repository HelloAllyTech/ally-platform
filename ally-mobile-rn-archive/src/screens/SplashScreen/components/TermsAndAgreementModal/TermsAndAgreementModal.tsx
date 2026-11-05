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

import {Button, Checkbox} from '@/components';
import {TERMS_AND_CONDITIONS_URL, TermsAndAgreementData} from '@/constants';
import {useTranslate} from '@/hooks';
import {TranslationType} from '@/localization/locales/type';

import {styles} from './styles';

interface TermsAndAgreementModalProps {
  visible: boolean;
  onAgree: () => void;
}

export const TermsAndAgreementModal: React.FC<TermsAndAgreementModalProps> = ({
  visible,
  onAgree,
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
            <Text style={styles.title}>{t('terms.title')}</Text>

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
              {TermsAndAgreementData.map((section, sectionIndex) => (
                <View key={sectionIndex} style={styles.termItem}>
                  <Text style={styles.termHeading}>
                    {t(section.headingKey as TranslationType)}
                  </Text>
                  {section.bullets.map((bullet, bulletIndex) => (
                    <View key={bulletIndex} style={styles.bulletContainer}>
                      <Text style={styles.bulletPoint}>•</Text>
                      <Text style={styles.termContent}>
                        {t(bullet.textKey as TranslationType)}
                        {bullet.boldTextKey && (
                          <Text style={styles.boldText}>
                            {t(bullet.boldTextKey as TranslationType)}
                          </Text>
                        )}
                        {bullet.suffixTextKey && (
                          <Text>
                            {t(bullet.suffixTextKey as TranslationType)}
                          </Text>
                        )}
                        {bullet.link && (
                          <Text
                            style={styles.linkText}
                            onPress={() => handleLinkPress(bullet.link!.href)}>
                            {t(bullet.link.textKey as TranslationType)}
                          </Text>
                        )}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={styles.completeDetailsContainer}>
                <Text style={styles.completeDetailsText}>
                  {t('terms.footerPrefix')}{' '}
                  <Text
                    style={styles.linkText}
                    onPress={() => handleLinkPress(TERMS_AND_CONDITIONS_URL)}>
                    {t('terms.footerLinkText')}
                  </Text>
                  .
                </Text>
              </View>
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
                      {t('terms.scrollToBottom')}
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
                      {t('terms.agreeLabel')}
                    </Text>
                  </TouchableOpacity>

                  <Button
                    label={t('terms.agreeButton')}
                    onPress={onAgree}
                    isDisabled={!isAgreed}
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
