"""Regression test: a secret must never appear in pytest's output.

pytest prints a failing test's arguments and (with -l) its local variables, so
a live test that takes `auth_headers` or `ingest_secret` used to print the raw
INGEST_SECRET whenever it failed. tests/conftest.py now redacts every report.

This test runs an inner pytest session that uses the project's REAL
conftest.py and a FAKE secret, makes it fail in every phase (setup, call,
teardown) and through every channel (function arguments, locals, assertion
messages, captured output, skip reasons), and checks that the fake value — or
any 8-character piece of it — appears nowhere in the output. Offline: no
network, no real secret.
"""
import pathlib

import pytest

CONFTEST_SOURCE = (pathlib.Path(__file__).parent / "conftest.py").read_text(
    encoding="utf-8"
)

# Deliberately fake. Never put the real secret in a test.
FAKE_SECRET = "FAKE-NOT-A-REAL-SECRET-7Qm2Xv9Lp4Rz8Kw3"
MARKER = "[REDACTED]"
FRAGMENT = 8

INNER_TESTS = '''
import pytest


def test_call_failure_with_auth_headers(auth_headers, base_url):
    header = auth_headers["Authorization"]
    assert header == "Bearer something-else", f"header was {header}"


def test_call_failure_with_raw_secret(ingest_secret):
    print("captured stdout:", ingest_secret)
    assert ingest_secret.startswith("nope")


def test_long_local_is_cut_in_the_middle(ingest_secret):
    # pytest shortens long reprs by cutting out their middle, which leaves
    # part of the secret on screen unless fragments are redacted too.
    big = "x" * 100 + ingest_secret + "y" * 200
    assert big == ""


@pytest.fixture
def broken_setup(auth_headers):
    raise RuntimeError(f"setup blew up with {auth_headers}")


def test_setup_error(broken_setup):
    pass


@pytest.fixture
def broken_teardown(ingest_secret):
    yield
    raise RuntimeError(f"teardown blew up with {ingest_secret}")


def test_teardown_error(broken_teardown):
    pass


def test_skip_reason(ingest_secret):
    pytest.skip(f"skipping because of {ingest_secret}")


def test_passing_but_prints(ingest_secret):
    print("a passing test printed", ingest_secret)
'''


def _leaks(text: str) -> list[str]:
    """Every line of `text` holding the fake secret or a piece of it."""
    pieces = {
        FAKE_SECRET[i:i + FRAGMENT] for i in range(len(FAKE_SECRET) - FRAGMENT + 1)
    }
    return [line for line in text.splitlines() if any(p in line for p in pieces)]


@pytest.fixture
def inner_session(pytester, monkeypatch):
    monkeypatch.setenv("INGEST_SECRET", FAKE_SECRET)
    # A dead address: nothing in the inner session touches the network.
    monkeypatch.setenv("RAG_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.delenv("RAG_ALLOW_PROD_WRITES", raising=False)
    pytester.makeconftest(CONFTEST_SOURCE)
    pytester.makepyfile(test_inner=INNER_TESTS)
    return pytester


@pytest.mark.parametrize("showlocals", [False, True], ids=["", "showlocals"])
@pytest.mark.parametrize("tb", ["auto", "long", "short", "line", "native", "no"])
def test_secret_never_appears_in_output(inner_session, tb, showlocals):
    args = [f"--tb={tb}", "-rA", "-vv"]
    if showlocals:
        args.append("-l")
    result = inner_session.runpytest(*args)

    # The inner tests really failed, errored, skipped and passed; otherwise
    # an empty output would pass this test vacuously.
    result.assert_outcomes(failed=3, errors=2, skipped=1, passed=2)

    output = result.stdout.str() + "\n" + result.stderr.str()
    leaked = _leaks(output)
    assert not leaked, (
        f"fake secret leaked with --tb={tb} showlocals={showlocals}:\n"
        + "\n".join(leaked)
    )
    # The redacted text was printed — not merely absent.
    assert MARKER in output


def test_secret_never_appears_in_junit_xml(inner_session):
    xml_path = inner_session.path / "report.xml"
    result = inner_session.runpytest("--tb=long", "-l", f"--junitxml={xml_path}")
    result.assert_outcomes(failed=3, errors=2, skipped=1, passed=2)

    xml = xml_path.read_text(encoding="utf-8")
    leaked = _leaks(xml)
    assert not leaked, "fake secret leaked into JUnit XML:\n" + "\n".join(leaked)
    assert MARKER in xml
