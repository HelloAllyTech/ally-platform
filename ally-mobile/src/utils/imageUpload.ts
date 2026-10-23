import {logger} from './logger';

/**
 * Uploads an image file to S3 using a presigned URL
 * @param fileUri - Local file URI (from image picker)
 * @param presignedUrl - Presigned URL from backend
 * @param contentType - MIME type of the image (e.g., 'image/jpeg')
 * @returns Promise<boolean> - true if upload successful, false otherwise
 */
export const uploadImageToS3 = async (
  fileUri: string,
  presignedUrl: string,
  contentType: string,
): Promise<boolean> => {
  try {
    const response = await fetch(fileUri);
    const blob = await response.blob();

    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': contentType,
      },
    });

    return uploadResponse.ok;
  } catch (error) {
    logger.error(`Error uploading image to S3: ${error}`);
    return false;
  }
};

/**
 * Extracts the S3 URL from a presigned URL by removing query parameters
 * @param presignedUrl - Presigned URL with query parameters
 * @returns The base S3 URL without query parameters
 */
export const extractS3UrlFromPresignedUrl = (presignedUrl: string): string => {
  return presignedUrl.split('?')[0];
};
