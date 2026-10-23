export enum SessionInfoTab {
  REMINDERS = 'reminders',
  DESCRIPTION = 'description',
}

export interface SessionInfoTabsProps {
  /** Text reminders shown to the learner during the roleplay. */
  reminders?: string[];
  /** Challenge/scenario description (rich text) the learner saw before starting. */
  description?: string;
  /**
   * Suppresses the internal Reminders/Description tab header — used when a
   * parent screen renders its own unified tab bar (which also controls
   * `activeTab`/`onTabChange` below) rather than nesting a second tab bar.
   */
  hideHeader?: boolean;
  /** Externally-controlled active tab. Falls back to internal state when omitted. */
  activeTab?: SessionInfoTab;
  /** Called when the learner taps a tab, only relevant when `activeTab` is controlled. */
  onTabChange?: (tab: SessionInfoTab) => void;
}
