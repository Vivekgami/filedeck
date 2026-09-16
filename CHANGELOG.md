# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First release.

- Attachment viewer driven entirely by DOM attributes — no server payload,
  no build step required to use it
- Images with zoom and pan, PDFs via the browser's own viewer, video, audio,
  and labelled cards for file types no browser can render
- Kind detected from the file extension, overridable with `data-kind`
- Touch gestures: swipe to navigate, swipe down to dismiss, pinch to zoom
- Keyboard navigation, focus trap, focus restore, live-region announcements
- Every visible string overridable through `labels`
- Theming through `--fd-*` custom properties
