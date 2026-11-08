# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""The new UI's shell blueprint (cps/spa.py) over a stand-in Vite bundle.

Shell, manifest and service-worker tests need the real ``spa`` blueprint but
not a frontend build (Fast Tests runs against source). ``spa_shell_app``
writes a minimal index.html and assets/ under a temporary directory, points
the blueprint at it and returns an app serving it.
"""
import flask

DEFAULT_ASSETS = ("index-abc.js", "Reader-def.js", "index-123.css")

INDEX_HTML = (
    "<!doctype html><html><head><title>Calibre-Web NextGen</title></head>"
    "<body><div id=root></div>"
    '<script type="module" src="/static/app/assets/index-abc.js"></script></body></html>'
)


def spa_shell_app(monkeypatch, spa_dir, assets=DEFAULT_ASSETS, *, source_maps=("index-abc.js.map",)):
    """An app serving the spa blueprint from a stand-in bundle in ``spa_dir``.

    ``assets`` are the bundle file names under assets/; ``source_maps`` are
    written too, so a test can check they are left out of the precache. The
    CWNG_SPA and CWNG_PWA switches are cleared (both default on)."""
    import cps.spa as spa_mod
    (spa_dir / "index.html").write_text(INDEX_HTML)
    assets_dir = spa_dir / "assets"
    assets_dir.mkdir()
    for name in (*assets, *source_maps):
        (assets_dir / name).write_text("x")
    monkeypatch.setattr(spa_mod, "_SPA_DIR", str(spa_dir))
    monkeypatch.delenv("CWNG_SPA", raising=False)
    monkeypatch.delenv("CWNG_PWA", raising=False)
    app = flask.Flask(__name__)
    app.register_blueprint(spa_mod.spa)
    return app
