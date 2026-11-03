# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""The reader's "Follow device" theme is stored as systemTheme.

The new UI resolves it to light or dark from the device. The classic reader
shares the stored settings, so it must cope with the value too: it shows
light or dark to match the device and does not overwrite the saved choice.
"""
from pathlib import Path

import pytest

from cps.reader_settings import sanitize_reader_settings

pytestmark = pytest.mark.unit
ROOT = Path(__file__).resolve().parents[2]


def test_follow_device_is_a_stored_reader_theme():
    assert sanitize_reader_settings({"theme": "systemTheme"}) == {"theme": "systemTheme"}


def test_unknown_themes_are_still_dropped():
    assert sanitize_reader_settings({"theme": "neonTheme"}) == {}


def test_classic_reader_resolves_follow_device_without_saving_over_it():
    source = (ROOT / "cps/static/js/reading/epub.js").read_text(encoding="utf-8")
    assert 'theme === "systemTheme"' in source
    assert "prefers-color-scheme: dark" in source
    assert "selectTheme(theme, theme === savedTheme)" in source
    template = (ROOT / "cps/templates/read.html").read_text(encoding="utf-8")
    assert "function selectTheme (id, persist)" in template
    assert 'if (persist !== false) ReaderSettings.set("theme", id);' in template
