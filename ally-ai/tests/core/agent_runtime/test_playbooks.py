"""Tools bring their own instructions (Q3-fast Part 2b): a playbook per kind of list
tool, only when that tool is offered, in a fixed order, with the owner's line."""

from app.core.agent_runtime.playbooks import playbook_kinds, playbooks_section

from .conftest import make_bot
from .test_memory import prompt_for


def tool(name, kind, playbook, list_name, instruction=""):
    return {
        "name": name,
        "kind": kind,
        "description": "",
        "input_schema": {"type": "object", "properties": {}},
        "list_name": list_name,
        "playbook": playbook,
        **({"instruction": instruction} if instruction else {}),
    }


APPOINTMENTS = [
    tool("find_slots", "find", "booking", "Appointments"),
    tool("create_appointments", "create", "booking", "Appointments"),
]
CALLBACKS = [tool("create_callbacks", "create", "details", "Callback requests")]
PRODUCTS = [tool("find_products", "find", "reference", "Products")]
ORDERS = [
    tool("find_orders", "find", "orders", "Orders"),
    tool("update_orders", "update", "orders", "Orders"),
]


def test_each_playbook_only_with_its_tools():
    assert playbook_kinds(APPOINTMENTS) == ["booking"]
    assert playbook_kinds(PRODUCTS) == ["reference"]
    assert playbook_kinds([]) == [] and playbooks_section([]) == ""


def test_several_apply_in_a_fixed_order_once_each():
    defs = PRODUCTS + ORDERS + CALLBACKS + APPOINTMENTS + APPOINTMENTS
    assert playbook_kinds(defs) == ["booking", "details", "orders", "reference"]
    text = playbooks_section(defs)
    assert text.index("# Booking: Appointments") < text.index("# Taking details")
    assert text.count("# Booking:") == 1


def test_the_owners_line_is_fenced_under_its_playbook():
    defs = [
        tool(
            "find_products",
            "find",
            "reference",
            "Products",
            "Always mention the size chart.",
        )
    ]
    text = playbooks_section(defs)
    assert "How the team wants you to use Products" in text
    assert '"""\nAlways mention the size chart.\n"""' in text


def test_an_assistant_with_no_tools_is_byte_identical():
    plain = make_bot(persona={"purpose": "answer"})
    assert prompt_for(plain) == prompt_for({**plain, "gateway_definitions": []})
    assert "# Booking:" not in prompt_for(plain)


def test_the_reference_playbook_says_to_search_when_a_list_is_empty():
    """17 Nov S1/S2: an empty Products list took every tool step; the facts were in
    the pages."""
    assert "search your information too" in playbooks_section(PRODUCTS)
