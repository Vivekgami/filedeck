/* ==========================================================================
   Filedeck — attachment viewer
   Plain JS, no dependencies, no build step, no server payload.

   Reads everything from the DOM. Include the CSS, include this file, done:

     <script src="/static/js/filedeck.js"></script>
     <script>window.filedeck = new Filedeck();</script>

   Markup it looks for:

     <a href="/media/full/hero.png"
        data-filedeck="files"
        data-width="1440" data-height="900"
        data-meta="Design homepage hero · Aug 24, 2026"
        data-size="2.4 MB">
       <img src="/media/thumbs/hero.png" alt="Homepage hero v4">
     </a>

   Only href and data-filedeck are required. Everything else is optional and
   degrades: no data-width means the aspect settles after load, no <img>
   inside means the filmstrip shows an icon, no data-caption means the
   thumbnail's alt is used.
   ========================================================================== */

window.Filedeck = (function () {
  'use strict';

  var ZOOM_MIN = 25;
  var ZOOM_MAX = 400;
  var ZOOM_STEP = 25;
  var FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  /* Every user-visible string, including ARIA labels. Override any subset
     through the labels option; missing keys fall back to these. */
  var LABELS = {
    viewer: 'Attachment viewer',
    close: 'Close',
    previous: 'Previous',
    next: 'Next',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit to screen',
    download: 'Download',
    copyLink: 'Copy link',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    openNewTab: 'Open in new tab',
    counter: '{index} / {total}',
    position: '{name}, {index} of {total}',
    imageFailed: 'Image didn\u2019t load',
    videoFailed: 'This video can\u2019t be played here',
    audioFailed: 'This audio can\u2019t be played here',
    noPreview: 'Preview isn\u2019t available for this file type'
  };

  var GESTURE_DEFAULTS = {
    axisLock: 12,          // px before the axis commits
    swipeRatio: 0.22,      // fraction of stage width that counts as a swipe
    flickVelocity: 0.45,   // px/ms — a fast flick navigates at any distance
    dismissDistance: 130,  // px of vertical drag before closing
    edgeResistance: 0.32   // drag damping at the first and last item
  };

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (match, key) {
      return values[key] == null ? match : values[key];
    });
  }

  /* The async Clipboard API only exists in a secure context — HTTPS or
     localhost. Over plain HTTP (a LAN address, an intranet host) it is simply
     undefined, so a deprecated-but-working execCommand path stays as backup. */
  function legacyCopy(text) {
    var field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(field);

    var copied = false;
    try {
      field.focus();
      field.select();
      field.setSelectionRange(0, text.length); // iOS ignores select() alone
      copied = document.execCommand('copy');
    } catch (e) {
      copied = false;
    }
    field.parentNode.removeChild(field);
    return copied;
  }

  function copyText(text) {
    if (window.isSecureContext && window.navigator.clipboard) {
      return window.navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function assign(target, source) {
    if (source) Object.keys(source).forEach(function (k) { target[k] = source[k]; });
    return target;
  }

  var EMBEDDED = 'video, audio, embed, iframe, button, a, input, textarea';

  /* Icons inlined rather than referenced from a page sprite: no markup for
     the host page to provide, and no #id that can collide with anything. */
  var ICONS = {
    img: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.8" cy="9" r="1.6"/><path d="M21 16l-5-5-6.5 6.5L7 15l-4 4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    left: '<path d="M14.5 5L8 12l6.5 7"/>',
    right: '<path d="M9.5 5L16 12l-6.5 7"/>',
    dl: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4.5 18.5h15"/>',
    link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.4 6.4"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    minus: '<path d="M6 12h12"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'
  };

  /* -- helpers ----------------------------------------------------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name, size, stroke) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="' + (stroke || 1.7) + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] + '</svg>';
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function basename(url) {
    try {
      return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || '';
    } catch (e) {
      return String(url || '').split('/').pop();
    }
  }

  /* -- attachment kinds ---------------------------------------------------
     Kind is derived from the file extension so templates don't have to tag
     every tile. data-kind overrides it, which matters when the URL has no
     extension — a download view like /attachments/12/download/ for instance.
     -------------------------------------------------------------------- */

  var EXT_KIND = {
    image: 'jpg jpeg png gif webp avif svg bmp ico',
    pdf:   'pdf',
    video: 'mp4 webm ogv mov m4v',
    audio: 'mp3 wav ogg oga m4a aac flac'
  };

  var KIND_BY_EXT = (function () {
    var map = {};
    Object.keys(EXT_KIND).forEach(function (kind) {
      EXT_KIND[kind].split(' ').forEach(function (ext) { map[ext] = kind; });
    });
    return map;
  })();

  /* Zoom and pan only mean anything for a still image, and preloading a 40MB
     video in the background would be hostile. */
  var CAPS = {
    image: { zoom: true,  preload: true  },
    pdf:   { zoom: false, preload: false },
    video: { zoom: false, preload: false },
    audio: { zoom: false, preload: false },
    file:  { zoom: false, preload: false }
  };

  var KIND_ALIASES = { doc: 'file', document: 'file' };

  function extOf(nameOrUrl) {
    var name = basename(nameOrUrl).split('?')[0];
    var dot = name.lastIndexOf('.');
    return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function kindFor(url, override, name) {
    if (override) return KIND_ALIASES[override] || (CAPS[override] ? override : 'file');
    return KIND_BY_EXT[extOf(name)] || KIND_BY_EXT[extOf(url)] || 'file';
  }

  function capsFor(kind) { return CAPS[kind] || CAPS.file; }

  var TOP_ICON = { image: 'img', pdf: 'doc', video: 'img', audio: 'audio', file: 'doc' };

  /* -- file-type icons ----------------------------------------------------
     A page shape with a coloured type label rather than vendor logos. The
     Adobe and Microsoft marks are trademarked; shipping them in a library is
     a problem worth avoiding, and a labelled page reads just as clearly at
     thumbnail size.
     -------------------------------------------------------------------- */

  var TYPE_GROUPS = [
    { label: 'PDF', color: '#DA4A54', ext: 'pdf' },
    { label: 'DOC', color: '#4D5BE3', ext: 'doc docx odt rtf pages' },
    { label: 'XLS', color: '#2E9E6B', ext: 'xls xlsx xlsm ods numbers' },
    { label: 'CSV', color: '#2E9E6B', ext: 'csv tsv' },
    { label: 'PPT', color: '#D9930D', ext: 'ppt pptx odp key' },
    { label: 'ZIP', color: '#71758C', ext: 'zip rar 7z tar gz bz2' },
    { label: 'CAD', color: '#8A9430', ext: 'dwg dxf step stp iges igs stl sldprt ipt' },
    { label: 'TXT', color: '#565A73', ext: 'txt md log ini cfg' },
    { label: 'IMG', color: '#4D5BE3', ext: 'jpg jpeg png gif webp avif svg bmp ico' },
    { label: 'VID', color: '#565A73', ext: 'mp4 webm ogv mov m4v' },
    { label: 'AUD', color: '#565A73', ext: 'mp3 wav ogg oga m4a aac flac' }
  ];

  var FILE_TYPES = (function () {
    var map = {};
    TYPE_GROUPS.forEach(function (group) {
      group.ext.split(' ').forEach(function (ext) {
        map[ext] = { label: group.label, color: group.color };
      });
    });
    return map;
  })();

  function fileIcon(ext, width, height) {
    var type = FILE_TYPES[ext] || {
      // Unrecognised types show their own extension, truncated to fit.
      label: (ext || 'FILE').toUpperCase().slice(0, 4),
      color: '#71758C'
    };
    var fontSize = type.label.length > 3 ? 8.5 : 10.5;

    return '<svg class="fd-ficon" viewBox="0 0 40 48" width="' + width + '" ' +
      'height="' + height + '" fill="none" aria-hidden="true">' +
      '<path d="M6 2h19l9 9v35H6z" fill="#FFFFFF" stroke="#C9CCDA" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M25 2v9h9" stroke="#C9CCDA" stroke-width="2" stroke-linejoin="round"/>' +
      '<rect x="0" y="24" width="31" height="15" rx="3.5" fill="' + type.color + '"/>' +
      '<text x="15.5" y="34.8" text-anchor="middle" fill="#FFFFFF" ' +
      'font-family="ui-monospace, SFMono-Regular, monospace" font-size="' + fontSize + '" ' +
      'font-weight="700" letter-spacing=".3">' + esc(type.label) + '</text>' +
      '</svg>';
  }

  function pauseMedia(scope) {
    var media = scope.querySelectorAll('video, audio');
    for (var i = 0; i < media.length; i++) {
      try { media[i].pause(); } catch (e) { /* not ready yet */ }
    }
  }

  /* Embedded PDFs are unreliable on small-screen Safari and Android — often
     only the first page renders, sometimes nothing at all. Rather than ship a
     megabyte of PDF.js for that case, narrow screens get the file card. */
  function canEmbedPdf() {
    // Absent in some embedded webviews; assume a desktop-sized stage there.
    if (!window.matchMedia) return true;
    return window.matchMedia('(min-width: 901px)').matches;
  }

  /* -- constructor ------------------------------------------------------- */

  function Filedeck(options) {
    options = options || {};

    this.selector = options.selector || '[data-filedeck]';
    this.groupAttr = options.groupAttr || 'data-filedeck';
    this.showFilmstrip = options.filmstrip !== false;

    this.labels = assign(assign({}, LABELS), options.labels);

    this.zoomMin = options.zoomMin || ZOOM_MIN;
    this.zoomMax = options.zoomMax || ZOOM_MAX;
    this.zoomStep = options.zoomStep || ZOOM_STEP;

    // Which top-bar actions to render, in the order given. An empty array
    // leaves only the close button.
    this.actions = options.actions || ['copy', 'download'];

    // gestures: false disables the pointer layer entirely; an object tunes it.
    this.gesturesEnabled = options.gestures !== false;
    this.tuning = assign(assign({}, GESTURE_DEFAULTS),
      typeof options.gestures === 'object' ? options.gestures : null);

    this.items = [];
    this.state = { index: 0, zoom: 100, panX: 0, panY: 0, isOpen: false };
    this.lastFocused = null;
    this.pointers = new Map();
    this.gesture = null;
    this._suppressClick = false;

    this._build();
    this._bind();
  }

  /* -- DOM construction --------------------------------------------------
     The viewer owns its own markup. Nothing to paste into a template, and
     the host page can't half-provide it.
     -------------------------------------------------------------------- */

  Filedeck.prototype._build = function () {
    var root = document.createElement('div');
    root.className = 'fd-root';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', this.labels.viewer);

    var L = this.labels;

    var actionMarkup = this.actions.map(function (name) {
      if (name === 'copy') {
        return '<button type="button" class="fd-btn" data-fd="copy" title="' + esc(L.copyLink) +
          '" aria-label="' + esc(L.copyLink) + '">' + icon('link', 19) + '</button>';
      }
      if (name === 'download') {
        return '<a class="fd-btn-text" data-fd="download" title="' + esc(L.download) +
          '" aria-label="' + esc(L.download) + '" download>' +
          icon('dl', 17, 1.8) +
          '<span class="fd-btn-label">' + esc(L.download) + '</span></a>';
      }
      return '';
    }).join('');

    root.innerHTML =
      '<div class="fd-top">' +
        '<div class="fd-file">' +
          '<div class="fic" data-fd="icon">' + icon('img', 19) + '</div>' +
          '<div class="ft"><b data-fd="name"></b><span data-fd="meta"></span></div>' +
        '</div>' +
        '<span class="fd-count" data-fd="count"></span>' +
        '<div class="fd-acts">' +
          actionMarkup +
          (actionMarkup ? '<span class="fd-sep"></span>' : '') +
          '<button type="button" class="fd-btn" data-fd="close" title="' + esc(L.close) +
            ' (Esc)" aria-label="' + esc(L.close) + '">' + icon('close', 19, 1.8) + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="fd-stage">' +
        '<button type="button" class="fd-nav prev" data-fd="prev" aria-label="' + esc(L.previous) + '">' + icon('left', 20, 1.8) + '</button>' +
        '<div class="fd-figure"></div>' +
        '<button type="button" class="fd-nav next" data-fd="next" aria-label="' + esc(L.next) + '">' + icon('right', 20, 1.8) + '</button>' +
        '<div class="fd-zoom">' +
          '<button type="button" data-fd="zoom-out" aria-label="' + esc(L.zoomOut) + '">' + icon('minus', 17, 1.8) + '</button>' +
          '<span class="val" data-fd="zoom-val">100%</span>' +
          '<button type="button" data-fd="zoom-in" aria-label="' + esc(L.zoomIn) + '">' + icon('plus', 17, 1.8) + '</button>' +
          '<button type="button" data-fd="zoom-fit" aria-label="' + esc(L.fit) + '">' + icon('fit', 16, 1.8) + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="fd-strip"></div>' +
      '<span class="fd-live" aria-live="polite"></span>';

    document.body.appendChild(root);
    this.root = root;

    var q = root.querySelector.bind(root);
    this.els = {
      icon: q('[data-fd="icon"]'),
      name: q('[data-fd="name"]'),
      meta: q('[data-fd="meta"]'),
      count: q('[data-fd="count"]'),
      download: q('[data-fd="download"]'),
      close: q('[data-fd="close"]'),
      stage: q('.fd-stage'),
      figure: q('.fd-figure'),
      prev: q('[data-fd="prev"]'),
      next: q('[data-fd="next"]'),
      zoomIn: q('[data-fd="zoom-in"]'),
      zoomOut: q('[data-fd="zoom-out"]'),
      zoomVal: q('[data-fd="zoom-val"]'),
      zoom: q('.fd-zoom'),
      strip: q('.fd-strip'),
      live: q('.fd-live'),
      slide: null,
      canvas: null
    };
  };

  /* -- reading items from the DOM ---------------------------------------- */

  Filedeck.prototype._readItem = function (el) {
    var d = el.dataset;
    var thumb = el.querySelector('img');
    var url = el.getAttribute('href') || d.src || '';

    // title sits above alt here: title describes the link's target (the
    // file), alt describes the thumbnail's content. For a filename the
    // former is the better source.
    var name = d.name || el.getAttribute('title') || (thumb && thumb.alt) || basename(url);
    var kind = kindFor(url, d.kind, name);

    return {
      el: el,
      url: url,
      // data-thumb wins: it's the only way to get a small thumbnail when the
      // trigger has no nested <img>. Falling back to the href works for images
      // only — pointing an <img src> at a PDF or xlsx just breaks.
      thumb: d.thumb || (thumb ? (thumb.currentSrc || thumb.src) : (kind === 'image' ? url : '')),
      name: name,
      kind: kind,
      ext: extOf(name) || extOf(url),
      caps: capsFor(kind),
      caption: d.caption || (thumb && thumb.alt) || '',
      meta: d.meta || '',
      size: d.size || '',
      width: parseInt(d.width, 10) || 0,
      height: parseInt(d.height, 10) || 0
    };
  };

  /* Collected fresh on every open, so tiles added by HTMX, infinite scroll,
     or a filter change are picked up with no re-init. Matching is done in JS
     rather than by building a selector from the attribute value — a group
     name containing a quote would otherwise break the query. */
  Filedeck.prototype._collectGroup = function (trigger) {
    var group = trigger.getAttribute(this.groupAttr);
    var attr = this.groupAttr;
    var all = document.querySelectorAll(this.selector);
    var matched = [];

    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute(attr) === group) matched.push(all[i]);
    }

    this.items = matched.map(this._readItem, this);
    return matched.indexOf(trigger);
  };

  /* -- listeners --------------------------------------------------------- */

  Filedeck.prototype._bind = function () {
    var self = this;

    this._h = {
      docClick: function (e) { self._onDocumentClick(e); },
      rootClick: function (e) { self._onRootClick(e); },
      keydown: function (e) { self._onKeydown(e); },
      pointerDown: function (e) { self._onPointerDown(e); },
      pointerMove: function (e) { self._onPointerMove(e); },
      pointerUp: function (e) { self._onPointerUp(e); },
      wheel: function (e) { self._onWheel(e); },
      dblclick: function (e) { self._onDoubleClick(e); }
    };

    document.addEventListener('click', this._h.docClick);
    this.root.addEventListener('click', this._h.rootClick);
    document.addEventListener('keydown', this._h.keydown);
    if (this.gesturesEnabled) {
      this.els.stage.addEventListener('pointerdown', this._h.pointerDown);
      window.addEventListener('pointermove', this._h.pointerMove, { passive: false });
      window.addEventListener('pointerup', this._h.pointerUp);
      window.addEventListener('pointercancel', this._h.pointerUp);
      this.els.stage.addEventListener('wheel', this._h.wheel, { passive: false });
      this.els.stage.addEventListener('dblclick', this._h.dblclick);
    }
  };

  Filedeck.prototype._onDocumentClick = function (e) {
    var trigger = e.target.closest(this.selector);
    if (!trigger || this.root.contains(trigger)) return;
    // Let modified clicks do what the anchor normally would — open in a tab.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();

    var index = this._collectGroup(trigger);
    if (index > -1) this.open(index, trigger);
  };

  Filedeck.prototype._onRootClick = function (e) {
    // A drag ends with a click. Without this, a swipe that finishes over the
    // stage padding would also trigger scrim-to-close.
    if (this._suppressClick) { this._suppressClick = false; return; }

    var t = e.target;

    var thumb = t.closest('.fd-thumb');
    if (thumb) { this.goTo(parseInt(thumb.dataset.index, 10)); return; }

    var hit = t.closest('[data-fd]');
    if (hit) {
      switch (hit.getAttribute('data-fd')) {
        case 'close':    this.close(); return;
        case 'prev':     this.prev(); return;
        case 'next':     this.next(); return;
        case 'zoom-in':  this.zoomBy(this.zoomStep); return;
        case 'zoom-out': this.zoomBy(-this.zoomStep); return;
        case 'zoom-fit': this.resetView(); return;
        case 'copy':     this._copyLink(); return;
        case 'download': return; // plain anchor, let it through
      }
    }

    // Scrim: a click on the stage padding itself, not the figure or controls
    if (t === this.els.stage || t === this.root) this.close();
  };

  Filedeck.prototype._onKeydown = function (e) {
    if (!this.state.isOpen) return;

    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key === 'Tab') { this._trapTab(e); return; }

    // A focused <video> uses arrows to seek and space to play. Navigating the
    // gallery out from under someone scrubbing a clip is not what they meant.
    if (e.target.closest('video, audio')) return;

    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); this.prev(); break;
      case 'ArrowRight': e.preventDefault(); this.next(); break;
      case '+': case '=': e.preventDefault(); this.zoomBy(this.zoomStep); break;
      case '-': case '_': e.preventDefault(); this.zoomBy(-this.zoomStep); break;
      case '0':          e.preventDefault(); this.resetView(); break;
    }
  };

  Filedeck.prototype._trapTab = function (e) {
    var nodes = Array.prototype.filter.call(
      this.root.querySelectorAll(FOCUSABLE),
      function (el) { return el.offsetParent !== null && !el.disabled; }
    );
    if (!nodes.length) return;

    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = document.activeElement;

    if (e.shiftKey && (active === first || !this.root.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus();
    }
  };

  /* -- open / close / navigate ------------------------------------------- */

  Filedeck.prototype.current = function () {
    return this.items[this.state.index] || null;
  };

  Filedeck.prototype.open = function (index, trigger) {
    if (!this.items.length) return;
    this.lastFocused = trigger || document.activeElement;
    this.state.index = clamp(index, 0, this.items.length - 1);
    this.state.isOpen = true;
    this.root.hidden = false;
    document.body.classList.add('fd-lock');
    this.resetView(true);
    this.renderStrip();
    this.render();
    this.els.close.focus();
    this._emit('open');
  };

  /* Open programmatically from a trigger element — the same path a click
     takes, group collection included. Accepts an element or a selector. */
  Filedeck.prototype.openFrom = function (target) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    var index = this._collectGroup(el);
    if (index > -1) this.open(index, el);
  };

  Filedeck.prototype.close = function () {
    if (!this.state.isOpen) return;
    this.state.isOpen = false;
    pauseMedia(this.root); // hiding the root does not stop audio playing
    this.root.hidden = true;
    document.body.classList.remove('fd-lock');
    // Focus goes back to the tile that opened it, so keyboard users don't
    // land at the top of the document.
    if (this.lastFocused && document.contains(this.lastFocused)) this.lastFocused.focus();
    this.lastFocused = null;
    this._emit('close');
  };

  Filedeck.prototype.goTo = function (index) {
    if (index === this.state.index || index < 0 || index >= this.items.length) return;
    this.state.index = index;
    this.resetView(true);
    this.render();
    this._emit('change');
  };

  Filedeck.prototype.next = function () { this.goTo(this.state.index + 1); };
  Filedeck.prototype.prev = function () { this.goTo(this.state.index - 1); };

  /* -- zoom & pan --------------------------------------------------------
     Fitting is CSS (aspect-ratio + max-width/height), so zoom is a transform
     on top of the fitted box: resize needs no JS and pan is the translate
     half of the same transform.
     -------------------------------------------------------------------- */

  Filedeck.prototype.zoomBy = function (delta) { this.setZoom(this.state.zoom + delta); };

  Filedeck.prototype.setZoom = function (value) {
    this.state.zoom = clamp(Math.round(value), this.zoomMin, this.zoomMax);
    if (this.state.zoom <= 100) { this.state.panX = 0; this.state.panY = 0; }
    this._applyTransform();
    this._emit('zoom');
  };

  Filedeck.prototype.resetView = function (silent) {
    this.state.zoom = 100;
    this.state.panX = 0;
    this.state.panY = 0;
    this._applyTransform();
    if (!silent) this._emit('zoom');
  };

  Filedeck.prototype._applyTransform = function () {
    this.els.zoomVal.textContent = this.state.zoom + '%';
    this.els.zoomOut.disabled = this.state.zoom <= this.zoomMin;
    this.els.zoomIn.disabled = this.state.zoom >= this.zoomMax;
    if (!this.els.canvas) return;

    this._clampPan();
    this.els.canvas.style.transform =
      'translate(' + this.state.panX + 'px,' + this.state.panY + 'px) ' +
      'scale(' + (this.state.zoom / 100) + ')';
    this.els.canvas.classList.toggle('can-pan', this.state.zoom > 100);
  };

  Filedeck.prototype._clampPan = function () {
    var canvas = this.els.canvas;
    if (!canvas) return;
    var s = this.state.zoom / 100;
    var cs = window.getComputedStyle(this.els.stage);
    var availW = this.els.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = this.els.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var maxX = Math.max(0, (canvas.offsetWidth * s - availW) / 2);
    var maxY = Math.max(0, (canvas.offsetHeight * s - availH) / 2);
    this.state.panX = clamp(this.state.panX, -maxX, maxX);
    this.state.panY = clamp(this.state.panY, -maxY, maxY);
  };

  /* -- gestures -----------------------------------------------------------
     One pointer: pan when zoomed in, otherwise swipe horizontally to navigate
     or vertically to dismiss. Two pointers: pinch to zoom. The axis is locked
     after tuning.axisLock pixels so a slightly diagonal swipe does one thing
     rather than both.
     -------------------------------------------------------------------- */

  function midpointOf(points) {
    var x = 0, y = 0;
    points.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / points.length, y: y / points.length };
  }

  function spreadOf(points) {
    var a = points[0], b = points[1];
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  Filedeck.prototype._onPointerDown = function (e) {
    if (!this.state.isOpen) return;
    // Native controls own their own touches — a video scrubber must not double
    // as a swipe target.
    if (e.target.closest(EMBEDDED)) return;

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var points = Array.from(this.pointers.values());
    var now = (window.performance || Date).now();

    if (this.pointers.size === 1) {
      this.gesture = {
        mode: this.state.zoom > 100 ? 'pan' : 'undecided',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastT: now,
        velocity: 0,
        panX: this.state.panX,
        panY: this.state.panY,
        moved: false
      };
      if (this.els.canvas) this.els.canvas.classList.add('is-gesturing');
      if (this.els.slide) this.els.slide.classList.remove('is-settling');
      return;
    }

    if (this.pointers.size === 2) {
      var item = this.current();
      if (!item || !item.caps.zoom) return;
      this.gesture = {
        mode: 'pinch',
        startSpread: spreadOf(points) || 1,
        startZoom: this.state.zoom,
        startMid: midpointOf(points),
        panX: this.state.panX,
        panY: this.state.panY,
        moved: true
      };
      this._resetSlideTransform();
    }
  };

  Filedeck.prototype._onPointerMove = function (e) {
    if (!this.gesture || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    var g = this.gesture;

    if (g.mode === 'pinch') {
      var points = Array.from(this.pointers.values());
      if (points.length < 2) return;
      e.preventDefault();

      var mid = midpointOf(points);
      this.state.zoom = clamp(
        Math.round(g.startZoom * (spreadOf(points) / g.startSpread)),
        this.zoomMin, this.zoomMax
      );
      this.state.panX = g.panX + (mid.x - g.startMid.x);
      this.state.panY = g.panY + (mid.y - g.startMid.y);
      this._applyTransform();
      return;
    }

    var dx = e.clientX - g.startX;
    var dy = e.clientY - g.startY;

    if (g.mode === 'undecided') {
      if (Math.abs(dx) < this.tuning.axisLock && Math.abs(dy) < this.tuning.axisLock) return;
      g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss';
      g.moved = true;
    }

    if (g.mode === 'pan') {
      e.preventDefault();
      g.moved = true;
      this.state.panX = g.panX + dx;
      this.state.panY = g.panY + dy;
      this._applyTransform();
      return;
    }

    e.preventDefault();

    // Velocity is sampled over the last move only. A flick is recognised by
    // how fast the finger was travelling when it left, not its average.
    var now = (window.performance || Date).now();
    var elapsed = now - g.lastT;
    if (elapsed > 0) {
      g.velocity = (e.clientX - g.lastX) / elapsed;
      g.lastX = e.clientX;
      g.lastT = now;
    }

    if (g.mode === 'swipe') {
      // Dragging past the first or last item resists rather than moving
      // freely, which is how the edge of a list is normally signalled.
      var atEdge = (dx > 0 && this.state.index === 0) ||
                   (dx < 0 && this.state.index === this.items.length - 1);
      var offset = atEdge ? dx * this.tuning.edgeResistance : dx;
      this._setSlideTransform('translateX(' + offset + 'px)', 1);
      return;
    }

    if (g.mode === 'dismiss') {
      var fade = Math.max(0, 1 - Math.abs(dy) / (this.tuning.dismissDistance * 3));
      g.dy = dy;
      this._setSlideTransform('translateY(' + dy + 'px) scale(' + (0.9 + fade * 0.1) + ')', fade);
      this.root.style.backgroundColor = 'rgba(12, 13, 24, ' + (0.86 * fade) + ')';
    }
  };

  Filedeck.prototype._onPointerUp = function (e) {
    this.pointers.delete(e.pointerId);
    var g = this.gesture;
    if (!g) return;

    // Lifting one finger of a pinch shouldn't start a pan with the other.
    if (this.pointers.size > 0) {
      if (g.mode === 'pinch') this.gesture = null;
      return;
    }

    this.gesture = null;
    if (this.els.canvas) this.els.canvas.classList.remove('is-gesturing');
    if (g.moved) this._suppressClick = true;

    if (g.mode === 'pinch') {
      if (this.state.zoom <= 100) this.resetView();
      else this._applyTransform();
      return;
    }

    if (g.mode === 'pan' || g.mode === 'undecided') return;

    var dx = g.lastX - g.startX;

    if (g.mode === 'swipe') {
      var threshold = this.els.stage.clientWidth * this.tuning.swipeRatio;
      var far = Math.abs(dx) > threshold;
      var fast = Math.abs(g.velocity) > this.tuning.flickVelocity;

      if (far || fast) {
        var target = dx < 0 ? this.state.index + 1 : this.state.index - 1;
        if (target >= 0 && target < this.items.length) {
          // goTo replaces the slide element wholesale, so the drag transform
          // leaves with it — nothing to unwind.
          this.goTo(target);
          return;
        }
      }
      this._settleSlide();
      return;
    }

    if (g.mode === 'dismiss') {
      var travelled = Math.abs(g.dy || 0);
      if (travelled > this.tuning.dismissDistance) {
        this.close();
        this._resetSlideTransform();
        this.root.style.backgroundColor = '';
        return;
      }
      this._settleSlide();
      this.root.style.backgroundColor = '';
    }
  };

  Filedeck.prototype._setSlideTransform = function (transform, opacity) {
    if (!this.els.slide) return;
    this.els.slide.style.transform = transform;
    this.els.slide.style.opacity = opacity;
  };

  Filedeck.prototype._resetSlideTransform = function () {
    if (!this.els.slide) return;
    this.els.slide.style.transform = '';
    this.els.slide.style.opacity = '';
  };

  /* An abandoned drag springs back. This is the only motion left in the
     viewer — remove the is-settling class from the CSS and it snaps instead. */
  Filedeck.prototype._settleSlide = function () {
    var slide = this.els.slide;
    if (!slide) return;
    slide.classList.add('is-settling');
    this._resetSlideTransform();
    setTimeout(function () { slide.classList.remove('is-settling'); }, 220);
  };

  /* -- wheel & double-click zoom ----------------------------------------- */

  Filedeck.prototype._onWheel = function (e) {
    var item = this.current();
    if (!this.state.isOpen || !item || !item.caps.zoom) return;
    if (e.target.closest(EMBEDDED)) return;

    // A trackpad pinch arrives as a wheel event with ctrlKey set; a plain
    // wheel has nothing to scroll here, so both zoom.
    e.preventDefault();
    var step = e.ctrlKey ? 2 : 10;
    this.setZoom(this.state.zoom - Math.sign(e.deltaY) * step);
  };

  Filedeck.prototype._onDoubleClick = function (e) {
    var item = this.current();
    if (!item || !item.caps.zoom) return;
    if (e.target.closest(EMBEDDED)) return;
    if (!e.target.closest('.fd-canvas')) return;

    if (this.state.zoom > 100) this.resetView();
    else this.setZoom(200);
  };

  /* -- rendering ---------------------------------------------------------
     The <img> is created here and nowhere else. Zoom, pan and window resize
     never touch it, so each attachment is fetched and decoded once.
     -------------------------------------------------------------------- */

  Filedeck.prototype.render = function () {
    var item = this.current();
    if (!item) return;

    this._renderStage(item);
    this._renderChrome(item);
    this._markActiveThumb();
    this._applyTransform();

    this.els.live.textContent = fill(this.labels.position, {
      name: item.name, index: this.state.index + 1, total: this.items.length
    });
  };

  Filedeck.prototype._renderStage = function (item) {
    // The slide wraps the canvas and caption as one unit; the canvas inside
    // it owns the zoom and pan transform.
    var slide = document.createElement('div');
    slide.className = 'fd-slide';

    var canvas = document.createElement('div');

    // Resolve the kind actually rendered — a PDF on a narrow screen becomes a
    // file card, and that decision has to be made here rather than in _readItem
    // so a rotated tablet gets the right treatment on the next open.
    var kind = item.kind;
    if (kind === 'pdf' && !canEmbedPdf()) kind = 'file';
    canvas.className = 'fd-canvas fd-canvas--' + kind;

    switch (kind) {
      case 'image': this._renderImage(item, canvas); break;
      case 'pdf':   this._renderPdf(item, canvas); break;
      case 'video': this._renderVideo(item, canvas); break;
      case 'audio': this._renderAudio(item, canvas); break;
      default:      this._renderFile(item, canvas); break;
    }

    slide.appendChild(canvas);

    var captionText = kind === 'file'
      ? ''   // the card itself already shows the name and size
      : [item.caption, item.size].filter(Boolean).join(' · ');
    if (captionText) {
      var cap = document.createElement('div');
      cap.className = 'fd-cap';
      cap.textContent = captionText;
      slide.appendChild(cap);
    }

    this._swapSlide(slide);
    this.els.canvas = canvas;

    this._preload(this.state.index + 1);
    this._preload(this.state.index - 1);
  };

  /* -- renderers ---------------------------------------------------------
     One per kind. Each fills the canvas element it's handed; adding a new
     type means adding a method and a case, nothing else.
     -------------------------------------------------------------------- */

  Filedeck.prototype._renderImage = function (item, canvas) {
    var self = this;
    canvas.style.setProperty('--fd-ar', (item.width || 3) + ' / ' + (item.height || 2));

    // The spinner fades in on a CSS delay, so a cached image that decodes
    // immediately never flashes one.
    canvas.classList.add('is-loading');

    var img = document.createElement('img');
    img.className = 'fd-media';
    img.alt = item.caption || item.name;
    img.decoding = 'async';
    img.addEventListener('load', function () {
      canvas.classList.remove('is-loading');
    }, { once: true });
    img.src = item.url;

    // Without data-width/height the aspect is a guess until the intrinsic
    // size is known; correct it on load rather than staying wrong.
    if (!item.width || !item.height) {
      img.addEventListener('load', function () {
        canvas.style.setProperty('--fd-ar', img.naturalWidth + ' / ' + img.naturalHeight);
      }, { once: true });
    }
    img.addEventListener('error', function () {
      canvas.classList.remove('is-loading');
      self._renderFallback(item, canvas, self.labels.imageFailed);
    }, { once: true });

    canvas.appendChild(img);
  };

  Filedeck.prototype._renderPdf = function (item, canvas) {
    // <embed> hands off to the browser's own PDF viewer — toolbar, search,
    // page navigation included, for no bytes.
    var embed = document.createElement('embed');
    embed.className = 'fd-embed';
    embed.type = 'application/pdf';
    embed.src = item.url + '#view=FitH';
    canvas.appendChild(embed);

    // A blocked or failed embed still fires load, so there's no event to hook.
    // Without a way out, a grey box is a dead end — this link always shows.
    var open = document.createElement('a');
    open.className = 'fd-pdf-open';
    open.href = item.url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.innerHTML = icon('external', 14, 1.8) + esc(this.labels.openNewTab);
    canvas.appendChild(open);
  };

  Filedeck.prototype._renderVideo = function (item, canvas) {
    var self = this;
    canvas.style.setProperty('--fd-ar', (item.width || 16) + ' / ' + (item.height || 9));

    var video = document.createElement('video');
    video.className = 'fd-media fd-video';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (item.thumb) video.poster = item.thumb;
    video.src = item.url;

    if (!item.width || !item.height) {
      video.addEventListener('loadedmetadata', function () {
        if (video.videoWidth) {
          canvas.style.setProperty('--fd-ar', video.videoWidth + ' / ' + video.videoHeight);
        }
      }, { once: true });
    }
    // A .mov whose codec the browser can't decode fails here, not on fetch.
    video.addEventListener('error', function () {
      self._renderFallback(item, canvas, self.labels.videoFailed);
    }, { once: true });

    canvas.appendChild(video);
  };

  Filedeck.prototype._renderAudio = function (item, canvas) {
    var self = this;
    var wrap = document.createElement('div');
    wrap.className = 'fd-audio';
    wrap.innerHTML =
      '<div class="dg">' + icon('audio', 30, 1.6) + '</div>' +
      '<b></b>' +
      (item.size ? '<span>' + esc(item.size) + '</span>' : '');
    wrap.querySelector('b').textContent = item.name;

    var audio = document.createElement('audio');
    audio.className = 'fd-media';
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = item.url;
    audio.addEventListener('error', function () {
      self._renderFallback(item, canvas, self.labels.audioFailed);
    }, { once: true });

    wrap.appendChild(audio);
    canvas.appendChild(wrap);
  };

  Filedeck.prototype._renderFile = function (item, canvas) {
    // No browser renders docx, xlsx or CAD. Rather than pretend, the card says
    // what the file is and puts the download one click away.
    canvas.innerHTML =
      '<div class="fd-doc">' +
        '<div class="dg">' + fileIcon(item.ext, 46, 55) + '</div>' +
        '<b></b>' +
        '<span>' + esc(item.size || this.labels.noPreview) + '</span>' +
        '<a class="fd-doc-dl" download>' + icon('dl', 16, 1.8) + esc(this.labels.download) + '</a>' +
      '</div>';
    canvas.querySelector('b').textContent = item.name;

    var link = canvas.querySelector('.fd-doc-dl');
    link.href = item.url;
    link.setAttribute('download', item.name);
  };

  Filedeck.prototype._renderFallback = function (item, canvas, message) {
    canvas.className = 'fd-canvas fd-canvas--file is-error';
    canvas.style.removeProperty('--fd-ar');
    this._renderFile(item, canvas);

    // It is a card now, so it centres like one: no caption, no zoom controls.
    var slide = canvas.parentNode;
    var caption = slide && slide.querySelector('.fd-cap');
    if (caption) caption.parentNode.removeChild(caption);
    this.els.zoom.hidden = true;
    this.els.stage.classList.add('no-zoom');
    var line = canvas.querySelector('.fd-doc span:last-of-type');
    if (line) line.textContent = message;
  };

  Filedeck.prototype._swapSlide = function (slide) {
    var outgoing = this.els.slide;
    if (outgoing) {
      pauseMedia(outgoing); // removing the node isn't enough on every browser
      outgoing.remove();
    }
    this.els.figure.appendChild(slide);
    this.els.slide = slide;
  };

  Filedeck.prototype._preload = function (i) {
    var item = this.items[i];
    if (!item || !item.url || !item.caps.preload) return;
    var img = new window.Image();
    img.src = item.url;
  };

  Filedeck.prototype._renderChrome = function (item) {
    var single = this.items.length < 2;

    this.els.name.textContent = item.name;
    this.els.meta.textContent = item.meta;
    this.els.meta.hidden = !item.meta;
    this.els.icon.innerHTML = icon(TOP_ICON[item.kind] || 'doc', 19);

    // The zoom cluster is meaningless for a PDF, a video or a file card, and
    // leaving dead controls on screen is worse than removing them.
    this.els.zoom.hidden = !item.caps.zoom;
    // The bottom padding exists to clear the zoom cluster. With no cluster it
    // is dead space that pushes the stage content off centre.
    this.els.stage.classList.toggle('no-zoom', !item.caps.zoom);

    this.els.count.textContent = fill(this.labels.counter, {
      index: this.state.index + 1, total: this.items.length
    });
    this.els.count.hidden = single;

    this.els.prev.hidden = single;
    this.els.next.hidden = single;
    this.els.prev.disabled = this.state.index === 0;
    this.els.next.disabled = this.state.index === this.items.length - 1;

    if (this.els.download) {
      this.els.download.href = item.url;
      this.els.download.setAttribute('download', item.name);
    }
  };

  /* -- filmstrip --------------------------------------------------------- */

  Filedeck.prototype.renderStrip = function () {
    // One attachment needs no filmstrip; an empty strip just steals vertical
    // space from the image.
    if (!this.showFilmstrip || this.items.length < 2) {
      this.els.strip.hidden = true;
      this.els.strip.innerHTML = '';
      return;
    }

    this.els.strip.hidden = false;
    this.els.strip.innerHTML = this.items.map(function (it, i) {
      var inner = it.thumb
        ? '<img src="' + esc(it.thumb) + '" alt="" loading="lazy">'
        : fileIcon(it.ext, 26, 31);
      return '<button type="button" class="fd-thumb" data-index="' + i + '" ' +
        'title="' + esc(it.name) + '">' + inner +
        '<span class="tl">' + esc(it.name) + '</span></button>';
    }).join('');
  };

  Filedeck.prototype._markActiveThumb = function () {
    var thumbs = this.els.strip.querySelectorAll('.fd-thumb');
    for (var i = 0; i < thumbs.length; i++) {
      var on = i === this.state.index;
      thumbs[i].classList.toggle('on', on);
      thumbs[i].setAttribute('aria-current', on ? 'true' : 'false');
      if (on) thumbs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  /* -- actions ----------------------------------------------------------- */

  Filedeck.prototype._copyLink = function () {
    var item = this.current();
    if (!item) return;

    var self = this;
    var url = new URL(item.url, location.href).href;
    var button = this.root.querySelector('[data-fd="copy"]');

    copyText(url).then(function (copied) {
      // The fallback steals focus into a throwaway textarea; put it back.
      if (button) {
        button.focus();
        self._flashCopy(button, copied);
      }
      self._emit('action:copy', { item: item, url: url, copied: copied });
    });
  };

  /* Silence reads the same whether the copy worked or not, so say which. */
  Filedeck.prototype._flashCopy = function (button, copied) {
    var label = copied ? this.labels.copied : this.labels.copyFailed;
    button.setAttribute('data-fd-flash', label);
    button.classList.add('is-flashing');
    button.classList.toggle('did-fail', !copied);

    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(function () {
      button.classList.remove('is-flashing', 'did-fail');
      button.removeAttribute('data-fd-flash');
    }, 1400);
  };

  Filedeck.prototype._emit = function (name, detail) {
    var d = detail || {};
    d.index = this.state.index;
    d.item = d.item || this.current();
    this.root.dispatchEvent(new window.CustomEvent('filedeck:' + name, {
      detail: d, bubbles: true
    }));
  };

  /* -- teardown ---------------------------------------------------------- */

  Filedeck.prototype.destroy = function () {
    document.removeEventListener('click', this._h.docClick);
    document.removeEventListener('keydown', this._h.keydown);
    this.root.removeEventListener('click', this._h.rootClick);
    this.els.stage.removeEventListener('pointerdown', this._h.pointerDown);
    window.removeEventListener('pointermove', this._h.pointerMove);
    window.removeEventListener('pointerup', this._h.pointerUp);
    window.removeEventListener('pointercancel', this._h.pointerUp);
    this.els.stage.removeEventListener('wheel', this._h.wheel);
    this.els.stage.removeEventListener('dblclick', this._h.dblclick);
    clearTimeout(this._flashTimer);
    document.body.classList.remove('fd-lock'); // never strand a locked page
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.state.isOpen = false;
  };

  return Filedeck;
})();
