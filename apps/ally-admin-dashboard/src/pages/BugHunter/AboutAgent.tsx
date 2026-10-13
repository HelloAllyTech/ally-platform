import { FC } from "react";

import { Accordion, AccordionItem } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

/**
 * "About me" — the old FAQ, asked in the second person and answered in the
 * first, so reading it feels like asking a colleague how they work.
 *
 * Rendered in the side panel behind the header's help button since
 * 2026-10-13. It was a tab before that, and before that sat at the top of the
 * page while off duty and at the bottom while on — reference material read
 * once, given the same weight as the work. The panel supplies the heading.
 */
export const AboutAgent: FC = () => (
  <div className="max-w-3xl">
    <Accordion size="sm">
      <AccordionItem title={en.bugHunter.faqWhatTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqWhatBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqModesTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqModesBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqTrivialTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqTrivialBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqFixNowTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqFixNowBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqMultiRepoTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqMultiRepoBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqReleaseTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqReleaseBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqReviewTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqReviewBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqEscalationTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqEscalationBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqReposTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqReposBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqCostTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqCostBody}</p>
      </AccordionItem>
      <AccordionItem title={en.bugHunter.faqOffTitle}>
        <p className="text-sm text-typography-700">{en.bugHunter.faqOffBody}</p>
      </AccordionItem>
    </Accordion>
  </div>
);
