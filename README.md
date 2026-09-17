# Filedeck

A dependency-free attachment viewer for the web: images, PDFs, video, audio and
documents, in one overlay. No dependencies, no build step, no server payload —
it reads everything from the DOM it is already looking at.

Add one attribute to the links you already have, and they become a viewer.

---

## Install

**CDN — no build step, no npm:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/filedeck@0.1/dist/filedeck.min.css">
<script src="https://cdn.jsdelivr.net/npm/filedeck@0.1/dist/filedeck.umd.min.js"></script>
<script>window.filedeck = new Filedeck();</script>
```

**Self-hosted** — copy `dist/filedeck.umd.min.js` and `dist/filedeck.min.css`
into your static folder and link them the same way. In a Django project:

```django
{% load static %}
<link rel="stylesheet" href="{% static 'css/filedeck.min.css' %}">
<script src="{% static 'js/filedeck.umd.min.js' %}"></script>
<script>window.filedeck = new Filedeck();</script>
```

**npm, with a bundler:**

```bash
npm install filedeck
```

```js
import Filedeck from 'filedeck';
import 'filedeck/filedeck.css';

const viewer = new Filedeck();
```

Filedeck builds its own markup and appends it to `<body>` on construction.
There is nothing to paste into your template — no container element, no icon
sprite, no font to load.

---

## Markup

Any element carrying `data-filedeck` becomes a trigger. The attribute's **value
is the group name** — triggers sharing a value page through each other with the
prev/next arrows and the filmstrip.

```html
<a href="/media/full/hero.png"
   data-filedeck="files"
   data-width="1440"
   data-height="900"
   data-size="2.4 MB"
   data-meta="Design homepage hero · Aug 24, 2026">
  <img src="/media/thumbs/hero.png" alt="Homepage hero v4">
</a>
```

Use an `<a href>` rather than a `<div>`. With JS broken or disabled the link
still opens the file, and Ctrl/Cmd-click still opens it in a new tab — the
viewer deliberately ignores modified clicks.

### Attributes

| Attribute | Required | Purpose |
|---|---|---|
| `href` | yes* | Full-size asset URL. `data-src` works as an alternative. |
| `data-filedeck` | yes | Group name. Triggers with the same value navigate together. |
| `data-name` | no | Filename shown in the top bar. Falls back to the trigger's `title`, then the nested `<img>` alt, then the URL's basename. |
| `title` | no | Standard HTML attribute, reused as the filename when `data-name` is absent. Also gives you a native tooltip on the tile. |
| `data-caption` | no | Caption under the image. Falls back to the nested `<img>` alt. |
| `data-meta` | no | Subtitle line in the top bar — task, date, whatever fits. |
| `data-size` | no | Shown in the caption and on the document card. Format it yourself ("2.4 MB"). |
| `data-width` / `data-height` | no | Intrinsic pixel dimensions. Prevents a reflow on first paint — see below. |
| `data-thumb` | no | Filmstrip thumbnail URL. Use it when the trigger has no nested `<img>` and the full-size file is too heavy to reuse. |
| `data-download` | no | URL for the Download button when it differs from `href` — a converted preview on the stage, the original file to download. |
| `data-kind` | no | Overrides the kind detected from the extension. One of `image`, `pdf`, `video`, `audio`, `file`. |

\* Required unless `data-src` is present.

### On `data-width` / `data-height`

The stage fits the image using CSS `aspect-ratio`, which needs the ratio
*before* the image loads. Supply these and the layout is correct from the first
frame. Omit them and the viewer guesses 3:2, then corrects from
`naturalWidth`/`naturalHeight` once the image arrives — visible as a small
reflow. If your model stores dimensions, pass them; if not, leave them off
rather than guessing.

### Nested thumbnails

If the trigger contains an `<img>`, its `src` is reused for the filmstrip
thumbnail and its `alt` supplies the default caption. So a typical file tile
needs almost no extra attributes.

Thumbnails resolve in this order:

```
data-thumb  →  nested <img> src  →  the href, for images only  →  file-type icon
```

The href is skipped for non-images on purpose — pointing an `<img src>` at a
PDF or a spreadsheet only produces a broken image. Those get a labelled
file-type icon instead: a page shape with a coloured type badge (PDF red,
spreadsheet green, document indigo, CAD olive, archive grey), falling back to
the file's own extension for anything unrecognised.

These are deliberately not vendor logos. The Adobe and Microsoft marks are
trademarked, and shipping them inside a library is a licensing problem rather
than a design one.

The name resolves in this order, first non-empty value wins:

```
data-name  →  title  →  nested <img> alt  →  basename of the URL
```

Which means a tile that already carries a `title` for its tooltip needs nothing
added at all:

```html
<a href="/media/full/hero.png" title="homepage-hero-v4.png" data-filedeck="files">
  <img src="/media/thumbs/hero.png" alt="Homepage hero v4">
