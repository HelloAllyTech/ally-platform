import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {
  Button,
  CustomModal,
  CustomSwitch,
  getLabelFromCode,
  LanguageSelectorSheet,
} from '@/components';
import {env} from '@/config/env';
import {
  useAppNavigation,
  useLeaderboardNotification,
  useProfileImage,
  useTranslate,
  useUser,
} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {UserRole} from '@/types';

import {ProfileImageBottomSheet} from './components/ProfileImageBottomSheet';

const isIOS = Platform.OS === 'ios';

export const ProfileSettingsScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {userData} = useUser();
  const {t} = useTranslate();
  const {name, email, profileImageUrl} = userData ?? {};
  const [isBottomSheetVisible, setIsBottomSheetVisible] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isLanguageSheetOpen, setIsLanguageSheetOpen] = useState(false);
  const {i18n: i18nInstance} = useTranslation();
  const currentLanguageLabel = getLabelFromCode(
    i18nInstance.resolvedLanguage ?? i18nInstance.language ?? 'en',
  );
  const isLearner = userData?.role === UserRole.LEARNER;

  const {leaderboardNotifEnabled, handleLeaderboardNotifToggle} =
    useLeaderboardNotification({isLearner});

  const {
    previewImageUri,
    isSaving,
    hasUnsavedChanges,
    handleImagePicker,
    handleRemoveImage,
    handleSave,
    resetToSavedState,
  } = useProfileImage({
    currentProfileImageUrl: profileImageUrl,
  });

  // Get the first letter of the user's name for the placeholder
  const getInitial = () => {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  };

  const handleUploadImage = () => {
    setIsBottomSheetVisible(true);
  };

  const handleChangeImage = () => {
    setIsBottomSheetVisible(true);
  };

  const onImagePicker = () => {
    setIsBottomSheetVisible(false);
    handleImagePicker();
  };

  const onRemoveImage = () => {
    setIsBottomSheetVisible(false);
    handleRemoveImage();
  };

  const handleBackPress = () => {
    if (hasUnsavedChanges) {
      setShowConfirmDialog(true);
    } else {
      navigation.goBack();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmDialog(false);
    resetToSavedState();
    navigation.goBack();
  };

  const handleCancelDiscard = () => {
    setShowConfirmDialog(false);
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <LeftArrowIcon color={colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.settings.title')}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {previewImageUri ? (
              <Image
                source={{uri: previewImageUri}}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{getInitial()}</Text>
              </View>
            )}
            {isSaving && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.azureBlue} />
              </View>
            )}
          </View>
          <Text style={styles.imageRequirementsText}>
            {t('profile.settings.upload_hint')}
          </Text>
          {previewImageUri ? (
            <TouchableOpacity
              style={styles.editButton}
              onPress={handleChangeImage}
              disabled={isSaving}>
              <Text style={styles.editButtonText}>
                {t('profile.settings.upload_image')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.editButton}
              onPress={handleUploadImage}
              disabled={isSaving}>
              <Text style={styles.editButtonText}>
                {t('profile.settings.upload_image')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.fieldsSection}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('profile.settings.name')}</Text>

            <View style={styles.fieldValue}>
              <Text style={styles.fieldValueText}>{name || '—'}</Text>
            </View>
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('profile.settings.email')}</Text>
            <View style={styles.fieldValue}>
              <Text style={styles.fieldValueText}>{email || '—'}</Text>
            </View>
          </View>

          {env.LANGUAGE_SELECTOR_FLAG && (
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>
                {t('profile.settings.language')}
              </Text>
              <TouchableOpacity
                style={styles.fieldValueTouchable}
                onPress={() => setIsLanguageSheetOpen(true)}
                activeOpacity={0.7}>
                <Text style={styles.fieldValueText}>
                  {currentLanguageLabel}
                </Text>
                <Text style={styles.fieldValueChevron}>›</Text>
              </TouchableOpacity>
            </View>
          )}

          {isLearner && (
            <View style={styles.notifToggleContainer}>
              <Text style={styles.fieldLabel}>
                {t('profile.settings.leaderboardNotification')}
              </Text>
              <CustomSwitch
                value={leaderboardNotifEnabled}
                onToggle={handleLeaderboardNotifToggle}
              />
            </View>
          )}
        </View>
      </View>

      {hasUnsavedChanges && (
        <View style={styles.saveButtonContainer}>
          <Button
            label={t('common.save')}
            onPress={handleSave}
            isLoading={isSaving}
            customContainerStyle={styles.saveButton}
          />
        </View>
      )}

      <ProfileImageBottomSheet
        visible={isBottomSheetVisible}
        onClose={() => setIsBottomSheetVisible(false)}
        onChangeImage={onImagePicker}
        onRemoveImage={onRemoveImage}
        hasExistingImage={!!previewImageUri}
      />

      {env.LANGUAGE_SELECTOR_FLAG && (
        <LanguageSelectorSheet
          visible={isLanguageSheetOpen}
          onClose={() => setIsLanguageSheetOpen(false)}
        />
      )}

      <CustomModal
        visible={showConfirmDialog}
        onClose={handleCancelDiscard}
        title={t('common.unsavedChanges')}
        description={t('common.unsavedChangesDescription')}
        primaryButtonText={t('common.discard')}
        secondaryButtonText={t('common.cancel')}
        onPrimaryPress={handleConfirmDiscard}
        onSecondaryPress={handleCancelDiscard}
        primaryTextColor={colors.brightRed}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '16@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ds.stroke.primary,
  },
  backButton: {
    marginRight: '16@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    ...typography.display.small,
    fontWeight: fontWeights.light,
    textAlign: 'left',
    color: colors.ds.typography.highEmphasis,
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    fontWeight: fontWeights.light,
    fontStyle: isIOS ? 'italic' : 'normal',
  },
  content: {
    flex: 1,
    paddingHorizontal: '24@ms',
    paddingTop: '32@mvs',
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: '40@mvs',
  },
  avatarContainer: {
    width: '116@ms',
    height: '116@ms',
    borderRadius: '58@ms',
    overflow: 'hidden',
    marginBottom: '16@mvs',
    borderWidth: ms(0.3),
    borderColor: colors.lightGray2,
    backgroundColor: colors.white,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.lightGray2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(32),
    lineHeight: ms(41.6),
    color: '#757575',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: '58@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRequirementsText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
    marginTop: '8@mvs',
    marginBottom: '4@mvs',
    textAlign: 'center',
  },
  editButton: {
    marginTop: '4@mvs',
  },
  editButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.medium,
    fontWeight: '500',
    color: colors.ds.theme.primary,
  },
  fieldsSection: {
    gap: '24@mvs',
  },
  fieldContainer: {
    gap: '8@mvs',
  },
  fieldLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  fieldValue: {
    paddingVertical: '8@mvs',
    paddingHorizontal: '8@ms',
    backgroundColor: colors.lightGray,
    borderRadius: '4@ms',
    borderWidth: ms(0.5),
    borderColor: colors.lightGray2,
  },
  fieldValueTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: '8@mvs',
    paddingHorizontal: '8@ms',
    backgroundColor: colors.lightGray,
    borderRadius: '4@ms',
    borderWidth: ms(0.5),
    borderColor: colors.lightGray2,
  },
  fieldValueText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },
  fieldValueChevron: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '18@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  saveButtonContainer: {
    paddingHorizontal: '24@ms',
    paddingBottom: '24@mvs',
    paddingTop: '16@mvs',
  },
  saveButton: {
    width: '100%',
  },
  notifToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
