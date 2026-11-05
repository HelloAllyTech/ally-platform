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
import {Button, CustomDropdown, VideoPreview} from '@/components';
import {isIOS} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, radius, typography} from '@/theme';
import type {TriggerWarning} from '@/types';
import {getTriggerWarningNames} from '@/utils';

export interface SimulationDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  coverVideoUrl?: string | null;
  order?: number;
  triggerWarnings?: TriggerWarning[];
  headerTitle?: string;
  onStartSimulation?: () => void;
  isCreatingRoom?: boolean;
  fitContent?: boolean;
  selectedLanguage?: string;
  languageOptions?: string[];
  onLanguageSelect?: (language: string) => void;
  isLanguageDropdownOpen?: boolean;
  setIsLanguageDropdownOpen?: (open: boolean) => void;
}

export const SimulationDetailsModal: React.FC<SimulationDetailsModalProps> = ({
  visible,
  onClose,
  title,
  description,
  coverImageUrl,
  coverVideoUrl,
  order,
  triggerWarnings,
  headerTitle,
  onStartSimulation,
  isCreatingRoom = false,
  fitContent = false,
  selectedLanguage = '',
  languageOptions = [],
  onLanguageSelect,
  isLanguageDropdownOpen = false,
  setIsLanguageDropdownOpen,
}) => {
  const {t} = useTranslate();

  const triggerWarningNames = getTriggerWarningNames(triggerWarnings);
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalContainer,
            fitContent && styles.modalContainerFitContent,
          ]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {headerTitle ? (
                headerTitle
              ) : (
                <>
                  {t('common.start')}{' '}
                  <Text style={styles.headerTitleItalic}>
                    {t('common.simulation')}
                  </Text>
                </>
              )}
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

          <View
            style={[
              styles.contentContainer,
              fitContent && styles.contentContainerFitContent,
            ]}>
            {/* Language Dropdown - Above Image */}
            {languageOptions.length > 0 && onLanguageSelect && (
              <View style={styles.languageDropdownContainer}>
                <CustomDropdown
                  value={selectedLanguage}
                  options={languageOptions}
                  onSelect={onLanguageSelect}
                  isOpen={isLanguageDropdownOpen}
                  setIsOpen={setIsLanguageDropdownOpen || (() => {})}
                  disabled={isCreatingRoom}
                />
              </View>
            )}

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
              style={[
                styles.scrollContainer,
                fitContent && styles.scrollContainerFitContent,
              ]}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}>
              {order !== undefined && (
                <Text style={styles.orderLabel}>
                  {t('common.simulation')} {order}
                </Text>
              )}
              {title && <Text style={styles.title}>{title}</Text>}

              {description && (
                <>
                  <Text style={styles.scenarioLabel}>
                    {t('learn.scenario.scenarioLabel')}
                  </Text>

                  <Text style={styles.description}>{description}</Text>
                </>
              )}

              {triggerWarningNames.length > 0 && (
                <>
                  <Text style={styles.triggerWarningLabel}>
                    {t('common.triggerWarnings')}:
                  </Text>
                  <View style={styles.chipsContainer}>
                    {triggerWarningNames.map((warning, index) => (
                      <View key={index} style={styles.chip}>
                        <Text style={styles.chipText}>{warning}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>

          {onStartSimulation && (
            <View style={styles.buttonContainer}>
              <View style={styles.ctaWrapper}>
                <Button
                  label={`${t('common.start')} ${t('common.simulation')}`}
                  onPress={onStartSimulation}
                  isLoading={isCreatingRoom}
                  isDisabled={isCreatingRoom}
                />
              </View>
            </View>
          )}
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
  modalContainerFitContent: {
    height: 'auto',
    maxHeight: '80%',
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
    ...typography.display.small,
    fontWeight: fontWeights.light,
    color: colors.ds.typography.highEmphasis,
    maxWidth: '90%',
  },
  headerTitleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontWeight: fontWeights.light,
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
  contentContainerFitContent: {
    flex: 0,
    flexShrink: 1,
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
  scrollContainerFitContent: {
    flex: 0,
    flexShrink: 1,
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
  triggerWarningLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    marginBottom: '8@ms',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '6@ms',
    marginBottom: '8@ms',
  },
  chip: {
    backgroundColor: colors.ds.grey[50],
    borderRadius: radius.full,
    paddingHorizontal: '8@ms',
    paddingVertical: '4@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.grey[300],
  },
  chipText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.label.large,
    color: colors.ds.typography.mediumEmphasis,
  },
  languageDropdownContainer: {
    marginBottom: '12@ms',
    paddingHorizontal: '0@ms',
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