</a>
```

Here the top bar shows `homepage-hero-v4.png` and the caption shows
`Homepage hero v4` — the filename and the description staying distinct, which is
usually what you want.

---

## Attachment types

The kind is worked out from the file extension, so tiles don't need tagging.
`data-kind` overrides it — necessary when the URL carries no extension, as with
a permission-checked download view like `/attachments/12/download/`.

| Kind | Extensions | Rendered as |
|---|---|---|
| `image` | jpg, jpeg, png, gif, webp, avif, svg, bmp, ico | `<img>`, zoomable and pannable |
| `pdf` | pdf | `<embed>` using the browser's own PDF viewer |
| `video` | mp4, webm, ogv, mov, m4v | `<video controls>` |
| `audio` | mp3, wav, ogg, oga, m4a, aac, flac | `<audio controls>` on a card |
| `sheet` | xlsx, xlsm | A scrollable grid with sheet tabs, read in the browser |
| `doc` | docx, docm | A formatted reading column, read in the browser |
| `file` | anything else | Card with file type, size, and a download button |

Zoom and pan apply to images only; the zoom cluster hides itself for every
other kind rather than sitting there inert. Preloading is likewise
image-only — pulling the next 40MB video in the background would be hostile.

**PDFs on narrow screens fall back to the file card.** Embedded PDFs are
unreliable below about 900px on Safari and Android, often rendering only the
first page or nothing. The alternative was shipping PDF.js and its megabyte,
which didn't seem worth it for one breakpoint.

**Office documents and CAD files get the card.** No browser renders `.docx`,
`.xlsx`, `.dwg`, or `.step`, and the Google and Office Online iframe viewers
only work on publicly reachable URLs — wrong for access-controlled files. If
you later want real previews, generate them server-side at upload (LibreOffice
headless to PDF, then a first-page raster), store the result, and point the
tile at the preview while `Download` serves the original. The viewer needs no
changes for that: a generated preview is just an image.

**Playback stops when you navigate away or close.** Hiding the viewer doesn't
stop an `<audio>` element, so both paths pause explicitly. A focused video also
keeps the arrow keys for seeking rather than surrendering them to gallery
navigation.

---

## Options

All optional.

```js
new Filedeck({
  selector: '[data-filedeck]',   // what counts as a trigger
  groupAttr: 'data-filedeck',    // which attribute holds the group name
  filmstrip: true,               // false hides the bottom strip entirely

  actions: ['copy', 'download'], // top-bar buttons, in this order
  zoomMin: 25,
  zoomMax: 400,
  zoomStep: 25,

  gestures: true,                // false disables the pointer layer
  labels: {},                    // see below
  renderers: {}                  // custom previews, see below
});
```

**`selector`** — narrow the trigger set if you need to, e.g.
`'.file-tile[data-filedeck]'`.

**`groupAttr`** — the attribute read for grouping. Worth changing only if
`data-filedeck` collides with something else on your pages.

**`filmstrip`** — the strip hides itself when a group has fewer than two items,
so `false` is only for suppressing it entirely.

**`actions`** — which top-bar buttons to render. Pass `[]` for close only.
Close is always present. Actions the viewer doesn't implement (delete, say)
belong on your page via the events below.

**`gestures`** — `false` removes swipe, pinch, wheel and double-click zoom
entirely, including their listeners. An object tunes the thresholds instead:

```js
new Filedeck({
  gestures: {
    axisLock: 12,          // px before the swipe axis commits
    swipeRatio: 0.22,      // fraction of stage width that counts as a swipe
    flickVelocity: 0.45,   // px/ms — a fast flick navigates at any distance
    dismissDistance: 130,  // px of vertical drag before closing
    edgeResistance: 0.32   // drag damping at the first and last item
  }
});
```

Any key you omit keeps its default.

---

## Spreadsheets

`.xlsx` and `.xlsm` render natively, with no dependency. An Office file is a
zip archive of XML, and browsers can already open both — `DecompressionStream`
for the archive, `DOMParser` for the XML — so Filedeck reads the workbook
directly.

What you get: a scrollable grid with column letters and row numbers, sticky
headers, tabs for multi-sheet workbooks, shared strings, dates converted from
their serial numbers, and booleans.

What you don't: formatting, colours, charts, images, merged cells, or formula
text. Cells show their last calculated value, which is what Excel stores
alongside the formula. Row and column ceilings are 2,000 and 64; past those the
grid is cut off with a note saying so.

It's a preview for checking a figure before deciding to open the file, not a
spreadsheet viewer. Anything larger than 20 MB shows the file card instead, and
so does a corrupt archive, a failed request, or a browser without
`DecompressionStream` — each with its own message rather than a blank stage.

Old binary `.xls` files are not zips and are not supported; they get the card.

---

## Word documents

`.docx` and `.docm` render natively, through the same zip reader as
spreadsheets.

What you get: headings, paragraphs, bold, italic, underline, strikethrough,
super- and subscript, bulleted and numbered lists including nesting, tables,
embedded images, block quotes, alignment, and external links.

What you don't: page geometry, columns, headers and footers, footnotes,
tracked changes, comments, or exact spacing and fonts. It reads as a clean
document, not as a facsimile of the Word page.

Documents are capped at 4,000 blocks; past that the preview is cut off with a
note. Embedded images become blob URLs and are released when you navigate away
or close, so nothing accumulates.

Old binary `.doc` files are not zips and are not supported; they get the card.

### Where list numbering comes from

Word marks list paragraphs with `w:numPr`, but documents written by other
producers — python-docx among them — put it on the paragraph *style* instead.
Filedeck checks the paragraph, then `styles.xml`, then the style name, so lists
render as lists either way.

---

## Custom renderers

For anything Filedeck doesn't read — PowerPoint, CAD, or Word at full fidelity
— register your own renderer. Two options exist for Word specifically.

### Convert on the server

Generate a PDF at upload time — LibreOffice headless is the usual tool — store
it, and point `href` at the preview while `data-download` keeps the original:

```html
<a href="/attachments/12/preview.pdf"
   data-download="/attachments/12/download/"
   data-filedeck="files"
   title="supplier-agreement.docx">
  supplier-agreement.docx
