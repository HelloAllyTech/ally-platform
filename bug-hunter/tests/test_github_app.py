"""GitHub App installation tokens: minted from the App key, refreshed before expiry."""

from __future__ import annotations

import base64
import io
import json
import time
import urllib.error

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from bug_hunter import github_app

NOW = 1_800_000_000.0  # 2027-01-15


@pytest.fixture(autouse=True)
def _fresh_cache():
    github_app._reset_cache()
    yield
    github_app._reset_cache()


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def key_file(tmp_path, key):
    path = tmp_path / "app.pem"
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return path


def _unb64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


class FakeGitHub:
    """Answers the two calls the App makes and records them."""

    def __init__(self, expires_at="2027-01-15T09:00:00Z", installation=77):
        self.calls: list[tuple[str, str, str]] = []
        self.expires_at = expires_at
        self.installation = installation
        self.minted = 0

    def __call__(self, req):
        auth = req.get_header("Authorization")
        self.calls.append((req.get_method(), req.full_url, auth))
        if req.full_url.endswith("/orgs/HelloAllyTech/installation"):
            body = {"id": self.installation}
        else:
            self.minted += 1
            body = {"token": f"ghs_token{self.minted}", "expires_at": self.expires_at}
        return io.BytesIO(json.dumps(body).encode())


def _env(key_file, **extra):
    return {
        github_app.ENV_APP_ID: "12345",
        github_app.ENV_KEY_FILE: str(key_file),
        **extra,
    }


def test_the_jwt_is_rs256_signed_by_the_app_key_and_short_lived(key):
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = github_app.app_jwt("12345", pem, now=NOW)
    header, payload, signature = token.split(".")
    assert json.loads(_unb64(header)) == {"alg": "RS256", "typ": "JWT"}
    claims = json.loads(_unb64(payload))
    assert claims == {"iat": int(NOW) - 60, "exp": int(NOW) + 540, "iss": "12345"}
    # verifies against the App's public key (raises if not)
    key.public_key().verify(
        _unb64(signature),
        f"{header}.{payload}".encode(),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def test_mints_a_token_for_the_org_installation_into_the_env(key_file):
    gh = FakeGitHub()
    env = _env(key_file)
    assert github_app.refresh_env(env, opener=gh, now=NOW) is True
    assert env[github_app.ENV_TOKEN] == "ghs_token1"
    assert env["GH_TOKEN"] == "ghs_token1"  # gh and git's credential helper
    assert [c[:2] for c in gh.calls] == [
        ("GET", "https://api.github.com/orgs/HelloAllyTech/installation"),
        ("POST", "https://api.github.com/app/installations/77/access_tokens"),
    ]
    assert all(c[2].startswith("Bearer ey") for c in gh.calls)  # the JWT, not a token


def test_a_known_installation_skips_the_lookup(key_file):
    gh = FakeGitHub()
    env = _env(key_file, **{github_app.ENV_INSTALLATION: "99"})
    github_app.refresh_env(env, opener=gh, now=NOW)
    assert [c[1] for c in gh.calls] == [
        "https://api.github.com/app/installations/99/access_tokens"
    ]


def test_reuses_the_token_until_ten_minutes_before_it_expires(key_file):
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW + 3600))
    gh = FakeGitHub(expires_at=stamp)
    env = _env(key_file, **{github_app.ENV_INSTALLATION: "99"})
    github_app.refresh_env(env, opener=gh, now=NOW)
    github_app.refresh_env(env, opener=gh, now=NOW + 45 * 60)  # 15 min left: kept
    assert env["GH_TOKEN"] == "ghs_token1"
    github_app.refresh_env(env, opener=gh, now=NOW + 52 * 60)  # 8 min left: re-minted
    assert env["GH_TOKEN"] == "ghs_token2"
    assert gh.minted == 2


def test_without_the_app_a_hand_set_token_is_left_alone():
    env = {github_app.ENV_TOKEN: "github_pat_mine"}
    assert github_app.refresh_env(env, opener=FakeGitHub(), now=NOW) is False
    assert env == {github_app.ENV_TOKEN: "github_pat_mine"}


def test_an_unreadable_key_is_a_clear_error_without_the_key(tmp_path):
    env = _env(tmp_path / "missing.pem")
    with pytest.raises(github_app.GitHubAppError, match="cannot read the App key"):
        github_app.refresh_env(env, opener=FakeGitHub(), now=NOW)


def test_a_refusal_names_the_call_not_the_secret(key_file):
    def refuse(req):
        raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)

    with pytest.raises(github_app.GitHubAppError) as err:
        github_app.refresh_env(_env(key_file), opener=refuse, now=NOW)
    assert "401" in str(err.value)
    assert "BEGIN" not in str(err.value)
