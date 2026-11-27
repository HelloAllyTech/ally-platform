export interface User {
  profileImageUrl?: string;
  email: string;
  id: number;
  name: string;
  /**
   * The single role the backend collapses a user's roles down to. Lossy for
   * anyone holding more than one — read `roles` when testing for a specific
   * role.
   */
  role: UserRole;
  /** Every role the user holds. Absent on responses predating the field. */
  roles?: UserRole[];
  userId: number;
  status: string;
  // False for accounts created in bulk by an admin (no name yet); gates the
  // user into the Complete Profile screen on first login.
  profileCompleted?: boolean;
}

export enum UserRole {
  COUNSELLOR = "COUNSELOR",
  ADMIN = "ADMIN",
  LEARNER = "LEARNER",
  SCRIBE_REVIEWER = "SCRIBE_REVIEWER",
  SIMULATION_REVIEWER = "SIMULATION_REVIEWER",
  // Platform/admin-console roles. A consumer account can hold one of these
  // alongside its consumer role (roles are additive on a single user record),
  // so they arrive on `roles` here even though none of them can log *into*
  // this app on their own — see ALLY_ADMIN_ROLES in @constants.
  SUPER_ADMIN = "SUPER_ADMIN",
  SUPER_DUPER_ADMIN = "SUPER_DUPER_ADMIN",
  MULTI_TENANT_ADMIN = "MULTI_TENANT_ADMIN",
  // The one Ally-staff role that replaced the three above. It arrives on `roles` like them; the
  // Customers tab on Statistics is offered to it (the server decides what it may see).
  PLATFORM_ADMIN = "PLATFORM_ADMIN",
  // Text helpline groups (ally-be docs/text-helpline.md §2). A LISTENER-only or
  // HELPLINE_SUPERVISOR-only account has nothing in the app but the Helpline
  // workspace, so the landing page must send it there.
  LISTENER = "LISTENER",
  HELPLINE_SUPERVISOR = "HELPLINE_SUPERVISOR",
}

export enum AppType {
  ADMIN = "ADMIN",
  APP = "APP",
}

export interface UserPreferences {
  [key: string]: any;
}
