"""Mapping from event-id to YAML filename for all similarity-based events.

Follow snake_case filenames, one file per event id.
Add new mappings here as you add more YAML files.
"""
from typing import Dict

# event_id -> filename (relative to sentences directory)
EVENT_ID_TO_FILE: Dict[str, str] = {
    # Active Events (Positive)
    "encourager": "encourager.yml",
    "open-ended-question": "open_ended_question.yml",
    "validate-difficulty": "validate_difficulty.yml",
    "validate-fear": "validate_fear.yml",
    "validate-disappointment": "validate_disappointment.yml",
    "normalize-experience": "normalize_experience.yml",
    "focus-strength": "focus_strength.yml",
    "affirm-reaching-out": "affirm_reaching_out.yml",
    "offer-collaboration": "offer_collaboration.yml",
    "instill-hope": "instill_hope.yml",
    "positive-reframing": "positive_reframing.yml",
    "encourage-social-support": "encourage_social_support.yml",
    "risk-assessment": "risk_assessment.yml",
    "recognize-worry-future": "recognize_worry_future.yml",
    "explore-client-fears-general": "explore_client_fears_general.yml",
    "explore-client-fears-with-parents": "explore_client_fears_with_parents.yml",
    "assess-safety": "assess_safety.yml",
    "explore-beliefs": "explore_beliefs.yml",
    "explore-impact-of-problem": "explore_impact_of_problem.yml",
    "communication-intervention": "communication_intervention.yml",
    "negative-beliefs-intervention": "negative_beliefs_intervention.yml",
    "reduce-self-blame": "reduce_self_blame.yml",
    "enhance-self-compassion": "enhance_self_compassion.yml",
    "plan-follow-up": "plan_follow_up.yml",
    "close-session": "close_session.yml",
    "safety-planning": "safety_planning.yml",
    "enhance-support-systems": "enhance_support_systems.yml",
    "solution-focused-thinking": "solution_focused_thinking.yml",
    "miracle-questioning": "miracle_questioning.yml",
    "scaling-questions": "scaling_questions.yml",
    "offer-reassurance": "offer_reassurance.yml",
    
    # Active Events (Negative)
    "superficial-hope": "superficial_hope.yml",
    "invalidate": "invalidate.yml",
    "blame-client": "blame_client.yml",
    "judge-client": "judge_client.yml",
    "assumptions": "assumptions.yml",
    "deficit-focus": "deficit_focus.yml",
    "premature-solving": "premature_solving.yml",
    "moral-judgment-parents": "moral_judgment_parents.yml",
    "compare-students": "compare_students.yml",
    "make-about-self": "make_about_self.yml",
    "pathologize-symptoms": "pathologize_symptoms.yml",
    "ignore-context": "ignore_context.yml",
    "irrelevant-assurance": "irrelevant_assurance.yml",
    "make-promises": "make_promises.yml",
    "force-confrontation": "force_confrontation.yml",
    "take-sides": "take_sides.yml",
    "end-abruptly": "end_abruptly.yml",
    "overburden-client": "overburden_client.yml",
    
    # Passive Events
    "empathising": "empathising.yml",
    "questioning": "questioning.yml",
    "validating": "validating.yml",
    "accepting": "accepting.yml",
    "calming": "calming.yml",
    "encouraging-to-share": "encouraging_to_share.yml",
    "clarifying": "clarifying.yml",
    "noting-and-reflecting": "noting_and_reflecting.yml",
    "confronting": "confronting.yml",
    "focusing": "focusing.yml",
}
