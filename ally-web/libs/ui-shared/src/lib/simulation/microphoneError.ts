/**
 * Why the browser would not give a voice roleplay its microphone.
 *
 * Kept apart from a connection failure on purpose: the room can connect
 * perfectly and the session still be unusable because getUserMedia refused,
 * and the fix a learner needs (unblock the site, plug in a mic, close the app
 * holding it) has nothing to do with their internet connection.
 *
 * - blocked:  the browser or the operating system denied permission
 * - notFound: there is no usable input device
 * - inUse:    a device exists but could not be opened (another app holds it,
 *             or a driver/OS-level fault)
 * - unknown:  anything else; the raw message is still surfaced
 */
export type MicrophoneErrorKind = "blocked" | "notFound" | "inUse" | "unknown";

export interface MicrophoneError {
  kind: MicrophoneErrorKind;
  /** DOMException name as the browser reported it, e.g. "NotReadableError". */
  name: string;
  message: string;
}

// getUserMedia's DOMException names (MDN), plus the legacy Chrome aliases
// older builds still throw.
const KIND_BY_NAME: Record<string, MicrophoneErrorKind> = {
  NotAllowedError: "blocked",
  PermissionDeniedError: "blocked",
  SecurityError: "blocked",
  NotFoundError: "notFound",
  DevicesNotFoundError: "notFound",
  OverconstrainedError: "notFound",
  NotReadableError: "inUse",
  TrackStartError: "inUse",
  AbortError: "inUse",
};

export const classifyMicrophoneError = (error: unknown): MicrophoneError => {
  const name = (error as { name?: unknown })?.name;
  const message = (error as { message?: unknown })?.message;
  const errorName = typeof name === "string" && name ? name : "Error";
  return {
    kind: KIND_BY_NAME[errorName] ?? "unknown",
    name: errorName,
    message: typeof message === "string" ? message : String(error),
  };
};
