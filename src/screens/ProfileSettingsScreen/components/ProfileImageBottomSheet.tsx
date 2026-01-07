import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ChangeImageIcon, RemoveImageIcon} from '@/assets/icons';
import {BottomSheet} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

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
  textColor = '#000000',
}) => {
  return (
    <TouchableOpacity
      style={styles.option}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={styles.optionIcon}>{icon}</View>
      <Text style={[styles.optionText, {color: textColor}]}>{text}</Text>
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
        <Text style={styles.title}>{t('ProfileSettings.profileImage')}</Text>
        <View style={styles.optionsContainer}>
          <ProfileImageOption
            icon={<ChangeImageIcon width={24} height={24} />}
            text={
              hasExistingImage
                ? t('ProfileSettings.changeImage')
                : t('ProfileSettings.uploadImage')
            }
            onPress={onChangeImage}
            textColor="#000000"
          />

          {hasExistingImage && (
            <ProfileImageOption
              icon={<RemoveImageIcon width={24} height={24} />}
              text={t('ProfileSettings.removeImage')}
              onPress={onRemoveImage}
              textColor="rgba(0, 0, 0, 0.87)"
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
    fontSize: ms(18),
    lineHeight: ms(32),
    textAlign: 'center',
    color: '#222222',
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
    fontSize: ms(14),
    lineHeight: ms(18.2),
    letterSpacing: ms(0.15),
  },
});
