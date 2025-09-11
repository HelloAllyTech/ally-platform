export interface User {
  email: string;
  id: number;
  name: string;
  phone: string;
  role: UserRole;
  userId: number;
}

export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  LEARN = 'LEARN',
}

export enum UserStatus {
  OFFLINE = 'offline',
  AVAILABLE = 'available',
}
