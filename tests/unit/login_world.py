# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""Sign-in plumbing for login and remember-cookie tests.

``remember_login_app`` runs the real vendored login manager (cps/cw_login)
with one known user and routes that sign in with a fixed or a rolling
remember cookie, read who is signed in, and sign out. ``oauth_callback_app``
is the minimum an OAuth callback needs to run in a request context: a
session secret and Babel for its messages.
"""
from datetime import timedelta

import flask
from flask_babel import Babel

from cps.cw_login import LoginManager, UserMixin, current_user, login_user, logout_user

REMEMBER_COOKIE = "remember_token"
KNOWN_USER_ID = 7


class KnownUser(UserMixin):
    def __init__(self, user_id):
        self.id = user_id


def remember_login_app(*, rolling_days=30):
    """GET /login/rolling (rolling ``rolling_days``) or /login/fixed (the
    password form's fixed default), /me (the signed-in id or "anonymous"),
    /logout. Login also records the session in ub.User_Sessions, so pair it
    with a test database bound to ``ub.session``."""
    app = flask.Flask(__name__)
    app.config.update(SECRET_KEY="test", TESTING=True, REMEMBER_COOKIE_NAME=REMEMBER_COOKIE)
    manager = LoginManager()
    manager.init_app(app)

    @manager.user_loader
    def load(user_id, _random=None, _session_key=None):
        return KnownUser(user_id) if str(user_id) == str(KNOWN_USER_ID) else None

    @app.route("/login/<kind>")
    def login(kind):
        if kind == "rolling":
            login_user(KnownUser(KNOWN_USER_ID), remember=True,
                       duration=timedelta(days=rolling_days), rolling=True)
        else:
            login_user(KnownUser(KNOWN_USER_ID), remember=True)
        return "ok"

    @app.route("/me")
    def me():
        return current_user.get_id() if current_user.is_authenticated else "anonymous"

    @app.route("/logout")
    def logout():
        logout_user()
        return "bye"

    return app


def oauth_callback_app():
    app = flask.Flask(__name__)
    app.config["SECRET_KEY"] = "test"
    Babel(app)
    return app
