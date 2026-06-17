export interface User {
  email: string;
  id: number;
  // Blank for accounts created in bulk by an admin until the user completes
  // their profile on first login.
  name: string;
  phone: string;
  role: UserRole;
  userId: number;
  profileImageUrl?: string | null;
  // False while a bulk-created account still needs the user to fill in their
  // name; drives the first-login Complete Profile gate.
  profileCompleted?: boolean;
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
