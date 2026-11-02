# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-3.0-or-later
"""Saves that arrive late: ``observed_at`` on POST /api/v1/books/<id>/bookmark.

The installed web app queues reading positions while offline and sends them
when the connection returns, possibly hours later. The request time is then
not the reading time. Each save says when it was made (``observed_at``) and:

* a save older than the place already saved for the book never replaces it
  (another tab or device moved on meanwhile), but is still journalled;
* the same save sent twice (a retry, or the page-close send racing the queued
  one) changes nothing the second time;
* with "Share my place" ticked, a late save loses to a newer Kobo place and
  beats an older one, by when each was read, not when each arrived;
* the Kobo still receives a late save that wins: its sync clock is advanced by
  the receipt time, not the (older) reading time;
* clients that don't send ``observed_at`` behave exactly as before (covered by
  the existing share-place and reader API suites).

Runs on the real "Share my place" world (``test_share_place_web_gates``).
"""
from datetime import datetime, timedelta, timezone

import pytest

from cps import ub
from cps.services import reading_position
from tests.unit.kobo_state_world import read_column_class  # noqa: F401  (fixture)
from tests.unit.share_place_span_world import BOOK, _now, sw  # noqa: F401  (fixture)
from tests.unit.test_share_place_web_gates import (  # noqa: F401  (fixtures)
    browser, cfi_of, file_backed, gates_enforced, journal, location_of,
    row_span, rows, shared_bookmark, w,
)

pytestmark = pytest.mark.unit


def iso(moment):
    return moment.replace(tzinfo=timezone.utc).isoformat()


def post(w, percent, cfi, observed_at=None):
    body = {"format": "epub", "bookmark": cfi, "percentage": percent}
    if observed_at is not None:
        body["observed_at"] = observed_at if isinstance(observed_at, str) else iso(observed_at)
    response = w.web.post(f"/api/v1/books/{BOOK}/bookmark", json=body)
    w.session.expire_all()
    return response


def saved_cfi(w):
    response = w.web.get(f"/api/v1/books/{BOOK}/bookmark")
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()["bookmark"]


# -- parsing --------------------------------------------------------------------

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("raw, expected", [
    (None, None),
    ("", None),
    ("2026-11-02T10:00:00Z", datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)),
    ("2026-11-02T11:00:00+01:00", datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)),
    ("2026-11-02T10:00:00.250", datetime(2026, 11, 2, 10, 0, 0, 250000, tzinfo=timezone.utc)),
    # A phone clock ahead of the server cannot place a reading in the future.
    ("2026-11-02T13:00:00Z", NOW),
    # Days in a queue are real: no lower bound.
    ("2026-10-01T08:00:00Z", datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)),
])
def test_observed_at_is_parsed_to_utc_and_capped_at_now(raw, expected):
    assert reading_position.coerce_observed_at(raw, now=NOW) == expected


@pytest.mark.parametrize("raw", ["yesterday", 1730000000, {"at": 1}, "2026-13-40T00:00:00Z"])
def test_observed_at_rejects_what_is_not_a_timestamp(raw):
    with pytest.raises(reading_position.InvalidObservedAt):
        reading_position.coerce_observed_at(raw, now=NOW)


def test_an_unparseable_observed_at_is_a_400_and_saves_nothing(w, rows):
    response = post(w, 20, cfi_of(w, rows["early"]), observed_at="not a time")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "invalid_observed_at"
    assert saved_cfi(w) is None


# -- the browser's own saved place ----------------------------------------------

def test_a_late_save_does_not_replace_a_newer_saved_place(w, rows):
    browser(w, checked=False)
    newer = cfi_of(w, rows["mid"])
    assert post(w, 45, newer, observed_at=_now() - timedelta(minutes=5)).status_code == 204

    late = post(w, 20, cfi_of(w, rows["early"]), observed_at=_now() - timedelta(hours=2))

    assert late.status_code == 204
    assert saved_cfi(w) == newer


def test_queued_saves_still_apply_in_reading_order(w, rows):
    """Two saves queued offline arrive in order, both after the fact. The later
    reading replaces the earlier one even though both are hours old."""
    browser(w, checked=False)
    first = _now() - timedelta(hours=3)
    post(w, 20, cfi_of(w, rows["early"]), observed_at=first)

    later = cfi_of(w, rows["late"])
    post(w, 60, later, observed_at=first + timedelta(minutes=10))

    assert saved_cfi(w) == later


def test_the_same_save_twice_changes_nothing_the_second_time(w, rows):
    me = browser(w, checked=True)
    cfi = cfi_of(w, rows["mid"])
    observed = _now() - timedelta(minutes=30)
    assert post(w, 45, cfi, observed_at=observed).status_code == 204
    shared_before = shared_bookmark(w)
    journal_before = journal(w, me).server_modified_at

    again = post(w, 45, cfi, observed_at=observed)

    assert again.status_code == 204
    assert saved_cfi(w) == cfi
    assert shared_bookmark(w) == shared_before
    assert journal(w, me).server_modified_at == journal_before


def test_the_journal_records_when_the_place_was_read(w, rows):
    me = browser(w, checked=False)
    observed = _now() - timedelta(hours=1)

    post(w, 45, cfi_of(w, rows["mid"]), observed_at=observed)

    own = journal(w, me)
    assert own.client_modified_at.replace(tzinfo=None) == observed
    assert own.server_modified_at.replace(tzinfo=None) > observed + timedelta(minutes=59)


# -- "Share my place": ordered by reading time, delivered by receipt time --------

def test_a_late_browser_save_loses_to_a_newer_kobo_place(w, rows):
    kobo = w.kobo_device("Kobo Clara BW", checked=True)
    own = rows["kobo-own"]
    w.put(kobo, own["source"], own["span"], 5, _now() - timedelta(minutes=10))
    browser(w, checked=True)

    post(w, 60, cfi_of(w, rows["late"]), observed_at=_now() - timedelta(minutes=30))

    assert shared_bookmark(w)[0] == pytest.approx(5)


def test_a_late_browser_save_beats_an_older_kobo_place_and_reaches_the_kobo(w, rows):
    from cps.services.kobo_post_download_restore import record_download
    import logging
    kobo = w.kobo_device("Kobo Clara BW", checked=True)
    record_download(device_id=kobo.id, book_id=BOOK, book_format="kepub",
                    log=logging.getLogger("test"))
    w.session.commit()
    own = rows["kobo-own"]
    w.put(kobo, own["source"], own["span"], 5, _now() - timedelta(hours=2))
    w.settle(kobo)
    browser(w, checked=True)

    # Read on the phone an hour ago, offline; sent now.
    post(w, 60, cfi_of(w, rows["late"]), observed_at=_now() - timedelta(hours=1))

    percent, location, _ = shared_bookmark(w)
    assert percent == pytest.approx(60)
    assert location == row_span(rows, "late")
    # The Kobo's last sync was after the reading time but before the receipt:
    # it must still be sent the new place.
    assert w.synced_location(kobo) == row_span(rows, "late")