</a>
```

The viewer needs nothing new for this: a converted preview is just a PDF. The
kind is taken from the URL, so the stage shows the PDF while the header and the
type icon still say `.docx`.

### Render in the browser

Register a renderer keyed by extension. Doing so promotes that extension to a
kind of its own, so it stops falling through to the file card:

```js
import { renderAsync } from 'docx-preview';

new Filedeck({
  renderers: {
    docx: {
      fill: true,                       // take the whole stage and scroll
      render: async (item, canvas, api) => {
        const res = await fetch(item.url);
        if (!res.ok) return api.fallback('Preview unavailable');
        await renderAsync(await res.blob(), canvas);
      }
    },

    // A bare function works too, when there's nothing to configure.
    csv: (item, canvas) => fetch(item.url)
      .then(r => r.text())
      .then(text => { canvas.innerHTML = toTable(text); })
  }
});
```

**The renderer contract**

- Called as `render(item, canvas, api)`. Fill `canvas` however you like.
- Return a promise for async work. Filedeck shows its loading state until it
  settles, and a rejection or a thrown error falls back to the file card —
  so a failed conversion is never a blank stage.
- `api.fallback(message)` switches to the card deliberately, with your wording.
- `api.labels` is the resolved label set, for renderers that show text.
- Options on the renderer object: `fill` (take the whole stage, scrollable),
  `zoom` and `preload` (both default to false).

Filedeck stays dependency-free either way — the renderer and whatever library
it uses live in your application, not in this package.

---

## Labels

Every user-visible string, including ARIA labels, can be replaced. Pass any
subset; missing keys fall back to English.

```js
new Filedeck({
  labels: {
    viewer: 'Visor de adjuntos',
    close: 'Cerrar',
    previous: 'Anterior',
    next: 'Siguiente',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fit: 'Ajustar a la pantalla',
    download: 'Descargar',
    copyLink: 'Copiar enlace',
    copied: 'Copiado',
    copyFailed: 'No se pudo copiar',
    openNewTab: 'Abrir en una pestaña nueva',
    counter: '{index} de {total}',
    position: '{name}, {index} de {total}',
    imageFailed: 'No se pudo cargar la imagen',
    videoFailed: 'Este vídeo no se puede reproducir aquí',
    audioFailed: 'Este audio no se puede reproducir aquí',
    noPreview: 'Vista previa no disponible para este tipo de archivo'
  }
});
```

`counter` and `position` take `{index}`, `{total}` and `{name}` placeholders.
`position` is what screen readers announce on navigation, so keep the name in
it.

---

## Methods

```js
const lb = new Filedeck();

