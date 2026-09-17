# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] — unreleased

- Word previews for `.docx` and `.docm`: headings, inline formatting, nested
  lists, tables, embedded images, quotes, alignment and external links
- Spreadsheet previews for `.xlsx` and `.xlsm`, rendered in the browser with no
  dependency: a zip reader built on `DecompressionStream` plus `DOMParser`
- Multi-sheet tabs, sticky column letters and row numbers, shared strings,
  dates from serial numbers, booleans
- Ceilings of 20 MB, 2,000 rows, 64 columns and 4,000 document blocks; every
  failure path lands on the file card with its own message, including a
  specific one for pages opened over `file://`

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
- `renderers` option for plugging in previews Filedeck doesn't ship, keyed by
  file extension, sync or async, falling back to the file card on failure
- `data-download` for separating the preview URL from the download URL
