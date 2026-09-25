from unittest.mock import MagicMock

from app.tts.base import BaseTTSClient


class RealisticMockTTSClient(BaseTTSClient):
    def __init__(self, config=None):
        super().__init__()
        self._config = config or {}
        self._pitch = 1.0  # Initial config
        self._tts_instance = None
        self._current_params["pitch"] = self._pitch

    @property
    def tts_instance(self):
        if self._tts_instance is None:
            # New instance is always created with initial config
            self._tts_instance = MagicMock()
            self._tts_instance.pitch = self._pitch
        return self._tts_instance

    def _apply_parameters_dict(self, params_dict: dict) -> None:
        self._current_params.update(params_dict)
        # In a real client, this might also update internal state like self._pitch
        # but for this test, we assume it only updates the instance, which is
        # what the base class does. The fix should work regardless.
        if self._tts_instance:
            if "pitch" in params_dict:
                self.tts_instance.pitch = params_dict["pitch"]


def test_voice_consistency_fix():
    """
    This test verifies that the fixed create_clip_tts implementation ensures
    voice consistency.
    """
    client = RealisticMockTTSClient()
    _ = client.tts_instance
    assert client.tts_instance.pitch == 1.0

    # Change voice parameter
    client._apply_parameters_dict({"pitch": 1.5})
    assert client.tts_instance.pitch == 1.5

    # Create clip instance using the fixed implementation
    clip_tts_instance = client.create_clip_tts()

    # With the fix, the clip instance should have the updated pitch
    assert clip_tts_instance.pitch == 1.5
    assert client.tts_instance.pitch == clip_tts_instance.pitch
