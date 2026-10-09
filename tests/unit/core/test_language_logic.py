from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.scenario.base import Scenario


def test_language_code_priority():
    """languageCode should have priority over language."""
    metadata = {"scenarioName": "test", "languageCode": "en-IN", "language": "hi-IN"}
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == "en-IN"


def test_language_is_the_fallback_when_language_code_is_absent():
    """The backend adds languageCode conditionally; "language" is always sent,
    so a non-English session must not collapse to the default without it."""
    metadata = {"scenarioName": "test", "language": "hi-IN"}
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == "hi-IN"


def test_language_code_snake_case_is_checked_last():
    metadata = {"scenarioName": "test", "language_code": "hi-IN"}
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == "hi-IN"


def test_no_language_field_uses_default():
    scenario = Scenario.create({"scenarioName": "test"})
    assert scenario.language_config.language_code == DEFAULT_LANGUAGE_CODE
