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

import {LeftArrowIcon} from '@/assets';
import {PrimaryButton} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {
  useCounselorChat,
  useHardwareBackPressHandler,
  useTranslate,
  useUser,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {UserRole} from '@/types';

import {EmailLogin, OtpVerification} from './components';
import {styles} from './styles';
import {AuthStep} from './types';

const {height} = Dimensions.get('screen');

export const SplashScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.SPLASH>
> = ({navigation}) => {
  const [isBottomSheetVisible, setIsBottomSheetVisible] = useState(false);
  const [isAnimationEnded, setIsAnimationEnded] = useState(false);
  const [isLoginButtonVisible, setIsLoginButtonVisible] = useState(false);
  const lottieRef = useRef<LottieView>(null);
  const insets = useSafeAreaInsets();
  const {checkAuth, isAuthenticated, isUserLoading, userData} = useUser();
  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: () => {
      // Go directly to Listening
      navigation.reset({
        index: 1,
        routes: [{name: SCREEN_NAMES.CALL_LOG}, {name: SCREEN_NAMES.LISTENING}],
      });
    },
    onNoActiveChatFound: () => {
      navigation.replace(SCREEN_NAMES.CALL_LOG);
    },
  });
  const {t} = useTranslate();

  const animationTranslateY = useSharedValue(0);

  const [currentStep, setCurrentStep] = useState<AuthStep>('EMAIL');
  const [email, setEmail] = useState('');

  useHardwareBackPressHandler(() => {
    if (currentStep === 'OTP') {
      setCurrentStep('EMAIL');
      return true;
    }
    return false;
  });

  useEffect(() => {
    StatusBar.setHidden(true); // Hide status bar
    // Play lottie animation from frame 0 to 200 and freeze at the end frame
    lottieRef.current?.play(0, 200);
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLoginPress = () => {
    setIsLoginButtonVisible(false);
    setIsBottomSheetVisible(true);
    animationTranslateY.value = withTiming(-height * 0.6, {
      duration: 1000,
    });
  };

  useEffect(() => {
    if (!isAnimationEnded) {
      return;
    }

    if (!isUserLoading && !isAuthenticated) {
      // Show the login button only when the bottom sheet is NOT visible
      if (!isBottomSheetVisible) {
        setIsLoginButtonVisible(true);
      }
    } else if (isAuthenticated) {
      if (userData?.role === UserRole.COUNSELOR) {
        checkCounselorChat();
      } else {
        navigation.replace(SCREEN_NAMES.CALL_LOG);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAnimationEnded,
    isAuthenticated,
    isUserLoading,
    isBottomSheetVisible,
    userData?.role,
  ]);

  const handleOtpGenerationSuccess = async (emailAddress: string) => {
    setEmail(emailAddress);
    setCurrentStep('OTP');
  };

  const handleOtpVerificationSuccess = () => {
    checkAuth();
  };

  const handleBackPress = () => {
    setCurrentStep('EMAIL');
  };

  const renderAuthContent = () => {
    switch (currentStep) {
      case 'EMAIL':
        return (
          <EmailLogin onOtpGenerationSuccess={handleOtpGenerationSuccess} />
        );
      case 'OTP':
        return (
          <OtpVerification
            email={email}
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
          {currentStep === 'EMAIL' ? (
            <>
              <Text style={styles.title}>{t('SplashScreen.hey')}</Text>
              <Text style={styles.title}>
                {t('SplashScreen.welcome')}{' '}
                <Text style={styles.allyText}>{t('SplashScreen.ally')}</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.title}>
              {t('SplashScreen.verifyYourEmail')}
            </Text>
          )}
        </Animated.View>

        {isLoginButtonVisible && (
          <PrimaryButton
            label={t('SplashScreen.login')}
            onPress={onLoginPress}
            customContainerStyle={styles.loginButtonContainer}
            customTextStyle={styles.loginButtonText}
          />
        )}

        {isBottomSheetVisible && (
          <Animated.View style={[styles.authContainer, authContentStyle]}>
            {renderAuthContent()}
          </Animated.View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};
