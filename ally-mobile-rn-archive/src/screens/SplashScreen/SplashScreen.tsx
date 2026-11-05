import React, {useEffect, useMemo, useRef, useState} from 'react';
import LottieView from 'lottie-react-native';
import {
  Keyboard,
  StatusBar,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {animations, LeftArrowIcon} from '@/assets';
import {ForceUpdateModal} from '@/components';
import {SCREEN_NAMES, USER_PERMISSIONS, WINDOW_HEIGHT} from '@/constants';
import {
  useCounselorChat,
  useForceUpdate,
  useHardwareBackPressHandler,
  useTranslate,
  useUser,
} from '@/hooks';
import {RootStackScreenProps} from '@/navigation';
import {useAppSelector} from '@/store/hooks';
import {colors} from '@/theme';

import {EmailLogin, OtpVerification} from './components';
import {styles} from './styles';
import {AuthStep} from './types';

export const SplashScreen: React.FC<
  RootStackScreenProps<typeof SCREEN_NAMES.SPLASH>
> = ({navigation}) => {
  const [isBottomSheetVisible, setIsBottomSheetVisible] = useState(false);
  const [isAnimationEnded, setIsAnimationEnded] = useState(false);
  const [isSheetFullyOpen, setIsSheetFullyOpen] = useState(false);

  const lottieRef = useRef<LottieView>(null);
  const insets = useSafeAreaInsets();
  const {t} = useTranslate();
  const {versionInfo} = useForceUpdate();
  const {checkAuth, isAuthenticated, isUserLoading, userData} = useUser();
  const permissions = useAppSelector(state => state.user.permissions);
  const {checkCounselorChat} = useCounselorChat({
    onActiveChatFound: () => {
      // Go directly to Listening
      if (!versionInfo?.isUpdateRequired) {
        navigation.reset({
          index: 1,
          routes: [
            {name: SCREEN_NAMES.CALL_LOG},
            {name: SCREEN_NAMES.LISTENING},
          ],
        });
      }
    },
    onNoActiveChatFound: () => {
      if (!versionInfo?.isUpdateRequired) {
        navigation.replace(SCREEN_NAMES.CALL_LOG);
      }
    },
  });

  const animationTranslateY = useSharedValue(0);

  const [currentStep, setCurrentStep] = useState<AuthStep>('EMAIL');
  const [email, setEmail] = useState('');
  const [otpExpiresIn, setOtpExpiresIn] = useState<number | undefined>();

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

  const displayBottomSheet = () => {
    setIsBottomSheetVisible(true);
    animationTranslateY.value = withTiming(
      -WINDOW_HEIGHT * 0.6,
      {duration: 1000},
      () => {
        runOnJS(setIsSheetFullyOpen)(true);
      },
    );
  };

  useEffect(() => {
    if (!isAnimationEnded || versionInfo?.isUpdateRequired) {
      return;
    }
    if (!isUserLoading && !isAuthenticated) {
      // Show the login button only when the bottom sheet is NOT visible
      if (!isBottomSheetVisible) {
        displayBottomSheet();
      }
    } else if (isAuthenticated) {
      // Bulk-created accounts must finish their profile before entering the app.
      if (userData?.profileCompleted === false) {
        navigation.replace(SCREEN_NAMES.COMPLETE_PROFILE);
      } else if (permissions?.includes(USER_PERMISSIONS.VIEW_COUNSELOR_CHAT)) {
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
    userData?.profileCompleted,
    permissions,
  ]);

  const handleOtpGenerationSuccess = async (
    emailAddress: string,
    expiresIn?: number,
  ) => {
    setEmail(emailAddress);
    setOtpExpiresIn(expiresIn);
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
          <EmailLogin
            onOtpGenerationSuccess={handleOtpGenerationSuccess}
            onLoginSuccess={handleOtpVerificationSuccess}
          />
        );
      case 'OTP':
        return (
          <OtpVerification
            email={email}
            onOtpVerificationSuccess={handleOtpVerificationSuccess}
            initialExpiresIn={otpExpiresIn}
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
      [0, -WINDOW_HEIGHT * 0.65], // From 0 to -65% of screen height
      [WINDOW_HEIGHT, WINDOW_HEIGHT * 0.35], // Start at 100% of screen height, end at 35%
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    return {
      transform: [{translateY}],
      opacity: interpolate(
        animationTranslateY.value,
        [0, -WINDOW_HEIGHT * 0.3],
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
      [0, -WINDOW_HEIGHT * 0.65],
      [0, 1],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    const translateY = interpolate(
      progress,
      [0, 1],
      [WINDOW_HEIGHT, WINDOW_HEIGHT * 0.2],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

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

  const renderLottieAnimation = useMemo(() => {
    return (
      <Animated.View style={[styles.animationContainer, animationStyle]}>
        <LottieView
          ref={lottieRef}
          source={animations.splashAnimation}
          style={styles.animation}
          resizeMode="cover"
          autoPlay={!isAnimationEnded}
          loop={false}
          speed={1}
          progress={isAnimationEnded ? 0.99 : 0}
          onAnimationFinish={onAnimationFinish}
        />
      </Animated.View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimationEnded]);

  return (
    <TouchableWithoutFeedback
      style={{paddingBottom: insets.bottom + 10}}
      onPress={Keyboard.dismiss}>
      <View style={styles.flex1}>
        {currentStep === 'OTP' && (
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <LeftArrowIcon width={44} height={44} color={colors.black} />
          </TouchableOpacity>
        )}
        {renderLottieAnimation}
        <Animated.View style={[styles.titleContainer, textStyle]}>
          {currentStep === 'EMAIL' ? (
            <>
              <Text style={styles.title}>{t('auth.login.greetingLine1')}</Text>
              <Text style={styles.title}>
                {t('auth.login.welcome')}{' '}
                <Text style={styles.allyText}>{t('common.appName')}</Text>
              </Text>
            </>
          ) : (
            <Text style={styles.title}>{t('auth.login.otp.title')}</Text>
          )}
        </Animated.View>

        {isSheetFullyOpen && (
          <LinearGradient
            colors={[colors.lightGray18, 'transparent']}
            locations={[0.0, 1.0]}
            start={{x: 0, y: 1}}
            end={{x: 0, y: 0}}
            style={styles.welcomeGradientContainer}
          />
        )}

        {isBottomSheetVisible && (
          <Animated.View style={[styles.authContainer, authContentStyle]}>
            {renderAuthContent()}
          </Animated.View>
        )}
        <ForceUpdateModal visible={versionInfo?.isUpdateRequired} />
      </View>
    </TouchableWithoutFeedback>
  );
};
