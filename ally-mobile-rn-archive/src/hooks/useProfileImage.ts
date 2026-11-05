import {useCallback, useEffect, useState} from 'react';
import {
  ImagePickerResponse,
  launchImageLibrary,
} from 'react-native-image-picker';

import {useErrorToast} from '@/components';
import {MAX_PROFILE_IMAGE_SIZE} from '@/constants';
import {
  useDeleteProfileImageMutation,
  useGetProfileImagePresignedUrlMutation,
  useUpdateProfileImageMutation,
} from '@/services/authApi';
import {uploadImageToS3} from '@/utils/imageUpload';
import {logger} from '@/utils/logger';

interface UseProfileImageOptions {
  currentProfileImageUrl?: string | null;
  onSaveSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseProfileImageReturn {
  previewImageUri: string | null;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  handleImagePicker: () => void;
  handleRemoveImage: () => void;
  handleSave: () => Promise<void>;
  resetToSavedState: () => void;
}

export const useProfileImage = ({
  currentProfileImageUrl,
  onSaveSuccess,
  onError,
}: UseProfileImageOptions): UseProfileImageReturn => {
  const {showErrorToast} = useErrorToast();
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedImageAsset, setSelectedImageAsset] =
    useState<ImagePickerResponse['assets']>(undefined);

  const [getPresignedUrl] = useGetProfileImagePresignedUrlMutation();
  const [updateProfileImage] = useUpdateProfileImageMutation();
  const [deleteProfileImage] = useDeleteProfileImageMutation();

  const normalizeProfileImageUrl = useCallback(
    (url: string | null | undefined): string | null => {
      if (!url || url.trim() === '') {
        return null;
      }
      return url;
    },
    [],
  );

  useEffect(() => {
    setPreviewImageUri(normalizeProfileImageUrl(currentProfileImageUrl));
  }, [currentProfileImageUrl, normalizeProfileImageUrl]);

  const hasUnsavedChanges = useCallback(() => {
    const normalizedSavedUrl = normalizeProfileImageUrl(currentProfileImageUrl);
    return previewImageUri !== normalizedSavedUrl;
  }, [previewImageUri, currentProfileImageUrl, normalizeProfileImageUrl]);

  const handleImagePicker = useCallback(() => {
    launchImageLibrary(
      {
        mediaType: 'photo',
        restrictMimeTypes: ['image/jpeg', 'image/png'],
        quality: 0.8,
        maxWidth: 800,
        maxHeight: 800,
      },
      async (response: ImagePickerResponse) => {
        if (response.didCancel || response.errorCode) {
          return;
        }
        if (response.assets && response.assets[0]) {
          const asset = response.assets[0];
          if (!asset.uri) {
            return;
          }

          const MAX_FILE_SIZE = MAX_PROFILE_IMAGE_SIZE;
          const fileSize = asset.fileSize || 0;
          if (fileSize > MAX_FILE_SIZE) {
            const error = new Error(
              'Image size must be less than 2MB. Please select a smaller image.',
            );
            showErrorToast(error, 'errors.uploadProfileImage');
            onError?.(error);
            return;
          }

          let width = asset.width || 0;
          let height = asset.height || 0;

          if (width > 0 && height > 0 && width !== height) {
            const error = new Error(
              'Image must be square (1:1 aspect ratio). Please select a square image.',
            );
            showErrorToast(error, 'errors.uploadProfileImage');
            onError?.(error);
            return;
          }

          setPreviewImageUri(asset.uri);
          setSelectedImageAsset(response.assets);
        }
      },
    );
  }, [showErrorToast, onError]);

  const handleRemoveImage = useCallback(() => {
    setPreviewImageUri(null);
    setSelectedImageAsset(undefined);
  }, []);

  const handleSave = async () => {
    if (!hasUnsavedChanges()) {
      return;
    }

    setIsSaving(true);
    try {
      const normalizedSavedUrl = normalizeProfileImageUrl(
        currentProfileImageUrl,
      );

      const isRemoveAction =
        previewImageUri === null && normalizedSavedUrl !== null;
      const isUploadAction =
        previewImageUri !== null &&
        previewImageUri !== normalizedSavedUrl &&
        selectedImageAsset?.[0];

      if (isRemoveAction) {
        if (normalizedSavedUrl) {
          await deleteProfileImage({
            profileImageUrl: normalizedSavedUrl,
          }).unwrap();
        }
        await updateProfileImage({
          profileImageUrl: '',
        }).unwrap();
        setPreviewImageUri(null);
        setSelectedImageAsset(undefined);
        onSaveSuccess?.();
      } else if (isUploadAction && selectedImageAsset?.[0]) {
        const asset = selectedImageAsset[0];
        const uri = asset.uri;
        const fileName = asset.fileName || `profile-${Date.now()}.jpg`;
        const fileSize = asset.fileSize || 0;
        const type = asset.type || 'image/jpeg';

        if (!uri) {
          throw new Error('Invalid image URI');
        }

        const presignedResponse = await getPresignedUrl({
          fileName,
          fileSize,
          contentType: type,
        }).unwrap();

        const uploadSuccess = await uploadImageToS3(
          uri,
          presignedResponse.presignedUrl,
          type,
        );

        if (!uploadSuccess) {
          throw new Error('Failed to upload image to S3');
        }

        const s3Url = presignedResponse.profileImageUrl;

        await updateProfileImage({
          profileImageUrl: s3Url,
        }).unwrap();

        if (normalizedSavedUrl) {
          try {
            await deleteProfileImage({
              profileImageUrl: normalizedSavedUrl,
            }).unwrap();
          } catch (error) {
            logger.warn(`Failed to delete old profile image: ${error}`);
          }
        }

        setPreviewImageUri(s3Url);
        setSelectedImageAsset(undefined);
        onSaveSuccess?.();
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      logger.error(`Error saving profile image: ${errorObj}`);
      showErrorToast(errorObj, 'errors.uploadProfileImage');
      onError?.(errorObj);
    } finally {
      setIsSaving(false);
    }
  };

  const resetToSavedState = useCallback(() => {
    setPreviewImageUri(normalizeProfileImageUrl(currentProfileImageUrl));
    setSelectedImageAsset(undefined);
  }, [currentProfileImageUrl, normalizeProfileImageUrl]);

  return {
    previewImageUri,
    isSaving,
    hasUnsavedChanges: hasUnsavedChanges(),
    handleImagePicker,
    handleRemoveImage,
    handleSave,
    resetToSavedState,
  };
};
