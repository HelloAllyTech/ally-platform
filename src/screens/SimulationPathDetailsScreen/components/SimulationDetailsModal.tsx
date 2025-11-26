import React from 'react';
import {
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {PrimaryButton, VideoPreview} from '@/components';
import {isIOS} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import type {PathScenario} from '@/types';

export interface SimulationDetailsModalProps {
  visible: boolean;
  simulation: PathScenario | null;
  onClose: () => void;
  onStartSimulation: () => void;
  isCreatingRoom: boolean;
}

export const SimulationDetailsModal: React.FC<SimulationDetailsModalProps> = ({
  visible,
  simulation,
  onClose,
  onStartSimulation,
  isCreatingRoom,
}) => {
  const {t} = useTranslate();

  if (!simulation) {
    return null;
  }
  const {coverImageUrl, coverVideoUrl, title, description, order} = simulation;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {t('Simulations.start')}{' '}
              <Text style={styles.headerTitleItalic}>
                {t('Simulations.simulation')}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              disabled={isCreatingRoom}>
              <CloseIcon
                width={20}
                height={20}
                color={colors.ds.typography.mediumEmphasis}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.contentContainer}>
            <View style={styles.mediaContainer}>
              {coverVideoUrl ? (
                <VideoPreview
                  videoUrl={coverVideoUrl}
                  autoPlay={false}
                  shouldPause={false}
                />
              ) : coverImageUrl ? (
                <Image
                  source={{uri: coverImageUrl}}
                  style={styles.coverImage}
                  resizeMode="cover"
                />
              ) : null}
            </View>

            <ScrollView
              style={styles.scrollContainer}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}>
              <Text style={styles.orderLabel}>
                {t('Simulations.simulation')} {order}
              </Text>
              <Text style={styles.title}>{title}</Text>

              {/* Label */}
              <Text style={styles.scenarioLabel}>
                {t('Simulations.scenarioLabel')}
              </Text>

              {/* Description */}
              <Text style={styles.description}>{description}</Text>
            </ScrollView>
          </View>

          {/* Fixed Button Container at Bottom - Clips content above */}
          <View style={styles.buttonContainer}>
            <View style={styles.ctaWrapper}>
              <PrimaryButton
                label={`${t('Simulations.start')} ${t('Simulations.simulation')}`}
                onPress={onStartSimulation}
                isLoading={isCreatingRoom}
                isDisabled={isCreatingRoom}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = ScaledSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.ds.blackAlpha[700],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '20@ms',
  },
  modalContainer: {
    width: '100%',
    maxWidth: '500@ms',
    height: '80%',
    backgroundColor: colors.ds.neutral.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: '16@ms',
    paddingTop: '16@ms',
  },
  headerTitle: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: '18@ms',
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  headerTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  closeButton: {
    padding: '4@ms',
  },
  contentContainer: {
    flex: 1,
    marginHorizontal: '16@ms',
    marginTop: '16@ms',
    marginBottom: '16@ms',
    borderWidth: 0.35,
    borderColor: colors.ds.stroke.primary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.ds.neutral.white,
  },
  mediaContainer: {
    width: '100%',
    padding: '12@ms',
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '180@ms',
    borderRadius: radius.lg,
    backgroundColor: colors.ds.grey[200],
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: '16@ms',
    paddingBottom: '16@ms',
  },
  orderLabel: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.lowEmphasis,
    marginTop: '12@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
    marginVertical: '8@ms',
  },
  scenarioLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '4@ms',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '6@ms',
  },
  buttonContainer: {
    backgroundColor: colors.ds.neutral.white,
    paddingBottom: '16@ms',
  },
  ctaWrapper: {
    paddingHorizontal: '16@ms',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.ds.blackAlpha[700],
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    borderRadius: radius.lg,
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.neutral.white,
    marginTop: '12@ms',
  },
});
