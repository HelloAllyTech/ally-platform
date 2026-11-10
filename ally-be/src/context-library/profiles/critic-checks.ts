/**
 * What each profile-specific critic check means, by name.
 *
 * A profile lists the checks it needs (`extraction.criticChecks`); the extraction service sends
 * each one's definition with the candidates, so the critic grades against a stated test rather
 * than a guess at what a bare name means, and the definitions change with the code that relies
 * on them rather than with a prompt edit. Checks that reject outright on `fail` are listed in
 * `REJECTING_CHECKS` (context-extraction.service.ts); any other `fail` lowers confidence.
 */
export const CRITIC_CHECKS: Readonly<Record<string, string>> = {
  identifiability:
    'fail if the candidate describes, or could be traced back to, one real, identifiable ' +
    'person: a named or nicknamed individual, a case or life story told closely enough to ' +
    'recognise, or a rare combination of details (place, age, job, event) that points at one ' +
    'person. It must be a general insight about people in a situation.',
  stereotype:
    'fail if the candidate presents a stereotype or caricature as typical: one trait standing ' +
    'for a whole group, a condition or culture reduced to a cliché, or a claim that everyone ' +
    'in a group thinks, talks or behaves one way. Doubt if it generalises without saying it ' +
    'varies from person to person.',
  clinical_plausibility:
    'fail if what it says about how a condition presents or progresses contradicts the part ' +
    'or mainstream clinical understanding; doubt if it overstates how common or certain it is.',
  treatment_protocol:
    'fail if the candidate is clinical treatment guidance (what a clinician should do, a ' +
    'protocol, a dose, a diagnostic procedure or an intervention plan) rather than an insight ' +
    'into how a person lives, feels or talks.',
};
