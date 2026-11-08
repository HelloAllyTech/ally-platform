/** Where a draft is in its life. */
export enum BotDraftStatus {
  ACTIVE = 'active',
  PUBLISHED = 'published',
  ABANDONED = 'abandoned',
}

/**
 * The onboarding steps, in order. Loop 20a-2 inserts `checkup` and `try_it` before `share`
 * (see `step-machine.ts`); the enum keeps them so a migration isn't needed then.
 */
export enum BotDraftStep {
  START = 'start',
  READING = 'reading',
  LEARNED = 'learned',
  SAFETY = 'safety',
  GAPS = 'gaps',
  DESIGN = 'design',
  BUILDING = 'building',
  CHECKUP = 'checkup',
  TRY_IT = 'try_it',
  SHARE = 'share',
  PUBLISHED = 'published',
}

/** A safety pack. Packs can be added to, never weakened (see `safety-pack/`). */
export enum SafetyPackId {
  MENTAL_HEALTH = 'mental_health',
  MEDICAL = 'medical',
  PHARMACY = 'pharmacy',
  MINORS = 'minors',
  LEGAL_FINANCIAL = 'legal_financial',
  STANDARD = 'standard',
}

/** What the builder may classify a business as. The pack is chosen from this in code. */
export enum Industry {
  MENTAL_HEALTH = 'mental_health',
  GP_CLINIC = 'gp_clinic',
  DIAGNOSTIC_LAB = 'diagnostic_lab',
  PHARMACY = 'pharmacy',
  WELLNESS = 'wellness',
  D2C = 'd2c',
  COACHING = 'coaching',
  SCHOOL = 'school',
  REAL_ESTATE = 'real_estate',
  SAAS = 'saas',
  RESTAURANT = 'restaurant',
  LEGAL_FINANCIAL = 'legal_financial',
  NON_PROFIT = 'non_profit',
  OTHER = 'other',
}

/**
 * What a business deals with that calls for care, whatever kind of business it is. The pack comes
 * from these and the industry together (the strongest wins): a mental health non-profit gets
 * Mental health safety (Shehbaz, 2026-11-08).
 */
export enum CareTopic {
  MENTAL_HEALTH = 'mental_health',
  MEDICAL = 'medical',
  MEDICINES = 'medicines',
  YOUNG_PEOPLE = 'young_people',
  LEGAL_FINANCIAL = 'legal_financial',
}

/** The designs that work today. Booking and orders are always offered as "coming soon". */
export enum DesignId {
  GUIDE = 'guide',
  ENQUIRIES = 'enquiries',
  SUPPORT = 'support',
}

/** A "what we learned" section (copy §4). */
export enum LearnedSection {
  ABOUT = 'about',
  SERVICES = 'services',
  HOURS = 'hours',
  TEAM = 'team',
  LOCATION = 'location',
  POLICIES = 'policies',
  FAQS = 'faqs',
  BRAND = 'brand',
}

/** Who changed a draft. The builder only proposes; ally-be applies. */
export enum BotDraftActor {
  BUILDER = 'builder',
  OWNER = 'owner',
  SYSTEM = 'system',
}
