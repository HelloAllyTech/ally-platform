"""TF1 round 2 (Saathi B-5): a rule keeps its condition."""

from app.core.agent_runtime.check.conditions import dropped_condition
from tests.core.agent_runtime.test_agent_check import review
from tests.core.knowledge_agent.test_agent import passage

PARENTS = (
    "Policies, 1 saathi youth helpline pdf page 1 Saathi Youth Helpline does not "
    "contact your parents or school unless your life is in immediate danger."
)


def test_the_parents_rule_keeps_its_unless():
    assert dropped_condition(
        "No, we won't tell your parents. Saathi is confidential.",
        "Will you tell my parents?",
        [{"text": PARENTS}],
    ) == (
        "Saathi Youth Helpline does not contact your parents or school unless "
        "your life is in immediate danger."
    )


def test_two_other_conditions():
    assert dropped_condition(
        "Yes, you can get a refund for your session.",
        "Can I get a refund?",
        [{"text": "Refunds are given only if you cancel 48 hours ahead."}],
    )
    assert dropped_condition(
        "Yes, the Bahadurpur camp is open.",
        "Is the camp at Bahadurpur open?",
        [{"text": "The camp at Bahadurpur stays open until 15 December."}],
    )


def test_a_reply_that_keeps_it_or_is_about_something_else_passes():
    passages = [{"text": PARENTS}]
    assert not dropped_condition(
        "Not unless your life is in immediate danger.",
        "Will you tell my parents?",
        passages,
    )
    assert not dropped_condition(
        "We are open 10 to 10.", "What are your hours?", passages
    )


def test_through_the_check_it_is_sent_back_and_the_rule_added():
    result, rejection = review(
        intent="answer",
        answer="No, we won't tell your parents.",
        citations=[1],
        passages=[passage("c1", 0.7, text=PARENTS)],
        question="Will you tell my parents?",
    )
    assert rejection == "condition_dropped"
    assert result["answer"].endswith("unless your life is in immediate danger.")
