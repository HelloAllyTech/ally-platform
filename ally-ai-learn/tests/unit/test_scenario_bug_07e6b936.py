from app.core.scenario.base import PromptData, Scenario


def test_scenario_creation_handles_invalid_prompt_data():
    scenario_payload = {
        "scenarioName": "Test Scenario",
        "promptData": "this is not a dictionary",
    }
    scenario = Scenario.create(payload=scenario_payload)
    assert isinstance(scenario, Scenario)
    assert scenario.name == "Test Scenario"
    assert scenario.prompt_data == PromptData()
