export enum SessionInfoTab {
  REMINDERS = 'reminders',
  DESCRIPTION = 'description',
}

export interface SessionInfoTabsProps {
  /** Text reminders shown to the learner during the roleplay. */
  reminders?: string[];
  /** Challenge/scenario description (rich text) the learner saw before starting. */
  description?: string;
}
