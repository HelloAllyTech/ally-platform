import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {useBadge} from '@/hooks/useBadge';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export const BadgePopup = () => {
  const {currentBadge, isFirstBadge, isBadgesLoading, closeBadge} = useBadge();

  const {t} = useTranslation();
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  useEffect(() => {
    if (currentBadge) {
      setIsLayoutReady(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBadge?.id]);

  const handleImageContainerLayout = useCallback(() => {
    requestAnimationFrame(() => {
      setIsLayoutReady(true);
    });
  }, []);

  const renderConfetti = () => {
    return <ConfettiCannon fadeOut count={100} origin={{x: 0, y: 0}} />;
  };

  const shouldShowModal = currentBadge !== null;

  return (
    <Modal
      visible={shouldShowModal}
      transparent
      animationType="none"
      onRequestClose={closeBadge}
      statusBarTranslucent
      presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        {isBadgesLoading ? (
          <ActivityIndicator size="small" color={colors.ds.theme.primary} />
        ) : currentBadge ? (
          <View style={styles.container}>
            <TouchableOpacity onPress={closeBadge} style={[styles.closeButton]}>
              <CloseIcon height={24} width={24} />
            </TouchableOpacity>
            <View style={styles.content}>
              {currentBadge.imageUrl && (
                <View
                  style={styles.imageContainer}
                  onLayout={handleImageContainerLayout}>
                  {isLayoutReady ? (
                    <Image
                      key={currentBadge.id}
                      source={{uri: currentBadge.imageUrl}}
                      style={styles.badgeImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <ActivityIndicator
                      size="small"
                      color={colors.ds.theme.primary}
                    />
                  )}
                </View>
              )}
              <Text style={styles.earnedNewBadge}>
                {t('Achievements.earnedNewBadge')}
              </Text>
              <Text style={styles.title}>{currentBadge.name}</Text>
              <Text style={styles.description}>{currentBadge.description}</Text>
            </View>
          </View>
        ) : null}
      </View>
      {isFirstBadge && shouldShowModal && renderConfetti()}
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: colors.white,
    borderRadius: '12@s',
    padding: '16@s',
    width: '60%',
  },
  closeButton: {
    position: 'absolute',
    top: '8@s',
    right: '8@s',
  },
  content: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    width: '100@s',
    height: '100@s',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: colors.ds.grey[100],
    marginVertical: '8@s',
  },
  badgeImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
  earnedNewBadge: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginBottom: '8@s',
  },
});
