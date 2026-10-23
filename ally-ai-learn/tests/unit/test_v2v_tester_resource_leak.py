from unittest.mock import patch

import pytest

from app.v2v_tester.tester_bot import V2VTesterBot


@pytest.mark.asyncio
async def test_http_session_closed_on_setup_error():
    """
    Verify that the aiohttp.ClientSession is closed even if an exception
    occurs during the setup phase of the V2VTesterBot.run method.
    """
    bot = V2VTesterBot(
        room_name="test-room",
        tester_token="test-token",
        max_exchanges=1,
        language="en-US",
        scenario_title="Test Scenario",
        scenario_context="Test Context",
        scenario_session_id="test-session-id",
        counselor_id=123,
    )

    # Mock rtc.Room constructor to raise an exception to simulate a setup failure
    # after the aiohttp.ClientSession has been created.
    with patch("livekit.rtc.Room", side_effect=RuntimeError("Failed to create room")):
        with pytest.raises(RuntimeError, match="Failed to create room"):
            await bot.run()

    # With the bug, the session will not be closed because the exception happens
    # before the try...finally block that closes it.
    # The test will fail here, and pass when the bug is fixed.
    assert bot._http_session is not None
    assert bot._http_session.closed
