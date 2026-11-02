# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""Rolling remember cookies (cps/cw_login, login_user(rolling=True)).

OAuth/OIDC logins are remembered for a rolling 30 days: the remember cookie
is renewed while the login is in use, so it lapses after 30 days without a
visit rather than 30 days after sign-in. Password logins keep the fixed
expiry they always had. The duration travels inside the signed cookie, so a
login restored from it after the browser session ended keeps rolling.

These run the real vendored login manager on a small Flask app.
"""
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import flask
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from cps import ub

from cps.cw_login import LoginManager, UserMixin, login_user, logout_user, current_user
from cps.cw_login import login_manager as login_manager_module

pytestmark = pytest.mark.unit

COOKIE = "remember_token"
DAY = 24 * 3600


class User(UserMixin):
    def __init__(self, user_id):
        self.id = user_id


@pytest.fixture
def db(tmp_path, monkeypatch):
    """login_user records each login in ub.User_Sessions (ub.store_user_session)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'app.db'}")
    ub.Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setattr(ub, "session", session)
    return session


@pytest.fixture
def web(db):
    # Not named `app`: pytest-flask keeps an app context open for a fixture of
    # that name, which would let one client's login leak into another's.
    app = flask.Flask(__name__)
    app.config.update(SECRET_KEY="test", TESTING=True, REMEMBER_COOKIE_NAME=COOKIE)
    manager = LoginManager()
    manager.init_app(app)

    @manager.user_loader
    def load(user_id, _random=None, _session_key=None):
        return User(user_id) if str(user_id) == "7" else None

    @app.route("/login/<kind>")
    def login(kind):
        if kind == "rolling":
            login_user(User(7), remember=True, duration=timedelta(days=30), rolling=True)
        else:
            login_user(User(7), remember=True)
        return "ok"

    @app.route("/me")
    def me():
        return current_user.get_id() if current_user.is_authenticated else "anonymous"

    @app.route("/logout")
    def logout():
        logout_user()
        return "bye"

    return app


@pytest.fixture
def clock(monkeypatch):
    """Move the clock the renewal check reads."""
    now = {"t": datetime.now(timezone.utc).timestamp()}
    monkeypatch.setattr(login_manager_module, "_clock", lambda: now["t"])
    return now


def remember_cookie(response):
    for header in response.headers.getlist("Set-Cookie"):
        if header.startswith(COOKIE + "="):
            return header
    return None


def expires_in_days(header):
    expires = next(part.split("=", 1)[1] for part in header.split("; ")
                   if part.lower().startswith("expires="))
    return (parsedate_to_datetime(expires) - datetime.now(timezone.utc)).total_seconds() / DAY


def test_a_rolling_login_is_remembered_for_its_duration(web, clock):
    client = web.test_client()
    header = remember_cookie(client.get("/login/rolling"))
    assert header is not None
    assert 29.9 < expires_in_days(header) <= 30


def test_a_rolling_cookie_is_not_reissued_on_every_request(web, clock):
    client = web.test_client()
    client.get("/login/rolling")
    clock["t"] += 2 * DAY
    response = client.get("/me")
    assert response.get_data(as_text=True) == "7"
    assert remember_cookie(response) is None


def test_a_rolling_cookie_is_renewed_once_past_half_its_life(web, clock):
    client = web.test_client()
    client.get("/login/rolling")
    clock["t"] += 16 * DAY
    header = remember_cookie(client.get("/me"))
    assert header is not None, "a login still in use must not lapse 30 days after sign-in"
    assert 29.9 < expires_in_days(header) <= 30
    # ...and not again straight away.
    clock["t"] += 60
    assert remember_cookie(client.get("/me")) is None


def test_a_restored_rolling_login_keeps_rolling(web, clock):
    """The browser session ended (the phone closed the app): only the
    remember cookie is left. The login comes back and its cookie is renewed,
    with the same rolling duration, read from the signed cookie itself."""
    first = web.test_client()
    cookie = remember_cookie(first.get("/login/rolling")).split(";", 1)[0].split("=", 1)[1]

    fresh = web.test_client()
    fresh.set_cookie(COOKIE, cookie)
    clock["t"] += 3 * DAY
    response = fresh.get("/me")
    assert response.get_data(as_text=True) == "7"
    header = remember_cookie(response)
    assert header is not None
    assert 29.9 < expires_in_days(header) <= 30

    clock["t"] += 20 * DAY
    assert remember_cookie(fresh.get("/me")) is not None, "still rolling after a restore"


def test_a_fixed_login_keeps_its_fixed_expiry(web, clock):
    """Password logins: unchanged. Set once, 365 days, never renewed."""
    client = web.test_client()
    header = remember_cookie(client.get("/login/fixed"))
    assert 364.9 < expires_in_days(header) <= 365
    clock["t"] += 200 * DAY
    assert remember_cookie(client.get("/me")) is None

    cookie = header.split(";", 1)[0].split("=", 1)[1]
    fresh = web.test_client()
    fresh.set_cookie(COOKIE, cookie)
    response = fresh.get("/me")
    assert response.get_data(as_text=True) == "7"
    assert remember_cookie(response) is None


def test_a_fixed_login_after_a_rolling_one_does_not_roll(web, clock):
    client = web.test_client()
    client.get("/login/rolling")
    header = remember_cookie(client.get("/login/fixed"))
    assert 364.9 < expires_in_days(header) <= 365
    clock["t"] += 200 * DAY
    assert remember_cookie(client.get("/me")) is None


def test_logout_clears_a_rolling_login(web, clock):
    client = web.test_client()
    client.get("/login/rolling")
    response = client.get("/logout")
    header = remember_cookie(response)
    assert header is not None and ("Max-Age=0" in header or "1970" in header)
    assert client.get("/me").get_data(as_text=True) == "anonymous"
    clock["t"] += 20 * DAY
    assert remember_cookie(client.get("/me")) is None


# -- the server-side record of the login --------------------------------------

def _expiry_days(db):
    db.expire_all()
    row = db.query(ub.User_Sessions).one()
    return (row.expiry - datetime.now().timestamp()) / DAY


def test_renewal_keeps_the_server_side_login_record_alive(web, clock, db):
    """load_user refuses a remember cookie whose User_Sessions row is gone, and
    the clean-up task deletes rows past expiry (31 days after sign-in).
    Renewing the cookie must move that expiry too, or a rolling login would
    still end a month after sign-in."""
    client = web.test_client()
    client.get("/login/rolling")
    row = db.query(ub.User_Sessions).one()
    row.expiry = int(datetime.now().timestamp()) + 2 * DAY  # nearly due
    db.commit()

    clock["t"] += 16 * DAY
    assert remember_cookie(client.get("/me")) is not None
    assert 29.9 < _expiry_days(db) <= 30


def test_extending_a_login_record_never_shortens_it(db):
    far = int(datetime.now().timestamp()) + 60 * DAY
    db.add(ub.User_Sessions(7, "key", "rand", far))
    db.commit()
    ub.extend_user_session(7, "rand", 30 * DAY)
    db.expire_all()
    assert db.query(ub.User_Sessions).one().expiry == far
