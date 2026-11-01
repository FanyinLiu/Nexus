"""Loopback/token gate shared by Nexus-launched local speech sidecars.

The Electron main process passes a per-launch secret in
``NEXUS_SIDECAR_TOKEN`` and sends ``Authorization: Bearer <token>`` on every
request. A missing token at startup is fatal: an unauthenticated sidecar would
let any local process or rebound web page drive the model.

Host and Origin checks stop DNS-rebinding pages even before the token check;
only loopback hosts and absent/loopback origins are accepted. The helpers here
are deliberately dependency-free so the servers keep their lazy ML imports and
stay unit-testable.
"""

from __future__ import annotations

import hmac
import os
from urllib.parse import urlsplit

TOKEN_ENV = "NEXUS_SIDECAR_TOKEN"
TOKEN_HEADER = "X-Nexus-Token"

MAX_JSON_BODY_BYTES = 1024 * 1024
MAX_AUDIO_BODY_BYTES = 50 * 1024 * 1024

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
_BODY_METHODS = {"POST", "PUT", "PATCH"}


def load_sidecar_token(environ=None):
    """Read the launch token, returning an empty string when it is absent."""
    source = os.environ if environ is None else environ
    return str(source.get(TOKEN_ENV) or "").strip()


def require_sidecar_token(environ=None):
    """Return the launch token or refuse to start (fail closed)."""
    token = load_sidecar_token(environ)
    if not token:
        raise SystemExit(
            f"refusing to start: {TOKEN_ENV} is required for Nexus sidecars"
        )
    return token


def tokens_match(expected, provided):
    """Constant-time token comparison; an empty expected token never matches."""
    if not expected or not provided:
        return False
    return hmac.compare_digest(str(expected), str(provided))


def _get_header(headers, name):
    value = headers.get(name)
    if value is None:
        value = headers.get(name.lower())
    return str(value or "")


def extract_bearer_token(headers):
    """Accept ``Authorization: Bearer`` first, then the convenience header."""
    authorization = _get_header(headers, "Authorization").strip()
    if authorization:
        scheme, separator, credentials = authorization.partition(" ")
        if separator and scheme.lower() == "bearer":
            return credentials.strip()
    return _get_header(headers, TOKEN_HEADER).strip()


def _split_host_header(value):
    raw = str(value or "").strip()
    if not raw:
        return None, None

    if raw.startswith("["):
        end = raw.find("]")
        if end <= 0:
            return None, None
        host = raw[1:end]
        rest = raw[end + 1 :]
        if rest and not rest.startswith(":"):
            return None, None
        port_text = rest[1:]
    else:
        if raw.count(":") > 1:
            return None, None
        host, separator, port_text = raw.partition(":")
        if not separator:
            port_text = ""

    if port_text and not port_text.isdigit():
        return None, None
    port = int(port_text) if port_text else None
    if port is not None and not 0 < port <= 65535:
        return None, None
    return host.lower(), port


def is_loopback_host_header(host_header, expected_port=None):
    """True for 127.0.0.1 / localhost / [::1], optionally on one port."""
    host, port = _split_host_header(host_header)
    if not host or host not in _LOOPBACK_HOSTS:
        return False
    if expected_port is None:
        return True
    return port == int(expected_port)


def is_loopback_origin(origin):
    """True when Origin is absent or loopback/file; any other Origin is rejected."""
    value = str(origin or "").strip()
    if not value:
        return True
    if value.lower() == "null":
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    if parts.scheme == "file":
        return not parts.netloc
    return (parts.hostname or "").lower() in _LOOPBACK_HOSTS


def content_type_base(content_type):
    """Strip parameters (e.g. multipart boundary) from a Content-Type value."""
    return str(content_type or "").split(";", 1)[0].strip().lower()


def is_content_type_allowed(content_type, allowed):
    """True when the base Content-Type is one of the endpoint's accepted types."""
    return bool(allowed) and content_type_base(content_type) in set(allowed)


def parse_content_length(value):
    """Return a non-negative integer Content-Length, or None when unusable."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        length = int(raw)
    except ValueError:
        return None
    return length if length >= 0 else None


def authorize_request(
    *,
    token,
    method,
    headers,
    content_types=(),
    max_body_bytes=MAX_JSON_BODY_BYTES,
    expected_port=None,
):
    """Return ``(status, message)`` for a rejected request, else ``None``.

    Host/Origin checks run before authentication, the token is compared in
    constant time, and state-changing methods must declare a bounded body.
    """
    if not is_loopback_host_header(
        _get_header(headers, "Host"), expected_port=expected_port
    ):
        return 403, "forbidden host"
    if not is_loopback_origin(_get_header(headers, "Origin")):
        return 403, "forbidden origin"
    if not tokens_match(token, extract_bearer_token(headers)):
        return 401, "unauthorized"

    if str(method or "").upper() in _BODY_METHODS:
        if content_types and not is_content_type_allowed(
            _get_header(headers, "Content-Type"), content_types
        ):
            return 415, "unsupported media type"
        length = parse_content_length(_get_header(headers, "Content-Length"))
        if length is None:
            return 411, "content length required"
        if length > max_body_bytes:
            return 413, "payload too large"
    return None
