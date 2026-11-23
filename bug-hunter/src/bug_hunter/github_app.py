"""GitHub App installation tokens for the VM.

The VM authenticates to GitHub as the Bug Hunter GitHub App. An installation token lasts
an hour, while the worker runs for days and one graph run can take most of an hour, so
the token is minted here from the App's id and private key and refreshed in the process
environment before each GitHub call (``refresh_env``). Everything downstream reads the
environment at call time: ``BUGHUNTER_GITHUB_TOKEN`` for the REST reader and ``gh``, and
``GH_TOKEN`` for ``gh`` and for ``git push`` through gh's credential helper.

Configured by environment (``/etc/bug-hunter/env`` on the VM):

- ``BUGHUNTER_GITHUB_APP_ID``: the App's id.
- ``BUGHUNTER_GITHUB_APP_KEY_FILE``: path to its private key (PEM), readable only by
  the bughunter user. The key is never logged or printed.
- ``BUGHUNTER_GITHUB_APP_INSTALLATION_ID`` (optional): looked up from the org when
  unset.

A token set by hand (``BUGHUNTER_GITHUB_TOKEN`` without the App variables: a developer's
own token, or the fine-grained fallback) is left alone.
"""

from __future__ import annotations

import base64
import calendar
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable, MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API = "https://api.github.com"
ORG = "HelloAllyTech"
ENV_TOKEN = "BUGHUNTER_GITHUB_TOKEN"
ENV_APP_ID = "BUGHUNTER_GITHUB_APP_ID"
ENV_KEY_FILE = "BUGHUNTER_GITHUB_APP_KEY_FILE"
ENV_INSTALLATION = "BUGHUNTER_GITHUB_APP_INSTALLATION_ID"
# Re-mint this long before expiry, so a token never runs out mid-call.
REFRESH_MARGIN_S = 10 * 60

Opener = Callable[[urllib.request.Request], Any]


class GitHubAppError(RuntimeError):
    """The App is configured but a token could not be made (message has no secrets)."""


@dataclass
class _Cached:
    token: str
    expires_at: float


_cache: _Cached | None = None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt(app_id: str, private_key_pem: bytes, now: float | None = None) -> str:
    """A 9-minute RS256 JWT for the App (GitHub allows at most 10)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = time.time() if now is None else now
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    # iat 60 s in the past: GitHub's advice for clock drift
    claims = {"iat": int(now) - 60, "exp": int(now) + 540, "iss": str(app_id)}
    payload = _b64(json.dumps(claims).encode())
    key = serialization.load_pem_private_key(private_key_pem, password=None)
    signature = key.sign(  # type: ignore[union-attr]
        f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256()
    )
    return f"{header}.{payload}.{_b64(signature)}"


def _call(opener: Opener, method: str, path: str, bearer: str) -> Any:
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {bearer}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "bug-hunter",
        },
    )
    try:
        with opener(req) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as exc:
        raise GitHubAppError(f"GitHub {method} {path} answered {exc.code}") from None
    except OSError as exc:
        raise GitHubAppError(f"GitHub {method} {path} failed: {exc}") from None


def mint(
    app_id: str,
    private_key_pem: bytes,
    installation_id: str | None = None,
    opener: Opener | None = None,
    now: float | None = None,
) -> _Cached:
    """A fresh installation token and when it expires."""
    opener = opener or (lambda req: urllib.request.urlopen(req, timeout=30))
    jwt = app_jwt(app_id, private_key_pem, now)
    if not installation_id:
        installation_id = str(
            _call(opener, "GET", f"/orgs/{ORG}/installation", jwt)["id"]
        )
    body = _call(
        opener, "POST", f"/app/installations/{installation_id}/access_tokens", jwt
    )
    expires = body.get("expires_at", "")
    try:
        expires_at = float(
            calendar.timegm(time.strptime(expires, "%Y-%m-%dT%H:%M:%SZ"))
        )
    except ValueError:
        expires_at = (time.time() if now is None else now) + 3600
    return _Cached(token=body["token"], expires_at=expires_at)


def configured(env: MutableMapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return bool(env.get(ENV_APP_ID) and env.get(ENV_KEY_FILE))


def refresh_env(
    env: MutableMapping[str, str] | None = None,
    opener: Opener | None = None,
    now: float | None = None,
) -> bool:
    """Put a valid installation token into ``env`` when the App is configured.

    Returns whether a token from the App is in place. A no-op (False) when the App is
    not configured, so a hand-set token or a developer's own ``gh`` login keeps working.
    """
    global _cache
    env = os.environ if env is None else env
    if not configured(env):
        return False
    now_s = time.time() if now is None else now
    if _cache is None or _cache.expires_at - now_s < REFRESH_MARGIN_S:
        key_path = Path(env[ENV_KEY_FILE])
        try:
            key = key_path.read_bytes()
        except OSError:
            raise GitHubAppError(f"cannot read the App key at {key_path}") from None
        _cache = mint(env[ENV_APP_ID], key, env.get(ENV_INSTALLATION), opener, now)
    env[ENV_TOKEN] = _cache.token
    env["GH_TOKEN"] = _cache.token
    return True


def _reset_cache() -> None:
    """Tests only."""
    global _cache
    _cache = None
