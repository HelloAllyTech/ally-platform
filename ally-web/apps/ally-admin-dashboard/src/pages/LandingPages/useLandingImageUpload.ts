import { useCallback } from "react";

import { useGetLandingImageUploadUrlMutation } from "../../api/landingPages";

export const LANDING_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LANDING_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** Why a file cannot be used as a landing page image, or null when it can. */
export const landingImageProblem = (file: { type: string; size: number }): string | null => {
  if (!LANDING_IMAGE_TYPES.includes(file.type)) {
    return "Use a PNG, JPEG, WebP or SVG image";
  }
  if (file.size > LANDING_IMAGE_MAX_BYTES) {
    return `The image must be ${LANDING_IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller`;
  }
  return null;
};

/**
 * Uploads a landing page image to the organization's storage folder and
 * resolves to the address to keep in the page. Rejects with a message the
 * editor shows next to the image.
 */
export const useLandingImageUpload = (tenantId: string | undefined) => {
  const [getUploadUrl] = useGetLandingImageUploadUrlMutation();

  return useCallback(
    async (file: File): Promise<string> => {
      const problem = landingImageProblem(file);
      if (problem) throw new Error(problem);
      if (!tenantId) throw new Error("The page is still loading");

      let signed;
      try {
        signed = await getUploadUrl({
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type,
          tenantId,
        }).unwrap();
      } catch {
        throw new Error("Couldn't start the upload. Try again.");
      }

      const response = await fetch(signed.presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      }).catch(() => null);
      if (!response?.ok) throw new Error("The upload didn't finish. Try again.");

      return signed.imageUrl;
    },
    [getUploadUrl, tenantId],
  );
};
