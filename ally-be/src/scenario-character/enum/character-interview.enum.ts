export enum CharacterInterviewSessionStatus {
  ACTIVE = 'ACTIVE',
  // The agent called save_character_draft — draftCharacter is populated and
  // the session is done (the human reviews/saves in the character form).
  COMPLETED = 'COMPLETED',
  // The admin left or started over before a draft existed. Kept (not
  // deleted) so the transcript is still readable for support, but it no
  // longer counts toward the tenant's in-progress cap and cannot be resumed.
  ABANDONED = 'ABANDONED',
}

export enum CharacterInterviewMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}
