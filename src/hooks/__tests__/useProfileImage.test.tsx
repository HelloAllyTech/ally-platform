import {act, renderHook, waitFor} from '@testing-library/react-native';
import {launchImageLibrary} from 'react-native-image-picker';

import {useErrorToast} from '@/components';
import {
  useDeleteProfileImageMutation,
  useGetProfileImagePresignedUrlMutation,
  useUpdateProfileImageMutation,
} from '@/services/authApi';
import {uploadImageToS3} from '@/utils/imageUpload';
import {logger} from '@/utils/logger';

import {useProfileImage} from '../useProfileImage';

// Mocks
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('@/components', () => ({
  useErrorToast: jest.fn(),
}));

jest.mock('@/services/authApi', () => ({
  useDeleteProfileImageMutation: jest.fn(),
  useGetProfileImagePresignedUrlMutation: jest.fn(),
  useUpdateProfileImageMutation: jest.fn(),
}));

jest.mock('@/utils/imageUpload', () => ({
  uploadImageToS3: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockShowErrorToast = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockUpdateProfileImage = jest.fn();
const mockDeleteProfileImage = jest.fn();

describe('useProfileImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useErrorToast as jest.Mock).mockReturnValue({
      showErrorToast: mockShowErrorToast,
    });

    (useGetProfileImagePresignedUrlMutation as jest.Mock).mockReturnValue([
      mockGetPresignedUrl,
    ]);

    (useUpdateProfileImageMutation as jest.Mock).mockReturnValue([
      mockUpdateProfileImage,
    ]);

    (useDeleteProfileImageMutation as jest.Mock).mockReturnValue([
      mockDeleteProfileImage,
    ]);
  });

  describe('initialization', () => {
    it('should initialize with currentProfileImageUrl', () => {
      const {result} = renderHook(() =>
        useProfileImage({
          currentProfileImageUrl: 'https://example.com/image.jpg',
        }),
      );

      expect(result.current.profileImageUri).toBe('https://example.com/image.jpg');
    });

    it('should initialize with null when currentProfileImageUrl is not provided', () => {
      const {result} = renderHook(() => useProfileImage({}));

      expect(result.current.profileImageUri).toBeNull();
    });

    it('should update profileImageUri when currentProfileImageUrl changes', () => {
      const {result, rerender} = renderHook(
        ({url}) => useProfileImage({currentProfileImageUrl: url}),
        {
          initialProps: {url: null as string | null},
        },
      );

      expect(result.current.profileImageUri).toBeNull();

      rerender({url: 'https://example.com/new-image.jpg'});

      expect(result.current.profileImageUri).toBe('https://example.com/new-image.jpg');
    });
  });

  describe('handleImagePicker', () => {
    it('should handle successful image upload', async () => {
      const mockOnUploadSuccess = jest.fn();
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      mockUpdateProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(true);

      const {result} = renderHook(() =>
        useProfileImage({
          onUploadSuccess: mockOnUploadSuccess,
        }),
      );

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockGetPresignedUrl).toHaveBeenCalledWith({
          fileName: 'image.jpg',
          fileSize: 1000,
          contentType: 'image/jpeg',
        });
      });

      await waitFor(() => {
        expect(uploadImageToS3).toHaveBeenCalledWith(
          'file://image.jpg',
          'https://s3.amazonaws.com/presigned-url',
          'image/jpeg',
        );
      });

      await waitFor(() => {
        expect(mockUpdateProfileImage).toHaveBeenCalledWith({
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        });
      });

      await waitFor(() => {
        expect(result.current.profileImageUri).toBe(
          'https://s3.amazonaws.com/profile-image.jpg',
        );
      });

      await waitFor(() => {
        expect(mockOnUploadSuccess).toHaveBeenCalledWith(
          'https://s3.amazonaws.com/profile-image.jpg',
        );
      });
    });

    it('should delete old image before uploading new one', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockDeleteProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      mockUpdateProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(true);

      const {result} = renderHook(() =>
        useProfileImage({
          currentProfileImageUrl: 'https://example.com/old-image.jpg',
        }),
      );

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockDeleteProfileImage).toHaveBeenCalledWith({
          profileImageUrl: 'https://example.com/old-image.jpg',
        });
      });
    });

    it('should continue upload even if deleting old image fails', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockDeleteProfileImage.mockReturnValue({
        unwrap: jest.fn().mockRejectedValue(new Error('Delete failed')),
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      mockUpdateProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(true);

      const {result} = renderHook(() =>
        useProfileImage({
          currentProfileImageUrl: 'https://example.com/old-image.jpg',
        }),
      );

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to delete old profile image'),
        );
      });

      await waitFor(() => {
        expect(mockGetPresignedUrl).toHaveBeenCalled();
      });
    });

    it('should handle missing URI', async () => {
      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [{uri: undefined, fileName: 'image.jpg'}],
        });
      });

      const {result} = renderHook(() => useProfileImage({}));

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockShowErrorToast).toHaveBeenCalledWith(
          expect.any(Error),
          'Errors.uploadProfileImage',
        );
      });
    });

    it('should handle image picker cancellation', async () => {
      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: true,
        });
      });

      const {result} = renderHook(() => useProfileImage({}));

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockGetPresignedUrl).not.toHaveBeenCalled();
      });
    });

    it('should handle S3 upload failure', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(false);

      const mockOnError = jest.fn();
      const {result} = renderHook(() =>
        useProfileImage({
          onError: mockOnError,
        }),
      );

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockShowErrorToast).toHaveBeenCalledWith(
          expect.any(Error),
          'Errors.uploadProfileImage',
        );
      });

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalled();
      });
    });

    it('should handle API errors during upload', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockRejectedValue(new Error('API Error')),
      });

      const mockOnError = jest.fn();
      const {result} = renderHook(() =>
        useProfileImage({
          onError: mockOnError,
        }),
      );

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockShowErrorToast).toHaveBeenCalledWith(
          expect.any(Error),
          'Errors.uploadProfileImage',
        );
      });

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalled();
      });
    });

    it('should generate default fileName when not provided', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: undefined,
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      mockUpdateProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(true);

      const {result} = renderHook(() => useProfileImage({}));

      act(() => {
        result.current.handleImagePicker();
      });

      await waitFor(() => {
        expect(mockGetPresignedUrl).toHaveBeenCalledWith({
          fileName: expect.stringMatching(/^profile-\d+\.jpg$/),
          fileSize: 1000,
          contentType: 'image/jpeg',
        });
      });
    });
  });

  describe('handleRemoveImage', () => {
    it('should successfully remove image', async () => {
      mockDeleteProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      const mockOnRemoveSuccess = jest.fn();
      const {result} = renderHook(() =>
        useProfileImage({
          currentProfileImageUrl: 'https://example.com/image.jpg',
          onRemoveSuccess: mockOnRemoveSuccess,
        }),
      );

      await act(async () => {
        await result.current.handleRemoveImage();
      });

      expect(mockDeleteProfileImage).toHaveBeenCalledWith({
        profileImageUrl: 'https://example.com/image.jpg',
      });

      expect(result.current.profileImageUri).toBeNull();
      expect(mockOnRemoveSuccess).toHaveBeenCalled();
    });

    it('should handle removal error', async () => {
      const error = new Error('Delete failed');
      mockDeleteProfileImage.mockReturnValue({
        unwrap: jest.fn().mockRejectedValue(error),
      });

      const mockOnError = jest.fn();
      const {result} = renderHook(() =>
        useProfileImage({
          currentProfileImageUrl: 'https://example.com/image.jpg',
          onError: mockOnError,
        }),
      );

      await act(async () => {
        await result.current.handleRemoveImage();
      });

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        expect.any(Error),
        'Errors.removeProfileImage',
      );

      expect(mockOnError).toHaveBeenCalled();
    });

    it('should not call API if no currentProfileImageUrl', async () => {
      const {result} = renderHook(() => useProfileImage({}));

      await act(async () => {
        await result.current.handleRemoveImage();
      });

      expect(mockDeleteProfileImage).not.toHaveBeenCalled();
      expect(result.current.profileImageUri).toBeNull();
    });
  });

  describe('setProfileImageUri', () => {
    it('should update profileImageUri', () => {
      const {result} = renderHook(() => useProfileImage({}));

      act(() => {
        result.current.setProfileImageUri('https://example.com/new-image.jpg');
      });

      expect(result.current.profileImageUri).toBe('https://example.com/new-image.jpg');
    });
  });

  describe('isUploading state', () => {
    it('should set isUploading to true during upload', async () => {
      const mockAsset = {
        uri: 'file://image.jpg',
        fileName: 'image.jpg',
        fileSize: 1000,
        type: 'image/jpeg',
      };

      (launchImageLibrary as jest.Mock).mockImplementation((_, callback) => {
        callback({
          didCancel: false,
          errorCode: undefined,
          assets: [mockAsset],
        });
      });

      mockGetPresignedUrl.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue({
          presignedUrl: 'https://s3.amazonaws.com/presigned-url',
          profileImageUrl: 'https://s3.amazonaws.com/profile-image.jpg',
        }),
      });

      mockUpdateProfileImage.mockReturnValue({
        unwrap: jest.fn().mockResolvedValue(undefined),
      });

      (uploadImageToS3 as jest.Mock).mockResolvedValue(true);

      const {result} = renderHook(() => useProfileImage({}));

      act(() => {
        result.current.handleImagePicker();
      });

      // isUploading should be true during upload
      await waitFor(() => {
        expect(result.current.isUploading).toBe(true);
      });

      // isUploading should be false after upload completes
      await waitFor(() => {
        expect(result.current.isUploading).toBe(false);
      });
    });
  });
});
