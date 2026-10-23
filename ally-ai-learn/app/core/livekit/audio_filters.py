"""Capability checks for LiveKit room audio filters.

Krisp BVC (``livekit.plugins.noise_cancellation``) is a LiveKit **Cloud**
feature. Handed to ``RoomInputOptions`` against a self-hosted SFU, the Rust
SDK refuses it and the session simply runs unfiltered:

    livekit_ffi::server::room - audio filter cannot be enabled:
        LiveKit Cloud is required
    livekit_ffi::server::audio_stream - failed to initialize the audio filter.
        it will not be enabled for this session.

So the workers gate on the deployment before asking for the filter — same
hostname test the agents SDK uses for its own Cloud-only features.

Two things that gate has to get right, both learned the hard way:

* **Which URL.** A worker *registers* with ``settings.LIVEKIT_URL``, but each
  job connects its room to ``RunningJobInfo.url`` — ``job_assign.url or
  ws_url`` in the SDK's worker, i.e. whatever media URL the server handed
  this particular job. The SDK gates its own Cloud-only features on that job
  URL (``is_cloud(self._info.url)``), and so must we: a Cloud control plane
  can dispatch a job to a media server that is not Cloud, which looks fine to
  a check on the registration URL and still gets the filter refused.
* **No URL can tell.** A deployment can sit on a genuine ``*.livekit.cloud``
  hostname whose media plane still refuses Krisp — which is ours: self-hosted
  LiveKit behind a Cloud-shaped hostname. The URL fix above shipped to prd on
  2026-08-25 and the same FFI error came back the next morning on three
  distinct rooms, because the URL check was passing. So the URL is only ever a
  veto, never a yes: ``LIVEKIT_NOISE_CANCELLATION_ENABLED`` has to agree, and
  it is off by default. An operator turns it on for a Cloud project that
  really does have BVC entitlement.
"""

from typing import Any
from urllib.parse import urlparse

# LiveKit Cloud (and its sandbox/dev domain) — the only deployments that can
# run a server-side audio filter.
_CLOUD_HOST_SUFFIXES = (".livekit.cloud", ".livekit.run")


def session_livekit_url(ctx: Any, fallback: str) -> str:
    """The LiveKit URL this job's room actually connects to.

    ``JobContext`` keeps it on the private ``_info`` (there is no public
    accessor), so read it defensively: anything missing, blank or not a
    string means "the SDK didn't give us one", and the registration URL it
    would have fallen back to is the answer.
    """
    url = getattr(getattr(ctx, "_info", None), "url", None)
    if isinstance(url, str) and url.strip():
        return url
    return fallback


def supports_noise_cancellation(livekit_url: str, *, enabled: bool = True) -> bool:
    """True when the LiveKit deployment at ``livekit_url`` can run Krisp BVC.

    ``livekit_url`` must be the URL of the deployment the session connects to
    (see :func:`session_livekit_url`), not necessarily the worker's own.
    ``enabled`` is the operator kill-switch: False refuses the filter whatever
    the URL says. Both must agree before we ask for BVC.
    """
    if not enabled:
        return False
    try:
        hostname = urlparse(livekit_url or "").hostname
    except (TypeError, ValueError):  # malformed URL — treat as "can't"
        return False
    return bool(hostname) and hostname.endswith(_CLOUD_HOST_SUFFIXES)
