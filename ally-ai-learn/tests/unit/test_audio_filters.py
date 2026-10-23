"""Krisp BVC capability gate — app/core/livekit/audio_filters.py.

Two things went wrong in production with the original hostname-only gate,
both ending in the same FFI line the gate exists to prevent:

    livekit_ffi::server::room - audio filter cannot be enabled:
        LiveKit Cloud is required

1. It read the *registration* URL (``settings.LIVEKIT_URL``) while the room
   connects to the *job* URL (``RunningJobInfo.url`` = ``job_assign.url or
   ws_url``). A Cloud control plane can hand a job a media URL that is not
   Cloud, so the gate said yes for a session that could never run the filter.
2. Even the right URL cannot express "this Cloud project's media plane won't
   run Krisp", so the gate needs an operator override.
"""

from types import SimpleNamespace

import pytest

from app.core.livekit.audio_filters import (
    session_livekit_url,
    supports_noise_cancellation,
)


class TestHostnameHeuristic:
    """The working case must keep working: Cloud yes, everything else no."""

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "url",
        [
            "wss://ally.livekit.cloud",
            "wss://ally-abc123.production.livekit.cloud",
            "wss://ally.livekit.run",
            "wss://ally.livekit.cloud:443",
        ],
    )
    def test_cloud_urls_support_the_filter(self, url):
        assert supports_noise_cancellation(url) is True

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "url",
        [
            "wss://livekit.internal",
            "wss://sfu.helloally.example",
            "wss://livekit.cloud",  # apex, not a project subdomain
            "wss://ally.livekit.cloud.attacker.example",
            "",
            "not a url at all",
        ],
    )
    def test_non_cloud_urls_do_not(self, url):
        assert supports_noise_cancellation(url) is False


class TestSessionUrlIsTheJobUrl:
    """The gate must judge the deployment the room actually connects to.

    ``JobContext`` connects the room to ``self._info.url``, which the SDK
    fills from ``job_assign.url or ws_url`` — and the SDK gates its own
    Cloud-only features on that URL, not on the worker's registration URL.
    """

    @pytest.mark.unit
    def test_job_url_wins_over_the_registration_url(self):
        ctx = SimpleNamespace(_info=SimpleNamespace(url="wss://sfu.internal"))
        assert session_livekit_url(ctx, "wss://ally.livekit.cloud") == (
            "wss://sfu.internal"
        )

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "ctx",
        [
            SimpleNamespace(),  # no _info at all (fake/console job)
            SimpleNamespace(_info=SimpleNamespace(url="")),
            SimpleNamespace(_info=SimpleNamespace(url="   ")),
            SimpleNamespace(_info=SimpleNamespace(url=object())),  # not a str
            SimpleNamespace(_info=None),
            None,
        ],
    )
    def test_falls_back_to_the_registration_url(self, ctx):
        assert session_livekit_url(ctx, "wss://ally.livekit.cloud") == (
            "wss://ally.livekit.cloud"
        )

    @pytest.mark.unit
    def test_cloud_control_plane_with_a_non_cloud_media_url_is_refused(self):
        """The production failure, at the unit level."""
        ctx = SimpleNamespace(_info=SimpleNamespace(url="wss://sfu.internal"))
        url = session_livekit_url(ctx, "wss://ally.livekit.cloud")
        assert supports_noise_cancellation(url) is False


class TestKillSwitch:
    """A hostname cannot reveal a Cloud project whose media plane lacks Krisp."""

    @pytest.mark.unit
    def test_disabled_refuses_even_a_cloud_url(self):
        assert (
            supports_noise_cancellation("wss://ally.livekit.cloud", enabled=False)
            is False
        )

    @pytest.mark.unit
    def test_enabled_is_the_default_and_keeps_current_behaviour(self):
        assert supports_noise_cancellation("wss://ally.livekit.cloud") is True
        assert (
            supports_noise_cancellation("wss://ally.livekit.cloud", enabled=True)
            is True
        )

    @pytest.mark.unit
    def test_enabled_does_not_resurrect_a_non_cloud_deployment(self):
        assert (
            supports_noise_cancellation("wss://livekit.internal", enabled=True) is False
        )


class TestSettingDefault:
    """The default has to be off, because our LiveKit is self-hosted.

    The URL gate above shipped on 2026-08-25 and was live in prd from 05:58Z,
    yet the same FFI error recurred on three distinct rooms the next morning
    (2026-08-26 05:05:00Z, 05:05:10Z, 05:09:32Z). For the filter to have been
    requested at all, the job's media URL must have passed the ``*.livekit
    .cloud``/``*.livekit.run`` test — while the media plane serving it is
    self-hosted and refuses Krisp. That is the "no hostname can tell" case,
    and the flag is the only thing that can express it.

    A default of True made that case fail open: it asks for a filter nobody
    will run, on every session, until an operator sets an env var. Since the
    deployment is self-hosted, the honest default is "don't ask" — an
    operator on a real Cloud project with BVC entitlement opts back in with
    LIVEKIT_NOISE_CANCELLATION_ENABLED=True.
    """

    @pytest.mark.unit
    def test_flag_defaults_to_off_because_our_livekit_is_self_hosted(self):
        from app.core.config import settings

        assert settings.LIVEKIT_NOISE_CANCELLATION_ENABLED is False
