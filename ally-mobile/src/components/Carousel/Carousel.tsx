import {forwardRef, useImperativeHandle, useRef, useState} from 'react';
import {View} from 'react-native';
import CarouselLib, {ICarouselInstance} from 'react-native-reanimated-carousel';
import {ScaledSheet} from 'react-native-size-matters';

import {SCREEN_WIDTH} from '@/constants';

import {Pagination} from './Pagination';
import type {CarouselProps, CarouselRef} from './types';

export const Carousel = forwardRef<CarouselRef, CarouselProps>(
  (
    {
      data,
      renderItem,
      width = SCREEN_WIDTH - 40,
      height = 320,
      autoPlay = true,
      autoPlayInterval = 4000,
      loop = true,
      enabled = true,
      showPagination = true,
      paginationStyle,
      paginationDotStyle,
      paginationActiveDotStyle,
      containerStyle,
      contentContainerStyle,
      onSnapToItem,
      mode = 'parallax',
      testID,
    },
    ref,
  ) => {
    const carouselRef = useRef<ICarouselInstance>(null);
    const [currentIndex, setCurrentIndex] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        scrollTo: (index: number, animated = true) => {
          carouselRef.current?.scrollTo({index, animated});
        },
        scrollToNext: (animated = true) => {
          const nextIndex = (currentIndex + 1) % (data?.length || 1);
          carouselRef.current?.scrollTo({index: nextIndex, animated});
        },
        scrollToPrev: (animated = true) => {
          const prevIndex =
            currentIndex === 0 ? (data?.length || 1) - 1 : currentIndex - 1;
          carouselRef.current?.scrollTo({index: prevIndex, animated});
        },
        getCurrentIndex: () => currentIndex,
        getCarouselInstance: () => carouselRef.current,
      }),
      [currentIndex, data?.length],
    );

    const handleSnapToItem = (index: number) => {
      setCurrentIndex(index);
      onSnapToItem?.(index);
    };

    if (!(data?.length > 0)) return null;

    /**
     * `TCarouselProps` is a discriminated union on `mode` — each mode pairs
     * with its own `modeConfig` shape — so handing it a union-typed `mode`
     * variable matches no single branch and the whole props object is
     * rejected. Narrowing here picks a branch without asserting anything
     * false: this wrapper never passes `modeConfig`, so all three values are
     * equally valid and only inference was in the way.
     */
    const modeProp = mode === 'parallax' ? {mode: 'parallax' as const} : {mode};

    return (
      <View style={[styles.container, containerStyle]} testID={testID}>
        <View style={[styles.carouselContainer, contentContainerStyle]}>
          <CarouselLib
            ref={carouselRef}
            width={width}
            height={height}
            data={data}
            renderItem={({item, index}) => renderItem(item, index)}
            autoPlay={autoPlay}
            autoPlayInterval={autoPlayInterval}
            loop={loop}
            enabled={enabled}
            {...modeProp}
            onSnapToItem={handleSnapToItem}
          />
        </View>
        {showPagination && (
          <Pagination
            totalItems={data.length}
            currentIndex={currentIndex}
            style={paginationStyle}
            inactiveDotStyle={paginationDotStyle}
            activeDotStyle={paginationActiveDotStyle}
          />
        )}
      </View>
    );
  },
);

const styles = ScaledSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  carouselContainer: {
    overflow: 'hidden',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    height: '300@ms',
  },
});
