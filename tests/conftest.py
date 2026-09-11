# Shared fixtures for RAG endpoint tests. Lookups are lazy (inside fixtures,
# not at module import time) so offline tests that never request these
# fixtures — e.g. test_chunker.py — can still be collected and run without
# RAG_BASE_URL / INGEST_SECRET set. A contributor without the admin secret
# sees live endpoint tests SKIP with a clear reason instead of a collection
# error.
import os

import pytest

# `pytester` runs an inner pytest session; test_secret_redaction.py uses it to
# prove the redaction hook below really keeps secrets out of test output.
pytest_plugins = ["pytester"]


# --------------------------------------------------------------------------
# Secret redaction for test reports.
#
# pytest's tracebacks print a failing function's ARGUMENTS (the default
# --tb=long style) and, with -l, every local variable. Any live test that takes
# `auth_headers` or `ingest_secret` would therefore print the raw token the
# moment it fails — which is how this project's first secret exposure happened.
# The hookwrapper below rewrites every test report (collection, setup, call and
# teardown) before anything prints it, replacing each secret value with a fixed
# marker. It works on the report object itself, so it covers every --tb style,
# -l, -r summaries, captured output, and --junitxml alike.
# pytest.ini adds `--tb=short` (no function arguments) as a second layer.
# --------------------------------------------------------------------------

REDACTED = "[REDACTED]"

# Environment variables whose values must never appear in test output.
_SECRET_ENV_VARS = ("INGEST_SECRET", "CF_API_TOKEN", "CF_ACCOUNT_ID")

# pytest shortens long reprs by cutting out their middle ("abc...xyz"), which
# can leave a piece of a secret behind. Any run of at least this many
# consecutive characters of a secret is redacted too.
_MIN_FRAGMENT = 8

# Snapshot at import as well as reading at report time, so a test that
# monkeypatches or deletes a variable cannot switch redaction off for itself.
_SECRETS_AT_STARTUP = {os.environ.get(name) for name in _SECRET_ENV_VARS}


def _secret_values() -> list[str]:
    values = set(_SECRETS_AT_STARTUP)
    values.update(os.environ.get(name) for name in _SECRET_ENV_VARS)
    values = {v for v in values if v and v.strip()}
    # repr() escapes some characters; cover the escaped spelling too.
    values.update(repr(v)[1:-1] for v in list(values))
    return sorted(values, key=len, reverse=True)


def _redact_text(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret in text:
            text = text.replace(secret, REDACTED)
        if len(secret) < _MIN_FRAGMENT:
            continue
        windows = range(len(secret) - _MIN_FRAGMENT + 1)
        # Fast path: any fragment contains at least one minimum-length window.
        if not any(secret[i:i + _MIN_FRAGMENT] in text for i in windows):
            continue
        for length in range(len(secret) - 1, _MIN_FRAGMENT - 1, -1):
            for start in range(len(secret) - length + 1):
                fragment = secret[start:start + length]
                if fragment in text:
                    text = text.replace(fragment, REDACTED)
    return text


def _scrub(value, secrets, seen):
    """Return `value` with every string inside it redacted.

    Walks strings, lists, tuples, dicts and pytest's own report objects
    (ReprEntry, ReprFuncArgs, ReprLocals, ReprFileLocation, ...), mutating the
    latter in place so their structure — and pytest's formatting of them —
    is preserved.
    """
    if isinstance(value, str):
        return _redact_text(value, secrets)
    if id(value) in seen:
        return value
    if isinstance(value, list):
        seen.add(id(value))
        value[:] = [_scrub(v, secrets, seen) for v in value]
        return value
    if isinstance(value, tuple):
        return tuple(_scrub(v, secrets, seen) for v in value)
    if isinstance(value, dict):
        seen.add(id(value))
        return {k: _scrub(v, secrets, seen) for k, v in value.items()}
    if hasattr(value, "__dict__") and type(value).__module__.startswith("_pytest"):
        seen.add(id(value))
        for name, attr in list(vars(value).items()):
            object.__setattr__(value, name, _scrub(attr, secrets, seen))
    return value


def _redact_report(report) -> None:
    secrets = _secret_values()
    if not secrets:
        return
    seen: set[int] = set()
    for attr in ("longrepr", "sections", "user_properties", "wasxfail"):
        if getattr(report, attr, None) is not None:
            setattr(report, attr, _scrub(getattr(report, attr), secrets, seen))
    # Belt and braces: if some report shape the walk above does not know
    # about still renders a secret, replace the whole longrepr with its
    # redacted rendering. Skip reports keep their (path, line, reason) tuple,
    # which pytest's summary code requires.
    longrepr = getattr(report, "longrepr", None)
    if longrepr is not None and not isinstance(longrepr, tuple):
        rendered = str(longrepr)
        redacted = _redact_text(rendered, secrets)
        if redacted != rendered:
            report.longrepr = redacted


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    _redact_report(outcome.get_result())


@pytest.hookimpl(hookwrapper=True)
def pytest_make_collect_report(collector):
    outcome = yield
    _redact_report(outcome.get_result())


# --------------------------------------------------------------------------
# Live-endpoint fixtures.
# --------------------------------------------------------------------------


@pytest.fixture(scope="session")
def base_url() -> str:
    url = os.environ.get("RAG_BASE_URL")
    if not url:
        pytest.skip("RAG_BASE_URL not set — skipping live endpoint test")
    return url


@pytest.fixture(scope="session")
def auth_headers() -> dict:
    secret = os.environ.get("INGEST_SECRET")
    if not secret:
        pytest.skip("INGEST_SECRET not set — skipping live endpoint test")
    return {"Authorization": f"Bearer {secret}"}


@pytest.fixture(scope="session")
def ingest_secret() -> str:
    secret = os.environ.get("INGEST_SECRET")
    if not secret:
        pytest.skip("INGEST_SECRET not set — skipping live endpoint test")
    return secret


@pytest.fixture(scope="session")
def allow_prod_writes() -> None:
    """Gate for tests that WRITE to the production Vectorize index.

    There is no separate test index: RAG_BASE_URL is the live site, and the
    index it writes to is the one students' chat retrieves from. So a test
    that upserts or deletes vectors runs only when RAG_ALLOW_PROD_WRITES=1 is
    set deliberately. List this fixture FIRST in a writing test's arguments
    so the skip reason names the write gate. Tests that are rejected before
    anything is written (401s, 400s) do not need it.
    """
    if os.environ.get("RAG_ALLOW_PROD_WRITES") != "1":
        pytest.skip(
            "writes to the PRODUCTION index — set RAG_ALLOW_PROD_WRITES=1 "
            "to run this test deliberately"
        )
