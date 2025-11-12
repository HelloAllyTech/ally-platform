import React from 'react';
import {
  ActivityIndicator,
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
import {ActiveSimulationModal} from '@/screens/SimulationDetailsScreen/components';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import type {PathSimulation} from '@/types';

export interface SimulationDetailsModalProps {
  visible: boolean;
  simulation: PathSimulation | null;
  coverVideoUrl?: string | null;
  onClose: () => void;
  onStartSimulation: () => void;
  isCreatingRoom: boolean;
  showActiveSimulationModal: boolean;
  activeSimulationId: string | null;
  onCloseActiveSimulationModal: () => void;
}

export const SimulationDetailsModal: React.FC<SimulationDetailsModalProps> = ({
  visible,
  simulation,
  coverVideoUrl,
  onClose,
  onStartSimulation,
  isCreatingRoom,
  showActiveSimulationModal,
  activeSimulationId,
  onCloseActiveSimulationModal,
}) => {
  const {t} = useTranslate();

  if (!simulation) {
    return null;
  }

  const hasVideo = !!coverVideoUrl;
  const hasImage = !!simulation.thumbnailUrl;

  return (
    <>
      <Modal
        visible={visible}
        animationType="fade"
        transparent
        onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            {/* Loading Overlay */}
            {isCreatingRoom && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator
                  size="large"
                  color={colors.ds.neutral.white}
                />
                <Text style={styles.loadingText}>
                  {t('Simulations.creatingRoom')}
                </Text>
              </View>
            )}

            {/* Header - Fixed */}
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

            {/* Content Container - Bordered card with image, title, description */}
            <View style={styles.contentContainer}>
              {/* Fixed Media Section (Video or Image) - Not Scrollable */}
              <View style={styles.mediaContainer}>
                {hasVideo ? (
                  <VideoPreview
                    videoUrl={coverVideoUrl}
                    autoPlay={false}
                    shouldPause={false}
                  />
                ) : hasImage && simulation.thumbnailUrl ? (
                  <Image
                    source={{uri: simulation.thumbnailUrl}}
                    style={styles.coverImage}
                    resizeMode="cover"
                  />
                ) : null}
              </View>

              {/* Scrollable Content (Title + Description only) */}
              <ScrollView
                style={styles.scrollContainer}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                bounces={false}>
                {/* Title */}
                <Text style={styles.title}>{simulation.title}</Text>

                {/* Label */}
                <Text style={styles.fieldLabel}>
                  {t('Simulations.scenarioLabel')}
                </Text>

                {/* Description */}
                {/* TODO: Replace with actual description when ready */}
                {/* <Text style={styles.description}>{simulation.description}</Text> */}
                <Text style={styles.description}>
                  This is a dummy description to demonstrate scrolling behavior.
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
                  do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                  Ut enim ad minim veniam, quis nostrud exercitation ullamco
                  laboris nisi ut aliquip ex ea commodo consequat. Duis aute
                  irure dolor in reprehenderit in voluptate velit esse cillum
                  dolore eu fugiat nulla pariatur. Excepteur sint occaecat
                  cupidatat non proident, sunt in culpa qui officia deserunt
                  mollit anim id est laborum. Sed ut perspiciatis unde omnis
                  iste natus error sit voluptatem accusantium doloremque
                  laudantium, totam rem aperiam, eaque ipsa quae ab illo
                  inventore veritatis et quasi architecto beatae vitae dicta
                  sunt explicabo.
                </Text>
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

      {/* Active Simulation Conflict Modal */}
      {showActiveSimulationModal && activeSimulationId && (
        <ActiveSimulationModal
          visible={showActiveSimulationModal}
          onClose={onCloseActiveSimulationModal}
          scenarioSessionId={activeSimulationId}
        />
      )}
    </>
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
    borderRadius: '12@ms',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: '16@ms',
    paddingVertical: '12@ms',
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
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    overflow: 'hidden',
    backgroundColor: colors.ds.neutral.white,
  },
  mediaContainer: {
    width: '100%',
    padding: '12@ms',
  },
  coverImage: {
    width: '100%',
    height: '180@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.ds.grey[200],
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: '16@ms',
    paddingTop: '8@ms',
    paddingBottom: '16@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.headline.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginTop: '10@ms',
    marginBottom: '16@ms',
  },
  fieldLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '2@ms',
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    lineHeight: '22@ms',
    marginBottom: '6@ms',
  },
  buttonContainer: {
    backgroundColor: colors.ds.neutral.white,
    paddingTop: '12@ms',
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
    borderRadius: '12@ms',
  },
  loadingText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.neutral.white,
    marginTop: '12@ms',
  },
});