lb.openFrom('#tile-7');   // open from a trigger element or selector
lb.openFrom(element);     // same, with a node
lb.close();

lb.next();
lb.prev();
lb.goTo(3);               // index within the current group

lb.setZoom(200);          // percent, clamped to ZOOM_MIN..ZOOM_MAX
lb.zoomBy(25);
lb.resetView();           // back to 100% and centred

lb.current();             // the item object being viewed, or null
lb.destroy();             // remove listeners and the root node
```

`openFrom()` is the programmatic equivalent of a click: it collects the group,
finds the index, and opens. `open(index)` exists but assumes a group has already
been collected, so prefer `openFrom()` unless you know one has.

Call `destroy()` before removing the page region a viewer belongs to. It unbinds
every listener, unlocks body scroll, and removes the root element.

---

## Events

Dispatched on the viewer's root element and bubbling to `document`.

| Event | Fires when |
|---|---|
| `filedeck:open` | The viewer opens |
| `filedeck:close` | The viewer closes |
| `filedeck:change` | Navigation to a different attachment |
| `filedeck:zoom` | Zoom level changes |
| `filedeck:action:copy` | The copy-link button is used |

Each carries `detail.item` and `detail.index`.

```js
document.addEventListener('filedeck:change', (e) => {
  console.log('now viewing', e.detail.item.name);
});
```

This is the extension point for anything the viewer deliberately doesn't do.
A delete button, for example, belongs to your page — add it to the top bar and
handle it here, where the permission checks live.

---

## Touch and pointer gestures

| Gesture | Action |
|---|---|
| Swipe left / right | Previous / next attachment |
| Swipe down | Dismiss — the viewer fades as you drag |
| Pinch | Zoom, images only |
| Drag while zoomed in | Pan |
| Double-click / double-tap | Toggle 100% ↔ 200% |
| Wheel or trackpad pinch | Zoom, images only |

The axis locks after about 12px of travel, so a slightly diagonal swipe does
one thing rather than both. A swipe navigates if it crosses roughly a fifth of
the stage width *or* if it was moving fast when released — a short flick works
without dragging the whole way. At the first and last attachment the drag
resists instead of moving freely.

Native controls keep their own gestures: scrubbing a video, scrolling a PDF,
and using the audio player are all excluded from the swipe layer.

Thresholds are tunable through the `gestures` option above, and the whole
layer can be switched off with `gestures: false`.

---

## Keyboard

| Key | Action |
|---|---|
| `←` / `→` | Previous / next |
| `+` / `-` | Zoom in / out |
| `0` | Fit to screen |
| `Esc` | Close |
| `Tab` | Cycles within the viewer only — focus can't reach the page behind |

On close, focus returns to the trigger that opened the viewer.

---

## Theming

The stylesheet reads a handful of custom properties, each with a literal
fallback, so it works with or without any design system loaded.

```css
:root {
  --fd-accent:       #4D5BE3;  /* Download button, primary accent */
  --fd-accent-hover: #707CE9;  /* Focus ring, active filmstrip border */
  --fd-accent-soft:  #C5CBF6;  /* File-type icon tile */
  --fd-accent-bg:    #E5E8FB;  /* Audio card icon tile */
  --fd-font:         ui-sans-serif, system-ui, sans-serif;
  --fd-font-mono:    ui-monospace, SFMono-Regular, monospace;
  --fd-radius-pill:  999px;
  --fd-card-bg:      #FFFFFF;  /* Document / audio card surface */
  --fd-card-text:    #1C1E33;  /* Card title */
  --fd-card-muted:   #71758C;  /* Card secondary text */
  --fd-z:            2000;     /* Stacking order of the whole viewer */
}
```

`--fd-z` defaults to 2000, which clears Bootstrap's scale (toasts top out at
1090) with room to spare. It is deliberately not the maximum integer — a
cookie banner or a session-timeout warning may legitimately need to sit above
the viewer. Raise it if something in your stack still wins.

Mapping them onto your own tokens is a one-liner each:

```css
:root { --fd-accent: var(--brand-primary); }
```

The dark stage chrome is intentionally fixed rather than theme-aware — an
attachment viewer wants a neutral dark surround regardless of the surrounding
page.

---

## Behaviour worth knowing

**Groups are re-scanned on every open.** Tiles added later by HTMX, infinite
scroll, or a filter change are picked up with no re-initialisation. The flip
side: if your list paginates, the viewer pages through the *current page* only.

**Adjacent images are preloaded.** Moving forward or back is instant after the
first view.

**The image element is created once per attachment.** Zoom, pan, and window
resize only write to `transform`, so nothing refetches or re-decodes.

**Pan needs zoom above 100%.** Below that the image already fits, so dragging
does nothing.

**Text from attributes is escaped.** Filenames and captions come from your
database; they're escaped before reaching the DOM rather than interpolated raw.

**The top bar sheds chrome as the screen narrows** so the filename keeps its
space: the Download label collapses to its icon below 680px (the accessible
name stays intact), the subtitle goes at 480px, and the counter and file-type
icon go at 380px, since the filmstrip already shows position and the extension
is in the name.

**Copy link works outside a secure context.** The async Clipboard API only
exists on HTTPS and localhost, so over plain HTTP — a LAN address during
testing, or an intranet host in production — the viewer falls back to
`execCommand`. Either way the button confirms with a short bubble saying
whether the copy succeeded, and the `filedeck:action:copy` event carries a
`copied` flag.

**A failed image shows a fallback card**, not a broken-image icon.

**Slow images show a spinner, cached ones don't.** The indicator fades in on a
220ms CSS delay rather than appearing immediately, so an image that decodes
straight away never flashes one.

**PDFs always carry an "Open in new tab" link.** A blocked or failed `<embed>`
still fires `load`, so there is no event to detect it — the escape hatch is
permanent rather than conditional. The usual cause of a blank embed is
`X-Frame-Options: DENY`, which Django sets by default; `X_FRAME_OPTIONS =
"SAMEORIGIN"` or the `@xframe_options_sameorigin` decorator fixes it, and the
file must be served with `Content-Disposition: inline` rather than
`attachment`.

---

## Testing

`demo.html` runs the viewer standalone with generated SVG assets — no network,
no server. It includes a very tall image, a very wide one, a document-kind
attachment, and a deliberately broken URL. Open it before wiring the viewer into
a real page.

---

## Browser support

Modern evergreen browsers. The load-bearing features are `aspect-ratio`,
`Element.closest()`, `Map`, `Array.from`, and pointer events. The one to verify on your own targets
is the CSS fitting — it's what replaced the prototype's JS measurement, and it's
the first thing to check if an image renders at the wrong size.
