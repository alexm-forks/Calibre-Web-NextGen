# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""OAuth/OIDC logins are remembered, for a rolling 30 days.

The password form's "Remember me" is ticked by default; a provider button has
no checkbox, and an instance with password login disabled or an automatic
provider redirect shows none at all. Provider logins therefore ended with the
browser session, which for an installed web app on a phone means signing in
at the provider again whenever the app is closed in the background.
CWNG_OAUTH_REMEMBER turns it off; CWNG_OAUTH_REMEMBER_DAYS sets the rolling
lifetime (test_rolling_remember_cookie.py covers the cookie itself).
"""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import cps.oauth_bb as oauth_bb
from tests.unit.login_world import oauth_callback_app

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("value, expected", [
    (None, True),
    ("1", True),
    ("true", True),
    ("0", False),
    ("false", False),
    ("off", False),
    ("", False),
    (" No ", False),
])
def test_remember_setting(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("CWNG_OAUTH_REMEMBER", raising=False)
    else:
        monkeypatch.setenv("CWNG_OAUTH_REMEMBER", value)
    assert oauth_bb.oauth_login_remembered() is expected


def _login(monkeypatch, env):
    if env is None:
        monkeypatch.delenv("CWNG_OAUTH_REMEMBER", raising=False)
    else:
        monkeypatch.setenv("CWNG_OAUTH_REMEMBER", env)
    app = oauth_callback_app()
    user = SimpleNamespace(id=7, name="alice")
    entry = SimpleNamespace(user=user, user_id=user.id)
    db_session = MagicMock()
    db_session.query.return_value.filter_by.return_value.first.return_value = entry
    with app.test_request_context("/login/generic/authorized"), \
            patch.object(oauth_bb.ub, "session", db_session), \
            patch.object(oauth_bb, "current_user", SimpleNamespace(is_authenticated=False)), \
            patch.object(oauth_bb, "login_user") as login_user, \
            patch.object(oauth_bb, "flash"), \
            patch.object(oauth_bb, "_oauth_success_redirect", return_value="/"):
        oauth_bb.bind_oauth_or_register("3", "provider-user", "generic.login", "generic")
    return login_user


def test_provider_login_is_remembered_for_a_rolling_30_days_by_default(monkeypatch):
    monkeypatch.delenv("CWNG_OAUTH_REMEMBER_DAYS", raising=False)
    _login(monkeypatch, None).assert_called_once_with(
        SimpleNamespace(id=7, name="alice"), remember=True,
        duration=timedelta(days=30), rolling=True)


def test_provider_login_can_be_kept_to_the_browser_session(monkeypatch):
    _login(monkeypatch, "0").assert_called_once_with(
        SimpleNamespace(id=7, name="alice"), remember=False,
        duration=None, rolling=False)


@pytest.mark.parametrize("value, days", [
    (None, 30), ("", 30), ("7", 7), ("365", 365), ("0", 30), ("366", 30), ("a week", 30),
])
def test_remember_days_setting(monkeypatch, value, days):
    if value is None:
        monkeypatch.delenv("CWNG_OAUTH_REMEMBER_DAYS", raising=False)
    else:
        monkeypatch.setenv("CWNG_OAUTH_REMEMBER_DAYS", value)
    assert oauth_bb.oauth_remember_duration() == timedelta(days=days)
