from typing import Dict, Set

from app.core.constants import ConditionOperator, ExpressionType
from app.core.events.event_types.combination.constants import ExpressionNode
from app.core.events.schemas import EventRegistryEntry


def evaluate_condition(
    value: float, condition: ConditionOperator, threshold: float
) -> bool:
    """
    Evaluate a condition (time or score) against a threshold.

    Args:
        value: Current value (time in seconds or score)
        condition: Condition operator (GT, LT, GTE, LTE, EQ)
        threshold: Threshold value to compare against

    Returns:
        True if condition is met, False otherwise
    """
    if condition == ConditionOperator.GT:
        return value > threshold
    elif condition == ConditionOperator.LT:
        return value < threshold
    elif condition == ConditionOperator.GTE:
        return value >= threshold
    elif condition == ConditionOperator.LTE:
        return value <= threshold
    elif condition == ConditionOperator.EQ:
        return value == threshold
    else:
        return False


def evaluate_expression(
    node: ExpressionNode, event_registry: Dict[str, EventRegistryEntry]
) -> bool:
    """
    Recursively evaluate an expression node following BODMAS (order of operations).

    This method traverses the expression tree in a depth-first manner:
    1. IDENTIFIER nodes are leaf nodes that reference event IDs - we look up their state
    2. NOT nodes negate their operand (evaluated first due to recursion)
    3. AND/OR nodes evaluate both left and right operands recursively

    The evaluation order is determined by the tree structure itself:
    - Deeper nodes are evaluated first (recursive depth-first traversal)
    - This naturally follows BODMAS: inner expressions are evaluated before outer ones

    Example expression: AND(NOT(superficial-hope), OR(time-based-event,
    validate-difficulty))
    Evaluation order:
    1. Evaluate "superficial-hope" (IDENTIFIER) -> get its state from registry
    2. Apply NOT to that result
    3. Evaluate "time-based-event" (IDENTIFIER) -> get its state
    4. Evaluate "validate-difficulty" (IDENTIFIER) -> get its state
    5. Apply OR to results from steps 3 and 4
    6. Apply AND to results from steps 2 and 5

    Args:
        node: The ExpressionNode to evaluate (can be any node type in the tree)
        event_registry: Dictionary mapping event IDs to their EventRegistryEntry

    Returns:
        Boolean result of the expression evaluation
    """
    # IDENTIFIER: Leaf node that references an event ID
    if node.type == ExpressionType.IDENTIFIER:
        if not node.id:
            return False
        event_data = event_registry.get(node.id)
        if event_data is None:
            return False
        return event_data.happened

    # NOT: Logical negation operator
    # Evaluates the operand first (recursively), then negates the result
    elif node.type == ExpressionType.NOT:
        if not node.operand:
            return False
        operand_result = evaluate_expression(node.operand, event_registry)
        return not operand_result

    # AND: Logical conjunction operator
    # Both left and right operands must be True for the result to be True
    # Uses short-circuit evaluation: if left is False, right may not be evaluated
    # (though we evaluate both here for completeness)
    elif node.type == ExpressionType.AND:
        if not node.left or not node.right:
            return False
        left_result = evaluate_expression(node.left, event_registry)
        right_result = evaluate_expression(node.right, event_registry)
        return left_result and right_result

    # OR: Logical disjunction operator
    # At least one operand must be True for the result to be True
    # Uses short-circuit evaluation: if left is True, right may not be evaluated
    # (though we evaluate both here for completeness)
    elif node.type == ExpressionType.OR:
        if not node.left or not node.right:
            return False
        left_result = evaluate_expression(node.left, event_registry)
        right_result = evaluate_expression(node.right, event_registry)
        return left_result or right_result

    else:
        return False


def extract_event_ids_from_expression(node: ExpressionNode) -> Set[str]:
    """
    Extract all event IDs referenced in an expression tree.

    Args:
        node: The expression node to traverse

    Returns:
        Set of all event IDs found in the expression
    """
    event_ids = set()

    if node.type == ExpressionType.IDENTIFIER:
        if node.id:
            event_ids.add(node.id)
    elif node.type == ExpressionType.NOT:
        if node.operand:
            event_ids.update(extract_event_ids_from_expression(node.operand))
    elif node.type in (ExpressionType.AND, ExpressionType.OR):
        if node.left:
            event_ids.update(extract_event_ids_from_expression(node.left))
        if node.right:
            event_ids.update(extract_event_ids_from_expression(node.right))

    return event_ids


# Get the current state for a specific thread_id
def get_current_score_from_graph(thread_id: str) -> int:
    """Get the current score from LangGraph state."""
    # Lazy import to avoid circular dependency
    from app.core.graph import agent_graph

    state = agent_graph.get_state({"configurable": {"thread_id": thread_id}})
    if state and state.values:
        return state.values.get("current_score", 0)
    return 0
