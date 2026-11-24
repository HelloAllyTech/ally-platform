import type { ReplyLanguage } from './reply-language';

/**
 * The reply when two sources give different facts for the question (stage 5, conflict handling
 * at answer time): the assistant says it is not sure rather than picking one, and the owner gets
 * a question on the unanswered queue to fix the sources. Fixed text, never generated.
 */
// COPY: needs approval
export const CONFLICT_NOT_SURE_COPY: Record<ReplyLanguage, string> = {
  en: "I'm not sure about this: the information I have gives different answers. Please check with the organisation directly.",
  hi: 'मुझे इसके बारे में पक्का नहीं पता: मेरे पास की जानकारी में अलग-अलग जवाब हैं। कृपया संस्था से सीधे पूछ लें।',
  'hi-latn':
    'Mujhe iske baare mein pakka nahin pata: mere paas ki jaankari mein alag-alag jawab hain. Kripya sanstha se seedhe pooch lein.',
};
