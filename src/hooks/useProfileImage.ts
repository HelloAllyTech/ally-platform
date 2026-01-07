import {useCallback, useEffect, useState} from 'react';
import {
  ImagePickerResponse,
  launchImageLibrary,
} from 'react-native-image-picker';

import {useErrorToast} from '@/components';
import {
  useDeleteProfileImageMutation,
  useGetProfileImagePresignedUrlMutation,
  useUpdateProfileImageMutation,
} from '@/services/authApi';
import {uploadImageToS3} from '@/utils/imageUpload';
import {logger} from '@/utils/logger';

interface UseProfileImageOptions {
  currentProfileImageUrl?: string | null;
  onUploadSuccess?: (imageUrl: string) => void;
  onRemoveSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseProfileImageReturn {
  profileImageUri: string | null;
  isUploading: boolean;
  handleImagePicker: () => void;
  handleRemoveImage: () => Promise<void>;
  setProfileImageUri: (uri: string | null) => void;
}

/**
 * Custom hook for managing profile image upload and removal
 * Handles the complete flow: image picker → presigned URL → S3 upload → backend update
 *
 * @param options - Configuration options
 * @param options.currentProfileImageUrl - Current profile image URL from user data
 * @param options.onUploadSuccess - Callback when upload succeeds
 * @param options.onRemoveSuccess - Callback when removal succeeds
 * @param options.onError - Callback when an error occurs
 * @returns Object containing state and handlers for profile image management
 *
 * @example
 * ```tsx
 * const { profileImageUri, isUploading, handleImagePicker, handleRemoveImage } = useProfileImage({
 *   currentProfileImageUrl: userData?.profileImageUrl,
 *   onUploadSuccess: (url) => console.log('Uploaded:', url),
 * });
 * ```
 */
export const useProfileImage = ({
  currentProfileImageUrl,
  onUploadSuccess,
  onRemoveSuccess,
  onError,
}: UseProfileImageOptions): UseProfileImageReturn => {
  const {showErrorToast} = useErrorToast();
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [getPresignedUrl] = useGetProfileImagePresignedUrlMutation();
  const [updateProfileImage] = useUpdateProfileImageMutation();
  const [deleteProfileImage] = useDeleteProfileImageMutation();

  // Initialize profile image from userData
  useEffect(() => {
    if (currentProfileImageUrl) {
      setProfileImageUri(currentProfileImageUrl);
    } else {
      setProfileImageUri(null);
    }
  }, [currentProfileImageUrl]);

  const handleImagePicker = useCallback(() => {
    launchImageLibrary(
      {
        mediaType: 'photo',
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
          const uri = asset.uri;
          const fileName = asset.fileName || `profile-${Date.now()}.jpg`;
          const fileSize = asset.fileSize || 0;
          const type = asset.type || 'image/jpeg';

          if (!uri) {
            showErrorToast(
              new Error('Invalid image URI'),
              'Errors.uploadProfileImage',
            );
            return;
          }

          setIsUploading(true);
          try {
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

            setProfileImageUri(s3Url);
            onUploadSuccess?.(s3Url);

            if (currentProfileImageUrl) {
              try {
                await deleteProfileImage({
                  profileImageUrl: currentProfileImageUrl,
                }).unwrap();
              } catch (error) {
                logger.warn(`Failed to delete old profile image: ${error}`);
              }
            }
          } catch (error) {
            const errorObj =
              error instanceof Error ? error : new Error(String(error));
            logger.error(`Error uploading profile image: ${errorObj}`);
            showErrorToast(errorObj, 'Errors.uploadProfileImage');
            onError?.(errorObj);
          } finally {
            setIsUploading(false);
          }
        }
      },
    );
  }, [
    currentProfileImageUrl,
    deleteProfileImage,
    getPresignedUrl,
    onError,
    onUploadSuccess,
    showErrorToast,
    updateProfileImage,
  ]);

  const handleRemoveImage = useCallback(async () => {
    setIsUploading(true);
    try {
      // Delete profile image using DELETE endpoint
      if (currentProfileImageUrl) {
        await deleteProfileImage({
          profileImageUrl: currentProfileImageUrl,
        }).unwrap();
      }

      setProfileImageUri(null);
      onRemoveSuccess?.();
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      logger.error(`Error removing profile image: ${errorObj}`);
      showErrorToast(errorObj, 'Errors.removeProfileImage');
      onError?.(errorObj);
    } finally {
      setIsUploading(false);
    }
  }, [
    currentProfileImageUrl,
    deleteProfileImage,
    onError,
    onRemoveSuccess,
    showErrorToast,
  ]);

  return {
    profileImageUri,
    isUploading,
    handleImagePicker,
    handleRemoveImage,
    setProfileImageUri,
  };
};
