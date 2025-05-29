import React, {useEffect, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {
  Dimensions,
  Keyboard,
  StatusBar,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {LeftArrowIcon} from '@/assets/icons';
import {useCounselorChat} from '@/hooks/useCounselorChat';
import useTranslate from '@/hooks/useTranslate';
import {useUser} from '@/hooks/useUser';
import {RootStackScreenProps} from '@/navigation/types';

import {OtpVerification, PhoneLogin} from './components';
import {styles} from './styles';
import {AuthStep} from './types';

const {height} = Dimensions.get('screen');

export const SplashScreen: React.FC<RootStackScreenProps<'Splash'>> = ({
  navigation,
}) => {
  const [isBottomSheetVisible, setIsBottomSheetVisible] = useState(false);
  const [isAnimationEnded, setIsAnimationEnded] = useState(false);
  const lottieRef = useRef<LottieView>(null);
  const insets = useSafeAreaInsets();
  const {checkAuth, isAuthenticated, isUserLoading} = useUser();
  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: () => {
      // Reset the navigation stack to have Home and Listening screens
      navigation.reset({
        index: 1,
        routes: [{name: 'Home'}, {name: 'Listening'}],
      });
    },
    onNoActiveChatFound: () => {
      navigation.replace('Home');
    },
    shouldSubscribeToAppState: false,
  });
  const {t} = useTranslate();

  const animationTranslateY = useSharedValue(0);

  const [currentStep, setCurrentStep] = useState<AuthStep>('PHONE_NUMBER');
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    StatusBar.setHidden(true); // Hide status bar
    // Play lottie animation from frame 0 to 200 and freeze at the end frame
    lottieRef.current?.play(0, 200);
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAnimationEnded) {
      if (!isUserLoading && !isAuthenticated) {
        setIsBottomSheetVisible(true);
        animationTranslateY.value = withTiming(-height * 0.6, {
          duration: 1000,
        });
      } else if (isAuthenticated) {
        // Check for counselor chat after authentication
        checkCounselorChat();
      }
    }
  }, [
    isAnimationEnded,
    isAuthenticated,
    isUserLoading,
    animationTranslateY,
    checkCounselorChat,
  ]);

  const handleOtpGenerationSuccess = async (phone: string) => {
    setPhoneNumber(phone);
    setCurrentStep('OTP');
  };

  const handleOtpVerificationSuccess = () => {
    checkAuth();
  };

  const handleBackPress = () => {
    setCurrentStep('PHONE_NUMBER');
  };

  const renderAuthContent = () => {
    switch (currentStep) {
      case 'PHONE_NUMBER':
        return (
          <PhoneLogin onOtpGenerationSuccess={handleOtpGenerationSuccess} />
        );
      case 'OTP':
        return (
          <OtpVerification
            phoneNumber={phoneNumber}
            onOtpVerificationSuccess={handleOtpVerificationSuccess}
          />
        );
      default:
        return null;
    }
  };

  const animationStyle = useAnimatedStyle(() => ({
    transform: [{translateY: animationTranslateY.value}],
  }));

  const authContentStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      animationTranslateY.value,
      [0, -height * 0.65], // From 0 to -65% of screen height
      [height, height * 0.35], // Start at 100% of screen height, end at 35%
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    return {
      transform: [{translateY}],
      opacity: interpolate(
        animationTranslateY.value,
        [0, -height * 0.3],
        [0, 1],
        {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        },
      ),
    };
  });

  const textStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      animationTranslateY.value,
      [0, -height * 0.65],
      [0, 1],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    const translateY = interpolate(progress, [0, 1], [height, height * 0.2], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    return {
      transform: [{translateY}],
      opacity: interpolate(progress, [0, 0.3], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    };
  });

  const onAnimationFinish = () => {
    setIsAnimationEnded(true);
    setTimeout(() => {
      StatusBar.setHidden(false);
      StatusBar.setBarStyle('dark-content');
    }, 1000);
  };

  return (
    <TouchableWithoutFeedback
      style={{paddingBottom: insets.bottom + 10}}
      onPress={Keyboard.dismiss}>
      <View style={styles.flex1}>
        {currentStep === 'OTP' && (
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <LeftArrowIcon width={44} height={44} color="black" />
          </TouchableOpacity>
        )}
        <Animated.View style={[styles.animationContainer, animationStyle]}>
          <LottieView
            ref={lottieRef}
            source={require('@/assets/animations/splashAnimation.json')}
            style={styles.animation}
            resizeMode="cover"
            autoPlay
            loop={false}
            speed={1}
            onAnimationFinish={onAnimationFinish}
          />
        </Animated.View>
        <Animated.View style={[styles.titleContainer, textStyle]}>
          {currentStep === 'PHONE_NUMBER' ? (
            <>
              <Text style={styles.title}>{t('SplashScreen.hey')}</Text>
              <Text style={styles.title}>
                {t('SplashScreen.welcome')}{' '}
                <Text style={styles.allyText}>{t('SplashScreen.ally')}</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.title}>
              {t('SplashScreen.verifyYourPhoneNumber')}
            </Text>
          )}
        </Animated.View>

        {isBottomSheetVisible && (
          <Animated.View style={[styles.authContainer, authContentStyle]}>
            {renderAuthContent()}
          </Animated.View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};
