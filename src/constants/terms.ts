export interface TermsSection {
  headingKey: string;
  bullets: Array<{
    textKey: string;
    boldTextKey?: string;
    suffixTextKey?: string;
    link?: {
      textKey: string;
      href: string;
    };
  }>;
}

export const TermsAndAgreementData: TermsSection[] = [
  {
    headingKey: 'TermsAndAgreement.sections.generalTerms.heading',
    bullets: [
      {
        textKey:
          'TermsAndAgreement.sections.generalTerms.bullets.ageRequirement',
      },
      {
        textKey: 'TermsAndAgreement.sections.generalTerms.bullets.accessMethod',
      },
      {
        textKey:
          'TermsAndAgreement.sections.generalTerms.bullets.platformUsage',
      },
      {
        textKey:
          'TermsAndAgreement.sections.generalTerms.bullets.notForEmergencies',
        link: {
          textKey: 'TermsAndAgreement.sections.generalTerms.bullets.crisisLink',
          href: 'https://findahelpline.com/',
        },
      },
    ],
  },
  {
    headingKey: 'TermsAndAgreement.sections.skillsLab.heading',
    bullets: [
      {
        textKey:
          'TermsAndAgreement.sections.skillsLab.bullets.fictionalScenarios',
      },
      {
        textKey: 'TermsAndAgreement.sections.skillsLab.bullets.noCertification',
      },
      {
        textKey: 'TermsAndAgreement.sections.skillsLab.bullets.consentStorage',
      },
    ],
  },
  {
    headingKey: 'TermsAndAgreement.sections.assist.heading',
    bullets: [
      {
        textKey: 'TermsAndAgreement.sections.assist.bullets.authorizedSessions',
      },
      {
        textKey: 'TermsAndAgreement.sections.assist.bullets.audioNotStored',
        boldTextKey:
          'TermsAndAgreement.sections.assist.bullets.audioNotStoredBold',
        suffixTextKey:
          'TermsAndAgreement.sections.assist.bullets.audioNotStoredSuffix',
      },
    ],
  },
];
