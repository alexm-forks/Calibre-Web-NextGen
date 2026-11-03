### Fixed

- **Swiping to turn pages works in Firefox for Android.** Firefox treated a
  sideways swipe as a scroll of the chapter and cancelled it before the
  reader saw it end.
- **Text sits centred on the page instead of against the top.** A page holds
  whole lines only, so the space left after the last line all ended up at the
  bottom: with large line spacing, a big gap under the text and very little
  above it. That space is now split between top and bottom.
