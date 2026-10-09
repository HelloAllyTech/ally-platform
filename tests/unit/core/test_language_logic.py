
from app.core.scenario.base import Scenario
from app.core.constants import DEFAULT_LANGUAGE_CODE


def test_language_code_priority():
    """languageCode should have priority over language."""
    metadata = {
        "scenarioName": "test",
        "languageCode": "en-IN",
        "language": "hi-IN"
    }
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == "en-IN"


def test_language_code_snake_case_is_checked():
    """language_code (snake_case) should be checked."""
    metadata = {
        "scenarioName": "test",
        "language_code": "en-IN",
        "language": "hi-IN"
    }
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == "en-IN"


def test_no_language_code_uses_default():
    """If no languageCode, use default, not language fallback."""
    metadata = {
        "scenarioName": "test",
        "language": "hi-IN"
    }
    scenario = Scenario.create(metadata)
    assert scenario.language_config.language_code == DEFAULT_LANGUAGE_CODE
