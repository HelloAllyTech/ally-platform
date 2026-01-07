import React, {useState} from 'react';
import {Image, Platform, Text, TouchableOpacity, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {LeftArrowIcon} from '@/assets/icons';
import {
  useAppNavigation,
  useProfileImage,
  useTranslate,
  useUser,
} from '@/hooks';
import {colors, fontFamily, fontWeights} from '@/theme';

import {ProfileImageBottomSheet} from './components/ProfileImageBottomSheet';

const isIOS = Platform.OS === 'ios';

export const ProfileSettingsScreen: React.FC = () => {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const {userData} = useUser();
  const {t} = useTranslate();
  const {name, email, profileImageUrl} = userData ?? {};

  const [isBottomSheetVisible, setIsBottomSheetVisible] = useState(false);

  const {profileImageUri, handleImagePicker, handleRemoveImage} =
    useProfileImage({
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

  const onRemoveImage = async () => {
    setIsBottomSheetVisible(false);
    await handleRemoveImage();
  };

  return (
    <View
      style={[
        styles.container,
        {paddingTop: insets.top, paddingBottom: insets.bottom},
      ]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <LeftArrowIcon color={colors.black} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {t('ProfileSettings.profile')}{' '}
          <Text style={styles.titleItalic}>
            {t('ProfileSettings.settings')}
          </Text>
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {profileImageUri ? (
              <Image
                source={{uri: profileImageUri}}
                style={styles.avatarImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{getInitial()}</Text>
              </View>
            )}
          </View>
          {profileImageUri ? (
            <TouchableOpacity
              style={styles.editButton}
              onPress={handleChangeImage}>
              <Text style={styles.editButtonText}>
                {t('ProfileSettings.edit')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={handleUploadImage}>
              <Text style={styles.uploadButtonText}>
                {t('ProfileSettings.uploadImage')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.fieldsSection}>
          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('ProfileSettings.name')}</Text>
            <View style={styles.fieldValue}>
              <Text style={styles.fieldValueText}>{name || '—'}</Text>
            </View>
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{t('ProfileSettings.email')}</Text>
            <View style={styles.fieldValue}>
              <Text style={styles.fieldValueText}>{email || '—'}</Text>
            </View>
          </View>
        </View>
      </View>

      <ProfileImageBottomSheet
        visible={isBottomSheetVisible}
        onClose={() => setIsBottomSheetVisible(false)}
        onChangeImage={onImagePicker}
        onRemoveImage={onRemoveImage}
        hasExistingImage={!!profileImageUri}
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
    paddingHorizontal: '21@ms',
    paddingVertical: '16@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  backButton: {
    marginRight: '16@ms',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    fontSize: ms(18),
    lineHeight: ms(32),
    fontWeight: fontWeights.light,
    textAlign: 'left',
    color: '#222222',
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
  uploadButton: {
    marginTop: '8@mvs',
  },
  uploadButtonText: {
    fontFamily: 'Roboto',
    fontSize: ms(14),
    lineHeight: ms(20),
    letterSpacing: ms(0.1),
    fontWeight: '500',
    color: colors.azureBlue,
  },
  editButton: {
    marginTop: '8@mvs',
  },
  editButtonText: {
    fontFamily: 'Roboto',
    fontSize: ms(14),
    lineHeight: ms(20),
    letterSpacing: ms(0.1),
    fontWeight: '500',
    color: colors.azureBlue,
  },
  fieldsSection: {
    gap: '24@mvs',
  },
  fieldContainer: {
    gap: '8@mvs',
  },
  fieldLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(14),
    lineHeight: ms(20),
    letterSpacing: ms(0.25),
    color: '#1A1A1A',
  },
  fieldValue: {
    paddingVertical: '8@mvs',
    paddingHorizontal: '8@ms',
    backgroundColor: colors.lightGray,
    borderRadius: '4@ms',
    borderWidth: ms(0.5),
    borderColor: colors.lightGray2,
  },
  fieldValueText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: ms(14),
    lineHeight: ms(20),
    letterSpacing: ms(0.25),
    color: 'rgba(0, 0, 0, 0.38)',
  },
});
