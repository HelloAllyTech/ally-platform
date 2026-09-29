"""Regression test for the video avatar connection issue."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

from app.core.livekit import video_actor


@pytest.mark.asyncio
async def test_bey_gets_longer_timeout(monkeypatch):
    """The fix: increase the timeout for the bey provider."""
    monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
    monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
    monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "face-1")
    monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_BEY_API_KEY", "test-key")

    mock_plugin = MagicMock()
    mock_plugin.AvatarSession.return_value.start = AsyncMock()

    with patch("importlib.import_module", return_value=mock_plugin):
        await video_actor._start_hosted(
            provider="bey",
            module_path="livekit.plugins.bey",
            session=MagicMock(),
            room=MagicMock(),
            scenario=MagicMock(),
            livekit_url="wss://example.com",
        )

    # This import is ugly, but it's the only way to get the real default
    # without hardcoding it.
    from app.core.livekit.video_actor import _BEY_CONN_OPTIONS_WITH_FIX

    mock_plugin.AvatarSession.assert_called_once()
    _, kwargs = mock_plugin.AvatarSession.call_args
    assert kwargs["conn_options"].timeout == _BEY_CONN_OPTIONS_WITH_FIX.timeout
    assert kwargs["conn_options"].timeout > DEFAULT_API_CONNECT_OPTIONS.timeout
