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
  REVIEWER = 'REVIEWER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum UserStatus {
  OFFLINE = 'offline',
  AVAILABLE = 'available',
}
