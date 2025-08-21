import React, {useEffect, useRef, useState} from 'react';
import {Animated, Image, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  CarouselVariant,
  defaultConfig,
  drawerConfig,
  SCREEN_WIDTH,
  SECURITY_CAROUSEL_SLIDES,
} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

import {Carousel} from './Carousel';
import {CarouselItem, CarouselRef, SecurityCarouselProps} from './types';

export const SecurityCarousel: React.FC<SecurityCarouselProps> = ({
  variant = CarouselVariant.DEFAULT,
}) => {
  const {t} = useTranslate();
  const carouselRef = useRef<CarouselRef>(null);
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const carouseConfig =
    variant === CarouselVariant.DRAWER ? drawerConfig : defaultConfig;

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, opacityAnim]);

  const handleSnapToItem = (index: number) => {
    opacityAnim.setValue(0);
    setActiveIndex(index);
  };

  const renderItem = (item: CarouselItem, index: number) => {
    const opacityStyle = {
      opacity: index === activeIndex ? opacityAnim : 0,
    };
    return (
      <View style={styles.slide}>
        <Animated.View style={[styles.imageContainer, opacityStyle]}>
          <Image
            resizeMode="contain"
            source={item.image}
            style={styles.image}
          />
        </Animated.View>
        <Animated.Text
          numberOfLines={2}
          style={[
            styles.slideTitle,
            opacityStyle,
            {color: carouseConfig.textColor},
          ]}>
          {t(item.textKey)}
        </Animated.Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, {width: carouseConfig.width}]}>
      <View
        style={[
          styles.carouselView,
          carouseConfig.isBlurView && styles.carouselViewBlur,
        ]}>
        <Carousel
          ref={carouselRef}
          data={SECURITY_CAROUSEL_SLIDES}
          renderItem={renderItem}
          onSnapToItem={handleSnapToItem}
          containerStyle={styles.carouselContainer}
          paginationActiveDotStyle={carouseConfig.paginationActiveDotStyle}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    position: 'relative',
    height: '330@ms',
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carouselView: {
    width: SCREEN_WIDTH - 80,
    paddingTop: '2@ms',
    borderRadius: '12@ms',
    height: '100%',
  },
  carouselViewBlur: {
    backgroundColor: colors.whiteTransparent10,
    zIndex: 2,
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderWidth: 0.5,
    borderColor: colors.white,
  },
  heading: {
    ...typography.headline.medium,
    color: colors.darkGray2,
    textAlign: 'center',
    marginBottom: '20@vs',
  },
  carouselContainer: {
    overflow: 'hidden',
  },
  slide: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2@ms',
  },
  imageContainer: {
    width: '100%',
    height: '280@ms',
    borderRadius: '10@ms',
    borderWidth: 0.3,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.white,
    borderColor: colors.black,
  },
  slideTitle: {
    ...fontFamily.REPLAY_PRO.BOLD,
    minHeight: '46@ms',
    fontSize: '22@ms',
    marginHorizontal: '10@ms',
    color: colors.white,
    textAlign: 'center',
    marginTop: '14@ms',
  },
});
