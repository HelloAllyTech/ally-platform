const SOUND_KEY = "ally.inbox.sound";

/** Whether the inbox plays a sound (per person, in this browser). On unless they turned it off. */
export const soundOn = (): boolean => {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};

export const setSound = (on: boolean): void => {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the toggle still works for this page */
  }
};

/** A short two-note chime, made in the browser (no file to load). */
export function chime(): void {
  if (!soundOn()) return;
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    [660, 880].forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.08, context.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + i * 0.15 + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + i * 0.15);
      oscillator.stop(context.currentTime + i * 0.15 + 0.3);
    });
  } catch {
    /* no audio: the notification still shows */
  }
}

export const notificationsAllowed = (): boolean =>
  typeof Notification !== "undefined" && Notification.permission === "granted";

export const canAskForNotifications = (): boolean =>
  typeof Notification !== "undefined" && Notification.permission === "default";

export async function askForNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  return (await Notification.requestPermission()) === "granted";
}

/** A browser notification (when allowed) and the chime. The text never includes a message. */
export function notify(title: string, onClick?: () => void): void {
  chime();
  if (!notificationsAllowed()) return;
  try {
    const notification = new Notification(title, { tag: title });
    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
