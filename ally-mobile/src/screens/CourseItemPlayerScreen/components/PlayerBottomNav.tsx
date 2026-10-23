import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowRight, LeftArrowIcon} from '@/assets';
import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

export interface PlayerBottomNavProps {
  hasPrev: boolean;
  hasNext: boolean;
  /** Whether the current item's completion gate is satisfied. */
  canAdvance: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** True on the very last item — the Next button becomes "Finish". */
  isLastItem: boolean;
}

/**
 * Bottom navigation for the player: Prev on the left, Next on the right.
 * Next is disabled until the item reports completion. Mirrors ally-web's
 * `PlayerBottomNav` (the pulse-on-unlock animation is a deliberate
 * cosmetic scope-cut for this v1 port).
 */
export const PlayerBottomNav: React.FC<PlayerBottomNavProps> = ({
  hasPrev,
  hasNext,
  canAdvance,
  onPrev,
  onNext,
  isLastItem,
}) => {
  const {t} = useTranslate();
  const nextDisabled = !canAdvance || (!hasNext && !isLastItem);
  const nextLabel = isLastItem
    ? t('courses.player.finish')
    : t('courses.player.next');

  return (
    <View style={styles.footer}>
      <View style={styles.buttonWrap}>
        <Button
          testID="player-prev-button"
          label={t('courses.player.prev')}
          variant="secondary"
          onPress={onPrev}
          isDisabled={!hasPrev}
          IconLeft={LeftArrowIcon}
          iconSize={16}
        />
      </View>
      <View style={styles.buttonWrap}>
        <Button
          testID="player-next-button"
          label={nextLabel}
          variant="primary"
          onPress={onNext}
          isDisabled={nextDisabled}
          IconRight={ArrowRight}
          iconSize={16}
          iconColor={colors.ds.neutral.white}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  footer: {
    flexDirection: 'row',
    gap: '12@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '12@ms',
    borderTopWidth: 0.5,
    borderTopColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
  },
  buttonWrap: {
    flex: 1,
  },
});
