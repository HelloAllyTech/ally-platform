import { ApiEndpoints, LOCAL_STORAGE_KEYS } from "@constants";
import { ContextUploadOptions, ContextUploadResult } from "@types";

/**
 * `POST v1/context-library/uploads` over XHR.
 *
 * The one Context Library call that is not in the RTK Query slice: the dock shows each
 * document's upload progress, and fetch (which RTK Query's base query uses) cannot report
 * bytes sent. Everything after the upload — the queue, pause, resume, cancel — goes through
 * `api/contextLibrary.ts` as usual.
 */

export interface UploadHandle {
  promise: Promise<ContextUploadResult[]>;
  abort: () => void;
}

export interface UploadCallbacks {
  /** 0–1 as bytes go up. */
  onProgress?: (fraction: number) => void;
  /** Every byte is up; the server is now reading the files. */
  onSent?: () => void;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export const buildUploadForm = (files: File[], options: ContextUploadOptions): FormData => {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  form.append("collections", JSON.stringify(options.collections));
  if (options.titles && Object.keys(options.titles).length) {
    form.append("titles", JSON.stringify(options.titles));
  }
  if (options.docVersion) form.append("docVersion", options.docVersion);
  if (options.year) form.append("year", String(options.year));
  if (options.reextract) form.append("reextract", "true");
  if (options.addAnyway) form.append("addAnyway", "true");
  if (options.costCapUsd) form.append("costCapUsd", String(options.costCapUsd));
  if (options.batchId) form.append("batchId", options.batchId);
  if (options.audience) {
    form.append("isGlobal", String(options.audience.isGlobal));
    if (!options.audience.isGlobal) {
      form.append("tenantIds", JSON.stringify(options.audience.tenantIds));
    }
  }
  return form;
};

const messageFrom = (status: number, body: string): string => {
  if (status === 401) return "Your sign-in expired. Sign in again, then retry.";
  if (status === 403) return "You don't have permission to add documents.";
  if (status === 413) return "Too large to upload.";
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join("; ");
  } catch {
    /* not JSON */
  }
  return status ? `The server answered ${status}.` : "The connection dropped.";
};

export const sendUpload = (
  files: File[],
  options: ContextUploadOptions,
  callbacks: UploadCallbacks = {},
): UploadHandle => {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ContextUploadResult[]>((resolve, reject) => {
    xhr.open(
      "POST",
      `${import.meta.env.VITE_API_BASE_URL}/api${ApiEndpoints.CONTEXT_LIBRARY.UPLOADS}`,
    );
    const token = localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_ACCESS_TOKEN);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        callbacks.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.upload.onload = () => callbacks.onSent?.();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ContextUploadResult[]);
        } catch {
          reject(new UploadError("The server's answer couldn't be read.", xhr.status));
        }
      } else {
        reject(new UploadError(messageFrom(xhr.status, xhr.responseText), xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError(messageFrom(0, ""), 0));
    xhr.onabort = () => reject(new UploadError("Stopped.", 0));
    xhr.send(buildUploadForm(files, options));
  });
  return { promise, abort: () => xhr.abort() };
};
