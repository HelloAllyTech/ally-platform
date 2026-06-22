import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChangeImageIcon, RemoveImageIcon} from '@/assets/icons';
import {BottomSheet} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

interface ProfileImageOptionProps {
  icon: React.ReactNode;
  text: string;
  onPress: () => void;
  textColor?: string;
}

const ProfileImageOption: React.FC<ProfileImageOptionProps> = ({
  icon,
  text,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={styles.option}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={styles.optionIcon}>{icon}</View>
      <Text style={styles.optionText}>{text}</Text>
    </TouchableOpacity>
  );
};

interface ProfileImageBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onChangeImage: () => void;
  onRemoveImage: () => void;
  hasExistingImage: boolean;
}

export const ProfileImageBottomSheet: React.FC<
  ProfileImageBottomSheetProps
> = ({visible, onClose, onChangeImage, onRemoveImage, hasExistingImage}) => {
  const {t} = useTranslate();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={30}
      allowFullExpand={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('profile.settings.profile_image')}</Text>
        <View style={styles.optionsContainer}>
          <ProfileImageOption
            icon={<ChangeImageIcon width={24} height={24} />}
            text={
              hasExistingImage
                ? t('profile.settings.changeImage')
                : t('profile.settings.upload_image')
            }
            onPress={onChangeImage}
          />

          {hasExistingImage && (
            <ProfileImageOption
              icon={<RemoveImageIcon width={24} height={24} />}
              text={t('profile.settings.removeImage')}
              onPress={onRemoveImage}
            />
          )}
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingHorizontal: '24@ms',
    paddingTop: '8@mvs',
    paddingBottom: '32@mvs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    textAlign: 'center',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '16@mvs',
  },
  optionsContainer: {
    gap: '16@mvs',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
  },
  optionIcon: {
    width: '24@ms',
    height: '24@ms',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
