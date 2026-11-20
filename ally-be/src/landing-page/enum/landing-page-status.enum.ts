export enum LandingPageStatus {
  /** Never published, or taken down. Not served publicly. */
  DRAFT = 'DRAFT',
  /** `publishedConfig` is live at the page's public address. */
  PUBLISHED = 'PUBLISHED',
}
