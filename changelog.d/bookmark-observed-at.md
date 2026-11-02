### Added

- **Reading positions saved offline are ordered by when you read, not when
  they arrive.** The reader's position save now accepts an optional
  `observed_at` time. A save queued while offline no longer replaces a newer
  place saved since, and a newer place from your Kobo or KOReader is no longer
  overwritten by it. A late save that is still the newest reaches your
  devices as before. Sending the same save twice changes nothing.
