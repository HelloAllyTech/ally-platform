export interface User {
  email: string;
  id: number;
  name: string;
  phone: string;
  role: UserRole;
  userId: number;
  profileImageUrl?: string | null;
}

export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  LEARNER = 'LEARNER',
  /** @deprecated Use SIMULATION_REVIEWER. Backend maps REVIEWER -> SIMULATION_REVIEWER for backward compatibility. */
  REVIEWER = 'REVIEWER',
  SIMULATION_REVIEWER = 'SIMULATION_REVIEWER',
  SCRIBE_REVIEWER = 'SCRIBE_REVIEWER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum UserStatus {
  OFFLINE = 'offline',
  AVAILABLE = 'available',
}
