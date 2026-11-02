### Added

- **Your reading position is kept when the connection drops.** The new UI's
  reader now saves each position on the device first and sends it when it can:
  at once when online, otherwise when the app is next open with a connection.
  Closing the tab, losing signal or being signed out no longer loses where you
  were, and a position sent late doesn't overwrite newer reading on your Kobo
  or another device. While offline the reader no longer reports "Could not
  save your reading position", since nothing was lost.
