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
"""

from urllib.parse import urlparse

# LiveKit Cloud (and its sandbox/dev domain) — the only deployments that can
# run a server-side audio filter.
_CLOUD_HOST_SUFFIXES = (".livekit.cloud", ".livekit.run")


def supports_noise_cancellation(livekit_url: str) -> bool:
    """True when the LiveKit deployment at ``livekit_url`` can run Krisp BVC."""
    try:
        hostname = urlparse(livekit_url or "").hostname
    except ValueError:  # malformed URL — treat as "can't"
        return False
    return bool(hostname) and hostname.endswith(_CLOUD_HOST_SUFFIXES)
