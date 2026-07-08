(function () {
  // birdnet-go connection - set in config.js
  var BN = (typeof BIRDNET_GO_URL !== 'undefined' ? BIRDNET_GO_URL : '').replace(/\/+$/, '');

  // ---- Helpers for birdnet-go API translation ----
  function bngFetch(path) {
    return fetchJson(BN + path);
  }

  // ---- JWT auth ----
  var __token = (function () {
    try { var t = localStorage.getItem('bird:token'); return t || null; } catch (e) { return null; }
  })();
  function audioApiUrl(id) {
    var u = BN + '/api/v2/audio/' + encodeURIComponent(id) + (__token ? '?token=' + encodeURIComponent(__token) : '');
    console.debug('[jwt] audioApiUrl:', u, 'BN:', BN, 'has_token:', !!__token);
    return u;
  }

  function storeToken(t) {
    __token = t;
    try { if (t) localStorage.setItem('bird:token', t); else localStorage.removeItem('bird:token'); } catch (e) {}
  }
  function clearToken() { storeToken(null); }
  function isUnlocked() { return !!__token; }

  // Convert hours to birdnet-go date range params
  function dateRangeForHours(hours) {
    if (hours >= 1000000) return { all: true, start_date: null, end_date: null };
    var now = new Date();
    var start = new Date(now.getTime() - hours * 3600000);
    return {
      all: false,
    start_date: fmtDate(start),
    end_date: fmtDate(now),
    };
  }

  function fmtDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var dd = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }

  // Translate birdnet-go species summary rows to AvianVisitors format
  function toAVSpecies(s) {
    return {
      sci: s.scientific_name,
      com: s.common_name,
      n: s.count,
      first_seen: s.first_heard,
      last_seen: s.last_heard,
      best_conf: s.max_confidence,
    };
  }

  // Resolve audio URL for a species: fetch the top detection lazily
  var _audioUrlCache = {};
  var _pendingAudioResolve = {};
  function resolveAudioUrl(sci, callback) {
    if (_audioUrlCache[sci]) { callback(_audioUrlCache[sci]); return; }
    if (_pendingAudioResolve[sci]) { _pendingAudioResolve[sci].push(callback); return; }
    _pendingAudioResolve[sci] = [callback];
    bngFetch('/api/v2/detections?species=' + encodeURIComponent(sci) + '&limit=1&sortBy=date_desc')
      .then(function (res) {
        var url = null;
        if (res.data && res.data.length && res.data[0].id) {
          url = audioApiUrl(res.data[0].id);
        }
        _audioUrlCache[sci] = url;
        var cbs = _pendingAudioResolve[sci] || [];
        delete _pendingAudioResolve[sci];
        cbs.forEach(function (cb) { cb(url); });
      })
      .catch(function () {
        var cbs = _pendingAudioResolve[sci] || [];
        delete _pendingAudioResolve[sci];
        cbs.forEach(function (cb) { cb(null); });
      });
  }

  function todayStr() { return fmtDate(new Date()); }
  function weekAgoStr() {
    var d = new Date(); d.setDate(d.getDate() - 6); return fmtDate(d);
  }
  function monthAgoStr() {
    var d = new Date(); d.setDate(d.getDate() - 29); return fmtDate(d);
  }
  function sum(arr, key) {
    return (arr || []).reduce(function (a, r) { return a + (+r[key] || 0); }, 0);
  }

  var PLACEHOLDER = [{"sci":"Calypte anna","com":"Anna's Hummingbird","featured":true},{"sci":"Passer domesticus","com":"House Sparrow"},{"sci":"Haemorhous mexicanus","com":"House Finch"},{"sci":"Turdus migratorius","com":"American Robin"},{"sci":"Zenaida macroura","com":"Mourning Dove"},{"sci":"Spinus psaltria","com":"Lesser Goldfinch"},{"sci":"Zonotrichia leucophrys","com":"White-crowned Sparrow"},{"sci":"Aphelocoma californica","com":"California Scrub-Jay"},{"sci":"Mimus polyglottos","com":"Northern Mockingbird"},{"sci":"Sayornis nigricans","com":"Black Phoebe"},{"sci":"Larus occidentalis","com":"Western Gull"},{"sci":"Corvus brachyrhynchos","com":"American Crow"}];
  var SKETCH_VERSION = '8';
  var IMG_VERSION = '4';

  // ---- Sliding pill helper ----
  function syncPill(container) {
    var pill = container.querySelector('.seg-pill');
    var active = container.querySelector('button[aria-current="true"]');
    if (!pill || !active) return;
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }

  function wireToggleAdvance(container) {
    if (!container || container.__advanceWired) return;
    container.__advanceWired = true;
    container.addEventListener('click', function (ev) {
      if (ev.target.closest('button')) return;
      var btns = [].slice.call(container.querySelectorAll('button')).filter(function (b) {
        return !b.disabled && b.getAttribute('data-unavailable') !== 'true';
      });
      if (btns.length < 2) return;
      var cur = -1;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('aria-current') === 'true') { cur = i; break; }
      }
      btns[(cur + 1) % btns.length].click();
    });
  }

  // ---- Slider ----
  var views = document.getElementById('views');
  var slider = document.getElementById('slider');
  var btns = [].slice.call(slider.querySelectorAll('button'));
  var winPick = document.getElementById('winPick');

  var VIEW_TITLES = ['Heard Recently', 'Heard Recently', 'Avian Visitors'];
  var staticHead = document.querySelector('.static-head');
  var staticTitle = document.getElementById('staticTitle');
  function setTitleForView(i) {
    var next = VIEW_TITLES[i];
    if (!staticTitle || staticTitle.textContent === next) return;
    staticHead.classList.add('swap-out');
    setTimeout(function () {
      staticTitle.textContent = next;
      void staticHead.offsetWidth;
      staticHead.classList.remove('swap-out');
    }, 220);
  }

  var SLIDE_MS = 480;
  var SWITCH_LEAD = SLIDE_MS - 100;
  var STATS_LEAD = SLIDE_MS - 200;
  var currentView = 0;
  function go(i) {
    i = Math.max(0, Math.min(2, i));
    var switching = (i !== currentView);
    currentView = i;
    views.style.transform = 'translateX(-' + (i * 100) + '%)';
    btns.forEach(function (b, j) { b.setAttribute('aria-current', j === i ? 'true' : 'false'); });
    syncPill(slider);
    setTitleForView(i);
    if (!switching) return;
    if (i === 0) playCollageEntrance();
    else if (i === 1) playStatsEntrance(STATS_LEAD);
    else if (i === 2) playAtlasEntrance(SWITCH_LEAD);
  }
  btns.forEach(function (b) { b.addEventListener('click', function () { go(+b.dataset.i); }); });

  // ---- Window picker ----
  function readLS(k, fallback) { try { return localStorage.getItem(k) || fallback; } catch (e) { return fallback; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---- Single-audio coordinator ----
  var __audioActiveStop = null;
  function audioClaim(stopSelf) {
    if (__audioActiveStop && __audioActiveStop !== stopSelf) {
      var prev = __audioActiveStop;
      __audioActiveStop = null;
      try { prev(); } catch (e) {}
    }
    __audioActiveStop = stopSelf;
  }
  function audioRelease(stopSelf) {
    if (__audioActiveStop === stopSelf) __audioActiveStop = null;
  }

  // ---- Theme ----
  function applyTheme(name) {
    var t = name === 'dark' ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    writeLS('bird:theme', t);
  }
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  applyTheme(readLS('bird:theme', 'light'));
  var winBtns = [].slice.call(winPick.querySelectorAll('button'));
  var currentHours = +readLS('bird:window', '24') || 24;
  winBtns.forEach(function (b) {
    b.setAttribute('aria-current', (+b.dataset.h === currentHours) ? 'true' : 'false');
  });
  winBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      winBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      currentHours = +b.dataset.h;
      writeLS('bird:window', String(currentHours));
      syncPill(winPick);
    });
  });

  // Atlas sort
  var atlasSortEl = document.getElementById('atlasSort');
  var atlasSortBtns = atlasSortEl ? [].slice.call(atlasSortEl.querySelectorAll('button')) : [];
  window.__atlasSort = readLS('bird:atlasSort', 'count');
  atlasSortBtns.forEach(function (b) {
    b.setAttribute('aria-current', (b.dataset.sort === window.__atlasSort) ? 'true' : 'false');
  });
  atlasSortBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      atlasSortBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      window.__atlasSort = b.dataset.sort;
      writeLS('bird:atlasSort', window.__atlasSort);
      syncPill(atlasSortEl);
      renderAtlas(true);
    });
  });

  wireToggleAdvance(slider);
  wireToggleAdvance(winPick);
  wireToggleAdvance(atlasSortEl);
  wireToggleAdvance(document.getElementById('modalPoseToggle'));
  function syncAllPills() { syncPill(slider); syncPill(winPick); if (atlasSortEl) syncPill(atlasSortEl); }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncAllPills);
  }
  requestAnimationFrame(function () { requestAnimationFrame(syncAllPills); });
  var pillTimer;
  window.addEventListener('resize', function () {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(syncAllPills, 80);
  });

  // ---- Raster-bitmask collage ----
  var collage = document.getElementById('collage');
  var DIMS = {};

  var MASKS = {};

  var EBIRD_CODES = {};
  // Load DIMS + MASKS from external JSON
  function loadCollageData(callback) {
    if (Object.keys(DIMS).length && Object.keys(MASKS).length) { if (callback) callback(); return; }
    Promise.all([
      fetch("./dims.json", { cache: "no-store" }).then(function (r) { return r.json(); }),
      fetch("./masks.json", { cache: "no-store" }).then(function (r) { return r.json(); }),
      fetch("./ebird_codes.json", { cache: "no-store" }).then(function (r) { return r.json(); }),
    ]).then(function (parts) {
      DIMS = parts[0];
      MASKS = parts[1];
      EBIRD_CODES = parts[2];
      if (callback) callback();
    }).catch(function () {
      if (callback) callback();
    });
  }
  

  function tuning(n) {
    return {
      packingBudgetFrac: n <= 4  ? 0.46 :
                          n <= 12 ? 0.40 :
                          n <= 24 ? 0.34 :
                                    0.28,
      countExp: 0.65,
      minTileAreaFrac: n <= 8 ? 0.0100 :
                        n <= 20 ? 0.0075 :
                                  0.0055,
      ellipseAspectBias: 2.1,
    };
  }
  var GRID_STRIDE = 4;

  var maskCache = {};
  function loadMask(slug) {
    if (maskCache[slug]) return maskCache[slug];
    var rec = MASKS[slug];
    if (!rec) return null;
    var bytes = atob(rec.bits);
    var w = rec.w, h = rec.h;
    var cells = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var b = bytes.charCodeAt(i >> 3);
        if ((b >> (7 - (i & 7))) & 1) cells.push([x, y]);
      }
    }
    return (maskCache[slug] = { w: w, h: h, cells: cells });
  }

  function slugify(sci) {
    return sci.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function aspect(sci) {
    var d = DIMS[slugify(sci)];
    return d ? d[0] / d[1] : 1.4;
  }

  function maskPack(tiles, W, H, ellipseBias) {
    var GW = Math.ceil(W / GRID_STRIDE) + 2;
    var GH = Math.ceil(H / GRID_STRIDE) + 2;
    var grid = new Uint8Array(GW * GH);

    function cellRange(tile, tx, ty, c) {
      var sx = tile.fullW / tile.mask.w;
      var sy = tile.fullH / tile.mask.h;
      var x0 = (tx + c[0] * sx) / GRID_STRIDE | 0;
      var y0 = (ty + c[1] * sy) / GRID_STRIDE | 0;
      var x1 = (tx + (c[0] + 1) * sx) / GRID_STRIDE | 0;
      var y1 = (ty + (c[1] + 1) * sy) / GRID_STRIDE | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 >= GW) x1 = GW - 1; if (y1 >= GH) y1 = GH - 1;
      return [x0, y0, x1, y1];
    }
    function collides(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) {
            if (grid[off + gx]) return true;
          }
        }
      }
      return false;
    }
    function stamp(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) grid[off + gx] = 1;
        }
      }
    }
    function offGrid(tile, tx, ty) {
      return tx < 0 || ty < 0 || tx + tile.fullW > W || ty + tile.fullH > H;
    }

    var cx = W / 2, cy = H / 2;
    tiles.sort(function (a, b) { return (b.fullW * b.fullH) - (a.fullW * a.fullH); });
    var placed = [];
    var seed = 0x9E3779B9;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var tx, ty;
      if (i === 0) {
        tx = cx - t.fullW / 2;
        ty = cy - t.fullH / 2;
        t.x = tx; t.y = ty;
        stamp(t, tx, ty);
        placed.push(t);
        continue;
      }
      var comX = 0, comY = 0, comW = 0;
      placed.forEach(function (p) {
        var a = p.fullW * p.fullH;
        comX += (p.x + p.fullW / 2) * a;
        comY += (p.y + p.fullH / 2) * a;
        comW += a;
      });
      comX /= comW; comY /= comW;

      var best = null, bestCost = Infinity;
      var step = Math.max(GRID_STRIDE, Math.min(t.fullW, t.fullH) * 0.05);
      var maxR = Math.max(W, H);
      var foundRing = -1;
      var phase = rand() * Math.PI * 2;
      for (var r = 0; r <= maxR; r += step) {
        if (foundRing >= 0 && r > foundRing + step * 2) break;
        var samples = Math.max(36, Math.floor(r / 1.6));
        for (var k = 0; k < samples; k++) {
          var theta = phase + (k / samples) * Math.PI * 2;
          var px = cx + r * ellipseBias * Math.cos(theta) - t.fullW / 2;
          var py = cy + r * Math.sin(theta) - t.fullH / 2;
          if (offGrid(t, px, py)) continue;
          if (collides(t, px, py)) continue;
          var dxx = (px + t.fullW / 2 - comX);
          var dyy = (py + t.fullH / 2 - comY);
          var cost = Math.hypot(dxx / ellipseBias, dyy) + rand() * step * 0.5;
          if (cost < bestCost) { bestCost = cost; best = { x: px, y: py }; }
        }
        if (best && foundRing < 0) foundRing = r;
      }
      if (best) {
        t.x = best.x; t.y = best.y;
        stamp(t, best.x, best.y);
        placed.push(t);
      } else {
        t.x = -99999; t.y = -99999;
        placed.push(t);
      }
    }
    return placed;
  }

  function renderCollage(items, animate) {
    if (!Object.keys(DIMS).length || !Object.keys(MASKS).length) {
      collage.innerHTML = '<p class="empty">loading collage data...</p>';
      return;
    }
    collage.innerHTML = '';
    if (!items.length) {
      collage.innerHTML = '<p class="empty">no birds heard in this window.</p>';
      return;
    }
    var W = collage.clientWidth, H = collage.clientHeight;
    if (!W || !H) { setTimeout(function () { renderCollage(items, animate); }, 80); return; }

    var T = tuning(items.length);
    var vpArea = W * H;
    var budget  = vpArea * T.packingBudgetFrac;
    var minArea = vpArea * T.minTileAreaFrac;

    var tiles = items.map(function (s) {
      var slug = slugify(s.sci);
      var mask = loadMask(slug);
      if (!mask) return null;
      var n = +s.n; if (!n || isNaN(n)) n = 1;
      return {
        mask: mask, data: s,
        ar: aspect(s.sci),
        score: Math.pow(Math.max(1, n), T.countExp),
      };
    }).filter(Boolean);

    var sumScore = tiles.reduce(function (a, t) { return a + t.score; }, 0) || 1;
    tiles.forEach(function (t) {
      t.area = Math.max(minArea, budget * t.score / sumScore);
    });
    var sumA = tiles.reduce(function (a, t) { return a + t.area; }, 0);
    if (sumA > budget) {
      var fixedSum = tiles.filter(function (t) { return t.area <= minArea + 1e-9; })
        .reduce(function (a, t) { return a + t.area; }, 0);
      var flexSum  = sumA - fixedSum;
      var flexBudget = Math.max(0, budget - fixedSum);
      var shrink = flexSum > 0 ? Math.min(1, flexBudget / flexSum) : 1;
      tiles.forEach(function (t) {
        if (t.area > minArea + 1e-9) t.area *= shrink;
      });
    }
    tiles.forEach(function (t) {
      t.fullW = Math.sqrt(t.area * t.ar);
      t.fullH = t.fullW / t.ar;
    });

    var placed = maskPack(tiles, W, H, T.ellipseAspectBias);

    function clusterBounds(arr) {
      var L = Infinity, R = -Infinity, T2 = Infinity, B = -Infinity;
      arr.forEach(function (t) {
        if (t.x < -1000) return;
        if (t.x < L) L = t.x;
        if (t.x + t.fullW > R) R = t.x + t.fullW;
        if (t.y < T2) T2 = t.y;
        if (t.y + t.fullH > B) B = t.y + t.fullH;
      });
      return { L: L, R: R, T: T2, B: B };
    }
    var b = clusterBounds(placed);
    for (var iter = 0; iter < 10; iter++) {
      var missing  = placed.some(function (t) { return t.x < -1000; });
      var overflow = b.L < 0 || b.T < 0 || b.R > W || b.B > H;
      if (!missing && !overflow) break;
      var scale = 0.93;
      if (overflow) {
        var clW = b.R - b.L, clH = b.B - b.T;
        var sx = (W * 0.96) / Math.max(clW, W * 0.96);
        var sy = (H * 0.94) / Math.max(clH, H * 0.94);
        scale = Math.min(scale, sx, sy);
      }
      tiles.forEach(function (t) { t.fullW *= scale; t.fullH *= scale; });
      placed = maskPack(tiles, W, H, T.ellipseAspectBias);
      b = clusterBounds(placed);
    }

    var dx = W / 2 - (b.L + b.R) / 2;
    var dy = H / 2 - (b.T + b.B) / 2;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      placed.forEach(function (t) { if (t.x > -1000) { t.x += dx; t.y += dy; } });
    }

    placed.forEach(function (r) {
      var s = r.data;
      var slug = slugify(s.sci);
      var img = './assets/illustrations/' + slug + '.png';
      var fallback = './assets/cutouts/' + slug + '.png';
      var btn = document.createElement('button');
      btn.className = 'gtile';
      btn.type = 'button';
      btn.setAttribute('data-sci', s.sci);
      btn.setAttribute('aria-label', s.com);
      var titleN = +s.n || 0;
      btn.title = (s.com || s.sci) + ' \u00b7 ' + fmtN(titleN) + ' ' +
        (titleN === 1 ? 'call' : 'calls') + ' ' + windowLabel(currentHours);
      btn.style.left   = r.x + 'px';
      btn.style.top    = r.y + 'px';
      btn.style.width  = r.fullW + 'px';
      btn.style.height = r.fullH + 'px';
      btn.innerHTML = '<img loading="lazy" decoding="async" src="' + img + '" alt="' + s.com + '"'
        + ' onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
      r.el = btn;
      collage.appendChild(btn);
    });
    var tip = document.createElement('div');
    tip.id = 'collageTip';
    tip.className = 'collage-tip';
    tip.setAttribute('aria-hidden', 'true');
    collage.appendChild(tip);
    collagePlaced = placed.filter(function (t) { return t.x > -1000; });

    if (animate) playCollageEntrance();
  }

  var collageEntranceT = null;
  function playCollageEntrance() {
    var tiles = [].slice.call(collage.querySelectorAll('.gtile'));
    if (!tiles.length) return;
    var cx = collage.clientWidth / 2, cy = collage.clientHeight / 2;
    var maxD = 1;
    var info = tiles.map(function (t) {
      var d = Math.hypot((t.offsetLeft + t.offsetWidth / 2) - cx,
                         (t.offsetTop + t.offsetHeight / 2) - cy);
      if (d > maxD) maxD = d;
      return { el: t, d: d };
    });
    var SPREAD = 520;
    info.forEach(function (o) {
      o.el.classList.remove('entering');
      o.el.style.animationDelay = ((o.d / maxD) * SPREAD).toFixed(0) + 'ms';
    });
    void collage.offsetWidth;
    info.forEach(function (o) { o.el.classList.add('entering'); });
    clearTimeout(collageEntranceT);
    collageEntranceT = setTimeout(function () {
      info.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = ''; });
    }, SPREAD + 520);
  }

  var atlasEntranceT = null;
  function playAtlasEntrance(lead) {
    lead = lead || 0;
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;
    var cards = [].slice.call(grid.querySelectorAll('.bird-card'));
    if (!cards.length) return;
    var uniqTops = cards.map(function (c) { return c.offsetTop; })
      .sort(function (a, b) { return a - b; })
      .filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    var rowOf = {}; uniqTops.forEach(function (t, i) { rowOf[t] = i; });
    var PER_ROW = 90, MAX_ROW = 10;
    cards.forEach(function (c) {
      c.classList.remove('entering');
      c.style.animationDelay = (lead + Math.min(rowOf[c.offsetTop] || 0, MAX_ROW) * PER_ROW) + 'ms';
    });
    void grid.offsetWidth;
    cards.forEach(function (c) { c.classList.add('entering'); });
    clearTimeout(atlasEntranceT);
    atlasEntranceT = setTimeout(function () {
      cards.forEach(function (c) { c.classList.remove('entering'); c.style.animationDelay = ''; });
    }, lead + MAX_ROW * PER_ROW + 540);
  }

  var statsEntranceT = null;
  function playStatsEntrance(lead) {
    lead = lead || 0;
    var plot = document.querySelector('.stats-tl-plot');
    if (!plot) return;
    var SPREAD = 460;
    var items = [].slice.call(plot.querySelectorAll('.stats-tl-col, .stats-tl-gridline, .stats-tl-xtick'))
      .map(function (el) { return { el: el, d: ((parseFloat(el.style.left) || 0) / 100) * SPREAD }; });
    var yaxis = document.querySelector('.stats-tl-yaxis');
    if (yaxis) items.push({ el: yaxis, d: 0 });
    var side = document.querySelector('.stats-side');
    if (side) {
      [].slice.call(side.querySelectorAll('h3, small')).forEach(function (el) { items.push({ el: el, d: 40 }); });
      var rows = [].slice.call(side.querySelectorAll('li'));
      rows.forEach(function (el, i) { items.push({ el: el, d: 80 + (i / Math.max(1, rows.length - 1)) * SPREAD }); });
    }
    items.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = Math.round(lead + o.d) + 'ms'; });
    void plot.offsetWidth;
    items.forEach(function (o) { o.el.classList.add('entering'); });
    clearTimeout(statsEntranceT);
    statsEntranceT = setTimeout(function () {
      items.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = ''; });
    }, lead + SPREAD + 560);
  }

  var collagePlaced = [];
  var collageHovered = null;
  function maskHitTest(clientX, clientY) {
    var box = collage.getBoundingClientRect();
    var px = clientX - box.left, py = clientY - box.top;
    for (var i = collagePlaced.length - 1; i >= 0; i--) {
      var t = collagePlaced[i];
      if (px < t.x || py < t.y || px > t.x + t.fullW || py > t.y + t.fullH) continue;
      var mx = ((px - t.x) / t.fullW * t.mask.w) | 0;
      var my = ((py - t.y) / t.fullH * t.mask.h) | 0;
      if (!t.mask._set) {
        var set = {};
        var cells = t.mask.cells;
        for (var c = 0; c < cells.length; c++) set[cells[c][0] + '|' + cells[c][1]] = 1;
        t.mask._set = set;
      }
      if (t.mask._set[mx + '|' + my]) return t;
    }
    return null;
  }
  collage.addEventListener('mousemove', function (ev) {
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (hit === collageHovered) return;
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = hit;
    if (hit && hit.el) hit.el.classList.add('is-hover');
    collage.style.cursor = hit ? 'pointer' : 'default';
    var tip = document.getElementById('collageTip');
    if (tip) {
      if (hit) {
        var s = hit.data;
        var n = +s.n || 0;
        var noun = (n === 1) ? 'call' : 'calls';
        tip.innerHTML = '<span class="ct-name">' + (s.com || s.sci) + '</span>'
          + '<span class="ct-w"> - </span>'
          + '<span class="ct-n">' + fmtN(n) + '</span>'
          + '<span class="ct-w"> ' + noun + ' ' + windowLabel(currentHours) + '</span>';
        tip.setAttribute('aria-hidden', 'false');
      } else {
        tip.setAttribute('aria-hidden', 'true');
      }
    }
  });
  collage.addEventListener('mouseleave', function () {
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = null;
    var tip = document.getElementById('collageTip');
    if (tip) tip.setAttribute('aria-hidden', 'true');
  });
  collage.addEventListener('click', function (ev) {
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (!hit) return;
    location.hash = '#sci=' + encodeURIComponent(hit.data.sci);
    go(2);
  });

  window.__layout = function (opts) {
    opts = opts || {};
    var allSlugs = Object.keys(DIMS);
    var slugs = opts.slugs || allSlugs.slice(0, opts.n || 12);
    var weights = opts.weights;
    var items = slugs.map(function (slug, i) {
      var parts = slug.split('-');
      var sci = parts.slice(0, 2).map(function (p, j) { return j === 0 ? p[0].toUpperCase() + p.slice(1) : p; }).join(' ');
      var n;
      if (weights === 'uniform') n = 10;
      else if (weights === 'extreme') n = i === 0 ? 500 : 1;
      else if (Array.isArray(weights)) n = weights[i] || 1;
      else n = Math.pow(0.55, i) * 100;
      return { sci: sci, com: sci, n: n };
    });
    renderCollage(items);
    return { rendered: items.length, mode: weights || 'hierarchy' };
  };

  function renderCollageFromData(animate) {
    var items = (DATA.recent && DATA.recent.species) || [];
    renderCollage(items, animate);
  }
  var rTimer;
  window.addEventListener('resize', function () {
    clearTimeout(rTimer);
    rTimer = setTimeout(function () {
      renderCollageFromData();
      drawHistograms();
    }, 120);
  });

  // ---- Stats / Atlas data ----
  function setRow(id, label, val) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span>' + label + '</span><span>' + (val == null || val === '' ? '-' : val) + '</span>';
  }
  function liRow(yr, label, ct, sci) {
    var attr = sci ? ' data-sci="' + sci.replace(/"/g, '&quot;') + '"' : '';
    return '<li' + attr + '><span class="yr">' + yr + '</span><span>' + label + '</span><span class="ct">' + (ct == null ? '-' : ct) + '</span></li>';
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtN(n) {
    if (n == null) return '-';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }
  function windowLabel(h) {
    if (h <= 1) return 'this hour';
    if (h <= 12) return 'past 12h';
    if (h <= 24) return 'today';
    if (h <= 168) return 'this week';
    return 'all time';
  }

  // ---- Data layer: fetches from birdnet-go ----
  var STATS_DAYS = 30;
  var DATA = {
    stats: null,
    lifelist: null,
    timeseries: null,
    firstseen: null,
    recent: null,
  };

  var STATS = {
    detPerDay:  new Array(STATS_DAYS).fill(0),
    specPerDay: new Array(STATS_DAYS).fill(0),
    byHour:     new Array(24).fill(0),
  };

  var speciesTotals = {};

  function fetchJson(url) {
    var opts = { cache: 'no-store' };
    if (__token) {
      opts.headers = { 'Authorization': 'Bearer ' + __token };
    }
    return fetch(url, opts)
      .then(function (r) {
        if (r.status === 401) {
          clearToken();
          showLocked();
          return Promise.reject(401);
        }
        return r.ok ? r.json() : Promise.reject(r.status);
      });
  }

  function backfillDaily(daily, days) {
    var byDate = {};
    (daily || []).forEach(function (row) { byDate[row.date] = row; });
    var out = new Array(days).fill(null).map(function () { return { detections: 0, species: 0 }; });
    var today = new Date();
    for (var i = 0; i < days; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
    var key = fmtDate(d);
    if (byDate[key]) {
        out[i].detections = +byDate[key].detections || 0;
        out[i].species    = +byDate[key].species    || 0;
      }
    }
    return out;
  }

  function recomputeDerived() {
    var ts = DATA.timeseries || { daily: [], by_hour: [] };
    var ll = DATA.lifelist || { species: [] };
    var rows = backfillDaily(ts.daily, STATS_DAYS);
    STATS.detPerDay  = rows.map(function (r) { return r.detections; });
    STATS.specPerDay = rows.map(function (r) { return r.species; });
    var byHour = new Array(24).fill(0);
    (ts.by_hour || []).forEach(function (r) { byHour[+r.hour] = +r.detections; });
    STATS.byHour = byHour;
    speciesTotals = {};
    (ll.species || []).forEach(function (s) { speciesTotals[s.sci] = +s.n; });
  }

  function drawHistograms(animate) {
    var tl = document.getElementById('statsTimeline');
    if (!tl) return;
    var all = ((DATA.recent && DATA.recent.species) || []).slice();
    if (!all.length) {
      tl.innerHTML = '<div class="stats-tl-empty">no detections in this window</div>';
      return;
    }

    var isMobile = (window.innerWidth || 800) <= 700;
    var containerW = Math.max(140, (tl.clientWidth || window.innerWidth || 800) - 34);
    var MIN_COL = isMobile ? 52 : 22;
    var cap = isMobile ? all.length : Math.max(3, Math.floor(containerW / MIN_COL));
    var trimmed = all.length > cap;
    var species = all.slice();
    if (trimmed) {
      species.sort(function (a, b) { return (+b.n || 0) - (+a.n || 0); });
      species = species.slice(0, cap);
    }
    function parseTs(s) { return s ? Date.parse(s.replace(' ', 'T')) : NaN; }
    species.sort(function (a, b) {
      var ta = parseTs(a.last_seen), tb = parseTs(b.last_seen);
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return ta - tb;
    });

    var C = species.length;
    var maxN = species.reduce(function (m, s) { return Math.max(m, +s.n || 0); }, 1);
    var colW = isMobile ? MIN_COL : (containerW / C);
    var plotW = isMobile ? Math.max(containerW, C * colW) : containerW;
    var sq = Math.max(6, Math.min(colW, isMobile ? 60 : 48));
    var LABEL_GAP = 6;
    var SPAN = 0.55;

    var ticks = [];
    if (maxN <= 8) {
      for (var v = 0; v <= maxN; v++) ticks.push(v);
    } else {
      var divs = 4;
      for (var di = 0; di <= divs; di++) ticks.push(Math.round(maxN * di / divs));
      ticks[ticks.length - 1] = maxN;
    }
    var yaxis = ticks.map(function (v) {
      return '<span class="stats-tl-ytick" style="bottom:' + ((v / maxN) * SPAN * 100).toFixed(1) + '%">' + v + '</span>';
    }).join('');

    function fmtTs(ms) {
      if (isNaN(ms)) return '';
      var d = new Date(ms);
      var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      if (currentHours <= 36) return p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (currentHours <= 75 * 24) return (d.getMonth() + 1) + '/' + d.getDate();
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    var gridlines = '';
    for (var gi = 1; gi <= C; gi++) {
      gridlines += '<i class="stats-tl-gridline" style="left:' + (gi / C * 100).toFixed(3) + '%"></i>';
    }

    var cols = '', xaxis = '';
    species.forEach(function (s, i) {
      var centerPct = (i + 0.5) / C * 100;
      var n = +s.n || 0;
      var bottomPct = (n / maxN) * SPAN * 100;
      cols += ''
        + '<div class="stats-tl-col" data-sci="' + s.sci + '" style="left:' + centerPct.toFixed(3) + '%;width:' + colW.toFixed(2) + 'px">'
        +   '<div class="stats-tl-square" style="bottom:' + bottomPct.toFixed(1) + '%;width:' + sq.toFixed(1) + 'px;height:' + sq.toFixed(1) + 'px"></div>'
        +   '<div class="stats-tl-label" style="bottom:calc(' + bottomPct.toFixed(1) + '% + ' + (sq + LABEL_GAP) + 'px)"><span class="com">' + (s.com || s.sci) + '</span><span class="sci">' + s.sci + '</span></div>'
        + '</div>';
      var lab = fmtTs(parseTs(s.last_seen));
      if (lab) xaxis += '<span class="stats-tl-xtick" style="left:' + centerPct.toFixed(3) + '%">' + lab + '</span>';
    });

    var note = trimmed
      ? '<div class="stats-tl-cap">' + C + ' most-heard of ' + all.length + '</div>'
      : '';
    tl.innerHTML =
      '<div class="stats-tl-yaxis">' + yaxis + '</div>'
      + '<div class="stats-tl-plot"' + (isMobile ? ' style="width:' + Math.round(plotW) + 'px"' : '') + '>'
      +   gridlines + cols + xaxis
      + '</div>'
      + note;
    if (animate) playStatsEntrance();
  }

  (function wireStatsHighlight() {
    var v1 = document.getElementById('v1');
    if (!v1) return;
    function setHi(sci, on) {
      if (!sci) return;
      var esc = sci.replace(/"/g, '\"');
      v1.querySelectorAll('.stats-tl-col[data-sci="' + esc + '"], .stats-side li[data-sci="' + esc + '"]')
        .forEach(function (el) { el.classList.toggle('sync-hi', on); });
    }
    v1.addEventListener('mouseover', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) setHi(el.getAttribute('data-sci'), true);
    });
    v1.addEventListener('mouseout', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) {
        var to = ev.relatedTarget;
        if (to && el.contains(to)) return;
        setHi(el.getAttribute('data-sci'), false);
      }
    });
  })();

  function renderStatsLists() {
    var stats = DATA.stats || {};
    var recent = DATA.recent || { species: [] };
    var firstseen = DATA.firstseen || { species: [] };

    var last_hour = (stats.last_hour && stats.last_hour.detections) || 0;
    var today_det = (stats.today && stats.today.detections) || 0;
    var week_det = (stats.week && stats.week.detections) || 0;
    var all_det = (stats.totals && stats.totals.detections) || 0;
    document.getElementById('statsByPeriod').innerHTML =
        liRow('NOW',   'last hour',   fmtN(last_hour))
      + liRow('TODAY', 'today',       fmtN(today_det))
      + liRow('WEEK',  'last 7 days', fmtN(week_det))
      + liRow('ALL',   'all time',    fmtN(all_det));

    var ranked = (recent.species || [])
      .slice()
      .sort(function (a, b) { return (+b.n) - (+a.n); })
      .slice(0, 5);
    document.getElementById('statsTopSpec').innerHTML = ranked.length
      ? ranked.map(function (s, i) { return liRow(pad(i + 1), s.com, fmtN(+s.n), s.sci); }).join('')
      : liRow('-', 'no detections in window', '');
    document.getElementById('statsTopSpecCap').textContent =
      'most-heard, ' + windowLabel(currentHours);

    var fs = (firstseen.species || []).slice(0, 5);
    var now = Date.now();
    document.getElementById('statsFirstSeen').innerHTML = fs.length
      ? fs.map(function (s) {
          var t = Date.parse((s.first_seen || '').replace(' ', 'T'));
          var label = '-';
          if (!isNaN(t)) {
            var daysAgo = Math.floor((now - t) / 86400000);
            label = daysAgo === 0 ? 'today' : daysAgo + 'd ago';
          }
          return liRow(label, s.com, '', s.sci);
        }).join('')
      : liRow('-', 'no detections yet', '');
  }

  (function wireStatsTabs() {
    var tabs = document.getElementById('statsTabs');
    var grid = document.getElementById('statsGrid');
    var heatmap = document.getElementById('statsHeatmap');
    if (!tabs || !grid || !heatmap) return;
    var active = tabs.querySelector('button[aria-current="true"]');
    if (active && active.getAttribute('data-stats-tab') === 'heatmap') {
      grid.style.display = 'none';
      heatmap.style.display = 'block';
    } else {
      heatmap.style.display = 'none';
    }
    tabs.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var tab = b.getAttribute('data-stats-tab');
      tabs.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-current', x === b ? 'true' : 'false');
      });
      if (tab === 'heatmap') {
        grid.style.display = 'none';
        heatmap.style.display = 'block';
      } else {
        grid.style.display = '';
        heatmap.style.display = 'none';
      }
    });
  })();

  var __heatmapDate = todayStr();
  function fetchHeatmapData(date) {
    return bngFetch('/api/v2/detections?date=' + date)
      .then(function (first) {
        var total = first.total || 0;
        var limit = first.limit || 100;
        var pages = [first];
        if (total > limit) {
          var offsets = [];
          for (var o = limit; o < total; o += limit) offsets.push(o);
          return Promise.all(offsets.map(function (o) {
            return bngFetch('/api/v2/detections?date=' + date + '&offset=' + o)
              .catch(function () { return { data: [] }; });
          })).then(function (more) { return pages.concat(more); });
        }
        return pages;
      })
      .then(function (allPages) {
        var bySci = {};
        allPages.forEach(function (p) {
          (p.data || []).forEach(function (d) {
            var sci = d.scientificName;
            if (!sci) return;
            if (!bySci[sci]) bySci[sci] = { sci: sci, com: d.commonName || sci, hours: new Array(24).fill(0) };
            var hr = parseInt(d.time, 10);
            if (!isNaN(hr) && hr >= 0 && hr < 24) bySci[sci].hours[hr]++;
          });
        });
        var list = Object.keys(bySci).map(function (k) { return bySci[k]; });
        list.sort(function (a, b) {
          var ta = a.hours.reduce(function (s, c) { return s + c; }, 0);
          var tb = b.hours.reduce(function (s, c) { return s + c; }, 0);
          return tb - ta;
        });
        return list;
      })
      .then(function (species) {
        DATA.heatmap = species;
        return bngFetch('/api/v2/weather/hourly/' + date).then(function (res) {
          var byHour = {};
          (res.data || []).forEach(function (w) {
            var hr = parseInt(w.time, 10);
            if (!isNaN(hr) && hr >= 0 && hr < 24) {
              var sfx = (w.weather_desc || '').indexOf('_night') !== -1 ? 'n' : 'd';
              byHour[hr] = { icon: w.weather_icon + sfx, desc: w.weather_desc };
            }
          });
          DATA.weather = byHour;
          renderHourHeatmap();
        });
      })
      .catch(function () { DATA.heatmap = []; DATA.weather = {}; renderHourHeatmap(); });
  }

  function renderHourHeatmap() {
    var wrap = document.getElementById('heatmapWrap');
    if (!wrap) return;
    var hm = DATA.heatmap;
    if (!hm || !hm.length) {
      wrap.innerHTML = '<div class="heatmap-empty">no detections today</div>';
      return;
    }
    var maxCount = 0;
    hm.forEach(function (s) {
      s.hours.forEach(function (c) { if (c > maxCount) maxCount = c; });
    });
    maxCount = Math.max(maxCount, 1);
    var weather = DATA.weather || {};
    var today = todayStr();
    var isFuture = __heatmapDate >= today;
    var html = '<table class="heatmap-table"><thead>';
    html += '<tr class="heatmap-weather"><th><div class="heatmap-datepicker">'
      + '<button class="heatmap-prev" aria-label="previous day">←</button>'
      + '<span class="heatmap-date">' + __heatmapDate + '</span>'
      + '<button class="heatmap-next" aria-label="next day"' + (isFuture ? ' disabled' : '') + '>→</button>'
      + '</div></th>';
    for (var h = 0; h < 24; h++) {
      var w = weather[h];
      if (w) {
        html += '<th><img class="weather-icon" src="assets/weather/' + w.icon + '@2x.png" alt="' + w.desc + '" title="' + w.desc + '"></th>';
      } else {
        html += '<th></th>';
      }
    }
    html += '</tr><tr><th></th>';
    for (var h = 0; h < 24; h++) {
      html += '<th>' + h + '</th>';
    }
    html += '</tr></thead><tbody>';
    hm.forEach(function (s) {
      html += '<tr class="heatmap-row" data-sci="' + s.sci.replace(/"/g, '&quot;') + '">'
        + '<td class="heatmap-name">'
        + '<span class="com">' + s.com + '</span>'
        + '<span class="sci">' + s.sci + '</span>'
        + '</td>';
      s.hours.forEach(function (c) {
        var pct = c / maxCount;
        var bg = '';
        var txt = '';
        if (c > 0) {
          var a = 0.08 + pct * 0.6;
          bg = 'rgba(74,63,49,' + a.toFixed(3) + ')';
          txt = c;
        }
        html += '<td style="background:' + bg + '">' + txt + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  (function wireHeatmapDatepicker() {
    var wrap = document.getElementById('heatmapWrap');
    if (!wrap) return;
    var input = document.createElement('input');
    input.type = 'date';
    input.style.display = 'none';
    input.max = todayStr();
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      if (input.value) {
        __heatmapDate = input.value;
        fetchHeatmapData(__heatmapDate);
      }
    });
    function heatmapDateShift(offset) {
      var p = __heatmapDate.split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      d.setDate(d.getDate() + offset);
      return fmtDate(d);
    }
    wrap.addEventListener('click', function (ev) {
      var prev = ev.target.closest('.heatmap-prev');
      if (prev) {
        __heatmapDate = heatmapDateShift(-1);
        fetchHeatmapData(__heatmapDate);
        return;
      }
      var next = ev.target.closest('.heatmap-next');
      if (next) {
        var nd = heatmapDateShift(1);
        if (nd > todayStr()) return;
        __heatmapDate = nd;
        fetchHeatmapData(__heatmapDate);
        return;
      }
      var label = ev.target.closest('.heatmap-date');
      if (label) {
        input.value = __heatmapDate;
        if (input.showPicker) input.showPicker(); else input.click();
      }
    });
  })();

  // ---- Atlas ----
  function wikiUrl(sci) {
    return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(sci.replace(/ /g, '_'));
  }
  function ebirdUrl(sci) {
    var code = EBIRD_CODES[sci];
    return code ? 'https://ebird.org/species/' + code : 'https://ebird.org/explore';
  }
  function aabUrl(com) {
    return 'https://www.allaboutbirds.org/guide/' + com.replace(/'/g, '').replace(/ /g, '_') + '/';
  }

  var ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 2 L10 6 L3 10 Z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="2.5" height="8"/><rect x="6.5" y="2" width="2.5" height="8"/></svg>';

  function renderAtlas(animate) {
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;

    var lifelist = (DATA.lifelist && DATA.lifelist.species) || [];
    var recent = (DATA.recent && DATA.recent.species) || [];
    var winBySci = {};
    recent.forEach(function (s) { winBySci[s.sci] = +s.n; });

    if (!lifelist.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No birds detected yet.</p>' +
        '<p class="hint">The atlas fills up as new species are identified.</p>' +
        '</div>';
      return;
    }

    var isAllWindow = currentHours >= 1000000;
    var filtered = isAllWindow
      ? lifelist
      : lifelist.filter(function (s) { return (winBySci[s.sci] || 0) > 0; });
    if (!filtered.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No detections in this window.</p>' +
        '<p class="hint">Try a longer time window - the lifelist is still here under ALL.</p>' +
        '</div>';
      return;
    }

    var sortMode = (window.__atlasSort) || 'count';
    var species = filtered.slice();
    if (sortMode === 'count') {
      species.sort(function (a, b) { return (+b.n) - (+a.n); });
    } else if (sortMode === 'recent') {
      species.sort(function (a, b) {
        return (b.last_seen || '').localeCompare(a.last_seen || '');
      });
    } else if (sortMode === 'alpha') {
      species.sort(function (a, b) {
        return (a.com || a.sci || '').localeCompare(b.com || b.sci || '');
      });
    }

    var now = Date.now();
    var windowStartMs = now - currentHours * 3600000;
    grid.innerHTML = species.map(function (s) {
      var total = +s.n || 0;
      var win = winBySci[s.sci] || 0;
      var firstMs = Date.parse((s.first_seen || '').replace(' ', 'T'));
      var isLifer = !isAllWindow && !isNaN(firstMs) && firstMs >= windowStartMs;
      var slug = slugify(s.sci);
      var sketchSrc = './assets/illustrations/' + slug + '.png';
      var sketchFallback = './assets/cutouts/' + slug + '.png';
      var statRows = currentHours >= 1000000
        ? '<div><span class="n">' + fmtN(total) + '</span><span class="lbl-inline">all time</span></div>'
        : '<div><span class="n">' + fmtN(win) + '</span><span class="lbl-inline">' + windowLabel(currentHours) + '</span></div>'
          + '<div><span class="n">' + fmtN(total) + '</span><span class="lbl-inline">all time</span></div>';
      return ''
        + '<article class="bird-card" data-sci="' + s.sci + '">'
        +   (isLifer ? '<span class="new-badge" title="new to the life list in this window">new</span>' : '')
        +   '<div class="stat">' + statRows + '</div>'
        +   '<div class="img-wrap">'
        +     '<img loading="lazy" decoding="async" src="' + sketchSrc + '" alt="' + s.com + '"'
        +       ' onerror="this.onerror=null;this.src=\'' + sketchFallback + '\'">'
        +   '</div>'
        +   '<h3>' + s.com + '</h3>'
        +   '<div class="sci">' + s.sci + '</div>'
        +   '<div class="spectro-wrap" aria-hidden="true"></div>'
        +   '<div class="actions">'
        +     '<button type="button" class="chip play" data-action="play" aria-label="play recording">'
        +       ICON_PLAY + '<span>play</span>'
        +     '</button>'
        +     '<a class="chip ext" href="' + wikiUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="Wikipedia">wiki</a>'
        +     '<a class="chip ext" href="' + ebirdUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="eBird">ebird</a>'
        +     '<a class="chip ext" href="' + aabUrl(s.com) + '" target="_blank" rel="noopener" aria-label="All About Birds">aab</a>'
        +   '</div>'
        + '</article>';
    }).join('');

    // Audio playback
    var currentAudio = null;
    var currentBtn = null;
    function setBtnState(btn, state) {
      btn.setAttribute('data-state', state);
      if (state === 'playing') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PAUSE + '<span>stop</span>';
      } else if (state === 'loading') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PLAY + '<span>...</span>';
      } else if (state === 'missing') {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>no audio</span>';
        setTimeout(function () {
          if (btn.getAttribute('data-state') === 'missing') {
            btn.innerHTML = ICON_PLAY + '<span>play</span>';
            btn.setAttribute('data-state', 'idle');
          }
        }, 2200);
      } else {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>play</span>';
      }
    }
    function clearProgressOn(card) {
      if (!card) return;
      var sw = card.querySelector('.spectro-wrap');
      if (sw) sw.style.setProperty('--prog', '0%');
      card.removeAttribute('data-playing');
    }
    function stopCurrent() {
      audioRelease(stopCurrent);
      if (currentAudio) {
        try { currentAudio.pause(); } catch (e) {}
        currentAudio = null;
      }
      if (currentBtn) {
        var card = currentBtn.closest('.bird-card');
        clearProgressOn(card);
        setBtnState(currentBtn, 'idle');
        currentBtn = null;
      }
    }
    grid.querySelectorAll('[data-action="play"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.bird-card');
        if (btn === currentBtn) { stopCurrent(); return; }
        stopCurrent();
        audioClaim(stopCurrent);
        setBtnState(btn, 'loading');
        currentBtn = btn;

        var spectroWrap = card.querySelector('.spectro-wrap');
        if (spectroWrap && !spectroWrap.firstChild) {
          var canvas = document.createElement('canvas');
          spectroWrap.appendChild(canvas);
          var sci = card.getAttribute('data-sci');
          resolveAudioUrl(sci, function (aurl) {
            if (!aurl) { setBtnState(btn, 'missing'); return; }
            if (_decodedCache[aurl]) {
              paintSpectrogram(canvas, _decodedCache[aurl]);
            } else {
              var actx = getSpecCtx();
              if (actx) {
                fetch(aurl)
                  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                  .then(function (b) { return actx.decodeAudioData(b); })
                  .then(function (buf) {
                    _decodedCache[aurl] = buf;
                    if (document.contains(canvas)) paintSpectrogram(canvas, buf);
                  })
                  .catch(function () { if (spectroWrap.contains(canvas)) spectroWrap.removeChild(canvas); });
              } else {
                spectroWrap.removeChild(canvas);
              }
            }
          });
        }

        var sci = card.getAttribute('data-sci');
        resolveAudioUrl(sci, function (aurl) {
          if (!aurl) { setBtnState(btn, 'missing'); return; }
          var audio = new Audio(aurl);
          audio.addEventListener('canplay', function () {
            if (currentBtn !== btn) return;
            setBtnState(btn, 'playing');
            card.setAttribute('data-playing', 'true');
            audio.play();
          });
          audio.addEventListener('timeupdate', function () {
            if (currentBtn !== btn) return;
            var pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
            if (spectroWrap) spectroWrap.style.setProperty('--prog', pct.toFixed(1) + '%');
          });
          audio.addEventListener('ended', function () {
            if (currentBtn === btn) stopCurrent();
          });
          audio.addEventListener('error', function () {
            if (currentBtn === btn) {
              setBtnState(btn, 'missing');
              clearProgressOn(card);
              currentAudio = null; currentBtn = null;
            }
          });
          currentAudio = audio;
          audio.load();
        });
      });
    });

    grid.addEventListener('click', function (ev) {
      var sw = ev.target.closest && ev.target.closest('.spectro-wrap');
      if (!sw || !sw.firstChild) return;
      var card = sw.closest('.bird-card');
      var btn = card.querySelector('[data-action="play"]');
      if (currentBtn === btn && currentAudio && currentAudio.duration) {
        var rect = sw.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        currentAudio.currentTime = pct * currentAudio.duration;
      } else {
        btn.click();
      }
    });
    if (animate) playAtlasEntrance();
  }

  function renderWindowDependent(animate) {
    renderCollageFromData(animate);
    renderStatsLists();
    drawHistograms(animate);
    renderAtlas(animate);
    renderHourHeatmap();
  }
  function renderTimeIndependent(animate) {
    renderStatsLists();
    drawHistograms(animate);
    renderAtlas(animate);
    renderHourHeatmap();
  }

  function refreshRecent(animate) {
    var forHours = currentHours;
    if (forHours >= 1000000) {
      return bngFetch('/api/v2/analytics/species/summary')
        .then(function (data) {
          if (forHours !== currentHours) return;
          DATA.recent = { hours: forHours, species: data.map(toAVSpecies) };
          renderWindowDependent(animate);
        })
        .catch(function (e) { console.warn('recent fetch failed', e); });
    }
    var range = dateRangeForHours(forHours);
    return bngFetch('/api/v2/analytics/species/summary?start_date=' + range.start_date + '&end_date=' + range.end_date)
      .then(function (data) {
        if (forHours !== currentHours) return;
        DATA.recent = { hours: forHours, species: data.map(toAVSpecies) };
        renderWindowDependent(animate);
      })
      .catch(function (e) { console.warn('recent fetch failed', e); });
  }

  function refreshAll(animate) {
    var forHours = currentHours;

    return Promise.all([
      // stats: KPIs + daily counts for today and week
      Promise.all([
        bngFetch('/api/v2/dashboard/kpis').catch(function () { return null; }),
        bngFetch('/api/v2/analytics/time/daily?start_date=' + todayStr() + '&end_date=' + todayStr()).catch(function () { return null; }),
        bngFetch('/api/v2/analytics/time/daily?start_date=' + weekAgoStr() + '&end_date=' + todayStr()).catch(function () { return null; }),
        // last_hour: use the detections endpoint with the current hour
        bngFetch('/api/v2/detections?date=' + todayStr() + '&hour=' + (new Date().getHours()) + '&limit=1').catch(function () { return null; }),
      ]).then(function (parts) {
        var kpis = parts[0], dailyToday = parts[1], dailyWeek = parts[2], lastHourResp = parts[3];
        return {
          totals: {
            detections: 0,
            species: kpis ? kpis.lifetime_species : 0,
          },
          today: {
            detections: kpis ? kpis.today_detections : 0,
            species: dailyToday && dailyToday.data ? dailyToday.data.length : 0,
          },
          week: {
            detections: dailyWeek && dailyWeek.data ? sum(dailyWeek.data, 'count') : 0,
            species: dailyWeek && dailyWeek.data ? dailyWeek.data.filter(function (d) { return d.count > 0; }).length : 0,
          },
          last_hour: {
            detections: lastHourResp ? (lastHourResp.total || 0) : 0,
          },
          started: null,
          as_of: new Date().toISOString(),
        };
      }).catch(function () { return null; }),

      // lifelist: species summary
      bngFetch('/api/v2/analytics/species/summary')
        .then(function (data) {
          return { species: data.map(toAVSpecies), as_of: new Date().toISOString() };
        })
        .catch(function () { return null; }),

      // timeseries: daily analytics for 30 days + hourly distribution
      Promise.all([
        bngFetch('/api/v2/analytics/time/daily?start_date=' + monthAgoStr() + '&end_date=' + todayStr()).catch(function () { return null; }),
        bngFetch('/api/v2/analytics/time/distribution/hourly').catch(function () { return null; }),
      ]).then(function (parts) {
        var dailyData = parts[0], hourlyData = parts[1];
        return {
          days: 30,
          daily: (dailyData && dailyData.data) || [],
          by_hour: hourlyData || [],
          as_of: new Date().toISOString(),
        };
      }).catch(function () { return null; }),

      // firstseen: new species
      bngFetch('/api/v2/analytics/species/detections/new?limit=10')
        .then(function (data) {
          return {
            species: (data || []).map(function (s) {
              return { sci: s.scientific_name, com: s.common_name, first_seen: s.first_heard_date, total: s.count_in_period };
            }),
            as_of: new Date().toISOString(),
          };
        })
        .catch(function () { return null; }),

      // recent: species in window
      (function () {
        if (forHours >= 1000000) {
          return bngFetch('/api/v2/analytics/species/summary')
            .then(function (data) { return { hours: forHours, species: data.map(toAVSpecies) }; })
            .catch(function () { return null; });
        }
        var range = dateRangeForHours(forHours);
        return bngFetch('/api/v2/analytics/species/summary?start_date=' + range.start_date + '&end_date=' + range.end_date)
          .then(function (data) { return { hours: forHours, species: data.map(toAVSpecies) }; })
          .catch(function () { return null; });
      })(),

      // heatmap: detections today grouped by species and hour
      (function () {
        var today = todayStr();
        var heatmapEl = document.getElementById('statsHeatmap');
        if (heatmapEl && heatmapEl.style.display !== 'none' && __heatmapDate !== today) {
          return Promise.resolve(DATA.heatmap || []);
        }
        return bngFetch('/api/v2/detections?date=' + today)
          .then(function (first) {
            var total = first.total || 0;
            var limit = first.limit || 100;
            var pages = [];
            pages.push(first);
            if (total > limit) {
              var offsets = [];
              for (var o = limit; o < total; o += limit) offsets.push(o);
              return Promise.all(offsets.map(function (o) {
                return bngFetch('/api/v2/detections?date=' + today + '&offset=' + o)
                  .catch(function () { return { data: [] }; });
              })).then(function (more) {
                return pages.concat(more);
              });
            }
            return pages;
          })
          .then(function (allPages) {
            var bySci = {};
            allPages.forEach(function (p) {
              (p.data || []).forEach(function (d) {
                var sci = d.scientificName;
                if (!sci) return;
                if (!bySci[sci]) bySci[sci] = { sci: sci, com: d.commonName || sci, hours: new Array(24).fill(0) };
                var hr = parseInt(d.time, 10);
                if (!isNaN(hr) && hr >= 0 && hr < 24) bySci[sci].hours[hr]++;
              });
            });
            var list = Object.keys(bySci).map(function (k) { return bySci[k]; });
            list.sort(function (a, b) {
              var ta = a.hours.reduce(function (s, c) { return s + c; }, 0);
              var tb = b.hours.reduce(function (s, c) { return s + c; }, 0);
              return tb - ta;
            });
            return list;
          });
      })(),

      // weather: hourly icons for today
      (function () {
        var today = todayStr();
        var heatmapEl = document.getElementById('statsHeatmap');
        if (heatmapEl && heatmapEl.style.display !== 'none' && __heatmapDate !== today) {
          return Promise.resolve(DATA.weather || {});
        }
        return bngFetch('/api/v2/weather/hourly/' + today)
          .then(function (res) {
            var byHour = {};
            (res.data || []).forEach(function (w) {
              var hr = parseInt(w.time, 10);
              if (!isNaN(hr) && hr >= 0 && hr < 24) {
                var sfx = (w.weather_desc || '').indexOf('_night') !== -1 ? 'n' : 'd';
                byHour[hr] = { icon: w.weather_icon + sfx, desc: w.weather_desc };
              }
            });
            return byHour;
          })
          .catch(function () { return {}; });
      })(),
    ]).then(function (parts) {
      DATA.stats = parts[0];
      DATA.lifelist = parts[1];
      DATA.timeseries = parts[2];
      DATA.firstseen = parts[3];
      if (forHours === currentHours && parts[4]) DATA.recent = parts[4];
      DATA.heatmap = parts[5];
      DATA.weather = parts[6];
      // Compute total detections from lifelist counts
      if (DATA.stats && DATA.lifelist && DATA.lifelist.species) {
        DATA.stats.totals.detections = DATA.lifelist.species.reduce(function (sum, s) { return sum + (+s.n || 0); }, 0);
      }
      recomputeDerived();
      renderTimeIndependent(animate);
      renderCollageFromData(animate);
    });
  }

  // ---- Menu elements ----
  var dd = document.getElementById('menu-dd');
  var menuBtn = document.getElementById('menuBtn');
  var locked  = document.getElementById('dd-locked');
  var items   = document.getElementById('dd-items');

  // ---- JWT auth: show/hide locked state ----
  var lockHint = document.getElementById('lockHint');
  var unlockForm = document.getElementById('unlockForm');
  var lockPass = document.getElementById('lockPass');

  function showLocked() {
    stopPolling();
    locked.style.display = 'block';
    items.style.display = 'none';
    if (lockHint) lockHint.textContent = 'enter password to unlock tools.';
  }
  function showUnlocked() {
    locked.style.display = 'none';
    items.style.display = 'block';
  }

  function unlockWithToken(token) {
    storeToken(token);
    showUnlocked();
    refreshAll(true);
    startPolling();
  }

  if (unlockForm) {
    unlockForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pwd = lockPass ? lockPass.value : '';
      if (!pwd) return;
      if (lockHint) lockHint.textContent = 'checking...';
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      }).then(function (r) {
        if (!r.ok) {
          if (lockHint) lockHint.textContent = 'wrong password';
          return Promise.reject(r.status);
        }
        return r.json();
      }).then(function (data) {
        if (data && data.token) {
          lockPass.value = '';
          unlockWithToken(data.token);
        }
      }).catch(function () {
        if (lockHint) lockHint.textContent = 'wrong password';
      });
    });
  }

  // ---- Init ----
  loadCollageData(function () {
    refreshAll(true).then(function () {
      startPolling();
    }, function () {
      if (!isUnlocked()) showLocked();
    });
  });

  winBtns.forEach(function (b) {
    b.addEventListener('click', function () { refreshRecent(true); });
  });

  var POLL_MS = 30 * 1000;
  var pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (isUnlocked()) refreshAll();
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
    } else {
      if (isUnlocked()) refreshAll();
      startPolling();
    }
  });

  // ---- Menu dropdown ----
  function openDd()  { dd.classList.add('open'); dd.setAttribute('aria-hidden','false'); }
  function closeDd() { dd.classList.remove('open'); dd.setAttribute('aria-hidden','true'); }
  function toggleDd(){ dd.classList.contains('open') ? closeDd() : openDd(); }
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleDd(); });
  document.addEventListener('click', function (e) { if (!dd.contains(e.target) && e.target !== menuBtn) closeDd(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDd(); });

  // Render drawer contents: theme toggle + links
  (function renderMenu() {
    var linkToBN = BN ? '<a class="ext" href="' + BN + '/ui/dashboard" target="_blank" rel="noopener"><span>BirdNET-Go UI</span></a>' : '';
    items.innerHTML =
      '<div class="menu-links">'
      + '<div class="menu-row">'
      + '  <div><span class="label">Theme</span><span class="hint">saved on this device</span></div>'
      + '  <div class="seg" data-theme-seg>'
      + '    <button type="button" data-theme="light"' + (currentTheme() === 'light' ? ' aria-current="true"' : '') + '>light</button>'
      + '    <button type="button" data-theme="dark"' + (currentTheme() === 'dark' ? ' aria-current="true"' : '') + '>dark</button>'
      + '  </div>'
      + '</div>'
      + linkToBN
      + '</div>';

    var themeSeg = items.querySelector('[data-theme-seg]');
    if (themeSeg) {
      themeSeg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-theme]');
        if (!b) return;
        applyTheme(b.getAttribute('data-theme'));
        [].forEach.call(themeSeg.querySelectorAll('button'), function (x) {
          x.setAttribute('aria-current', x === b ? 'true' : 'false');
        });
      });
    }
  })();

  // ---- Hash routing + atlas detail modal ----
  function readHash() {
    var m = location.hash.match(/^#sci=([^&]+)/);
    if (!m) return null;
    return decodeURIComponent(m[1]);
  }
  function highlightAtlas(sci) {
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;
    grid.querySelectorAll('.bird-card[data-active="true"]').forEach(function (c) {
      c.removeAttribute('data-active');
    });
    if (!sci) return;
    var attempts = 0;
    (function find() {
      var card = grid.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]');
      if (!card) {
        if (attempts++ < 10) return setTimeout(find, 80);
        return;
      }
      card.setAttribute('data-active', 'true');
      card.setAttribute('data-pulse', 'true');
      setTimeout(function () { card.removeAttribute('data-pulse'); }, 520);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })();
  }

  // ---- Detail modal ----
  var SPECIES_CACHE = {};
  var WIKI_CACHE = {};
  var modalAudio = null;
  var modalRecBtn = null;
  function fmtRecTime(d, t) {
    if (!d) return '-';
    var date = new Date((d || '') + 'T' + (t || '00:00:00'));
    if (isNaN(date.getTime())) return d + ' ' + (t || '');
    var now = Date.now();
    var ago = Math.floor((now - date.getTime()) / 1000);
    if (ago < 60) return ago + 's ago';
    if (ago < 3600) return Math.floor(ago / 60) + 'm ago';
    if (ago < 86400) return Math.floor(ago / 3600) + 'h ago';
    return Math.floor(ago / 86400) + 'd ago';
  }
  function fmtDateLine(d, t) {
    if (!d) return '';
    try {
      var date = new Date(d + 'T' + (t || '00:00:00'));
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' \u00b7 ' + (t ? t.slice(0, 5) : '');
    } catch (e) { return d + ' ' + (t || ''); }
  }
  function rarityLabel(total, firstSeenIso) {
    if (!total) return '-';
    var days = 1;
    if (firstSeenIso) {
      var t = Date.parse((firstSeenIso || '').replace(' ', 'T'));
      if (!isNaN(t)) days = Math.max(1, Math.ceil((Date.now() - t) / 86400000));
    }
    var perDay = total / days;
    if (perDay >= 5) return 'common';
    if (perDay >= 1) return 'regular';
    if (perDay >= 0.2) return 'occasional';
    return 'rare';
  }
  var modalCursorRaf = null;
  function startCursorLoop() {
    if (modalCursorRaf) return;
    var tick = function () {
      if (!modalAudio || !modalRecBtn) { modalCursorRaf = null; return; }
      var row = modalRecBtn.closest('.rec-row');
      if (row && modalAudio.duration) {
        var strip = row.querySelector('.rec-spectro');
        var played = strip && strip.querySelector('.rec-spectro-played');
        var cursor = strip && strip.querySelector('.rec-spectro-cursor');
        var pct = (modalAudio.currentTime / modalAudio.duration) * 100;
        if (played) played.style.width = pct.toFixed(3) + '%';
        if (cursor) cursor.style.left = pct.toFixed(3) + '%';
      }
      modalCursorRaf = requestAnimationFrame(tick);
    };
    modalCursorRaf = requestAnimationFrame(tick);
  }
  function stopCursorLoop() {
    if (modalCursorRaf) { cancelAnimationFrame(modalCursorRaf); modalCursorRaf = null; }
  }
  function pauseModalAudio() {
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) {} }
    if (modalRecBtn) {
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
    }
  }
  function stopModalAudio() {
    audioRelease(stopModalAudio);
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) {} modalAudio = null; }
    if (modalRecBtn) {
      var prevRow = modalRecBtn.closest('.rec-row');
      if (prevRow) {
        var strip = prevRow.querySelector('.rec-spectro');
        if (strip) {
          strip.classList.remove('armed');
          var played = strip.querySelector('.rec-spectro-played');
          var cur = strip.querySelector('.rec-spectro-cursor');
          if (played) played.style.width = '0%';
          if (cur) cur.style.left = '0%';
        }
      }
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
      modalRecBtn = null;
    }
  }

  function sketchSrc(sci, pose) {
    var slug = slugify(sci);
    var suffix = pose > 1 ? '-' + pose : '';
    return './assets/illustrations/' + slug + suffix + '.png';
  }

  function openDetailModal(sci) {
    if (!sci) return;
    var modal = document.getElementById('detail-modal');
    var img = document.getElementById('modalImg');
    var poseToggle = document.getElementById('modalPoseToggle');
    var poseBtns = [].slice.call(poseToggle.querySelectorAll('button'));

    poseToggle.removeAttribute('data-unavailable');
    poseBtns.forEach(function (b) {
      b.setAttribute('data-unavailable', 'true');
      b.setAttribute('aria-current', 'false');
    });
    var p1 = poseToggle.querySelector('button[data-pose="1"]');
    if (p1) {
      p1.removeAttribute('data-unavailable');
      p1.setAttribute('aria-current', 'true');
    }
    img.src = sketchSrc(sci, 1);
    img.alt = sci;

    var probes = poseBtns.map(function (b) {
      var pose = +b.dataset.pose;
      return fetch(sketchSrc(sci, pose), { method: 'HEAD', cache: 'no-store' })
        .then(function (r) { return { pose: pose, btn: b, ok: r.ok }; })
        .catch(function () { return { pose: pose, btn: b, ok: false }; });
    });
    Promise.all(probes).then(function (results) {
      var available = results.filter(function (r) { return r.ok; });
      available.forEach(function (r) { r.btn.removeAttribute('data-unavailable'); });
      results.filter(function (r) { return !r.ok; }).forEach(function (r) {
        r.btn.setAttribute('data-unavailable', 'true');
      });
      var pick = available.sort(function (a, b) { return b.pose - a.pose; })[0];
      if (pick) {
        poseBtns.forEach(function (b) {
          b.setAttribute('aria-current', b === pick.btn ? 'true' : 'false');
        });
        img.src = sketchSrc(sci, pick.pose);
      }
      if (available.length <= 1) {
        poseToggle.setAttribute('data-unavailable', 'true');
      }
      syncPill(poseToggle);
    });
    document.getElementById('modalSci').textContent = sci;
    document.getElementById('modalGenus').textContent = (sci.split(' ')[0] || '-');
    document.getElementById('modalCommon').textContent = '-';
    document.getElementById('modalAllTime').textContent = '-';
    document.getElementById('modalWindow').textContent = '-';
    var modalWinStat = document.getElementById('modalWindowStat');
    if (currentHours >= 1000000) {
      modalWinStat.style.display = 'none';
    } else {
      modalWinStat.style.display = '';
      document.getElementById('modalWindowLbl').textContent = windowLabel(currentHours);
    }
    document.getElementById('modalFirstSeen').textContent = '-';
    document.getElementById('modalRarity').textContent = '-';
    document.getElementById('modalRarity').classList.remove('rare');
    document.getElementById('modalDesc').textContent = 'Loading description...';
    document.getElementById('modalDesc').classList.add('placeholder');
    document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Loading recordings...</li>';
    document.getElementById('modalRecCount').textContent = '';
    document.getElementById('modalWiki').href = wikiUrl(sci);
    document.getElementById('modalEbird').href = ebirdUrl(sci);
    document.getElementById('modalAab').href = 'https://www.allaboutbirds.org/guide/';

    var sourceCard = atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    morphModalOpen(modal.querySelector('.modal-card'), sourceCard);

    // Species detail via birdnet-go summary + detections
    var loadSpecies = SPECIES_CACHE[sci]
      ? Promise.resolve(SPECIES_CACHE[sci])
      : bngFetch('/api/v2/detections?species=' + encodeURIComponent(sci) + '&limit=500&sortBy=date_desc')
          .then(function (res) {
            var speciesInfo = null;
            // Get summary from lifelist data
            var ll = (DATA.lifelist && DATA.lifelist.species) || [];
            speciesInfo = ll.filter(function (s) { return s.sci === sci; })[0] || null;
            return bngFetch('/api/v2/analytics/species/summary')
              .then(function (allSpecies) {
                var match = allSpecies.filter(function (s) { return s.scientific_name === sci; })[0];
                return { summary: match || null, detections: (res && res.data) || [] };
              })
              .catch(function () {
                return { summary: speciesInfo, detections: (res && res.data) || [] };
              });
          })
          .then(function (j) {
            SPECIES_CACHE[sci] = j;
            return j;
          })
          .catch(function () { return { summary: null, detections: [] }; });

    loadSpecies.then(function (j) {
      var s = j.summary || {};
      var sciName = s.scientific_name || sci;
      var comName = s.common_name || sci;
      document.getElementById('modalCommon').textContent = comName;
      document.getElementById('modalAab').href = aabUrl(comName);
      document.getElementById('modalAllTime').textContent = fmtN(+s.count || 0);
      var winRow = ((DATA.recent && DATA.recent.species) || []).filter(function (x) { return x.sci === sci; })[0];
      document.getElementById('modalWindow').textContent = fmtN(winRow ? +winRow.n : 0);
      document.getElementById('modalFirstSeen').textContent = s.first_heard ? fmtRecTime(s.first_heard.split(' ')[0], s.first_heard.split(' ')[1]) : '-';
      var rar = rarityLabel(+s.count || 0, s.first_heard);
      var rarEl = document.getElementById('modalRarity');
      rarEl.textContent = rar;
      if (rar === 'rare') rarEl.classList.add('rare');
      var dets = j.detections || [];
      if (dets.length > 1) {
        var bestIdx = 0;
        for (var i = 1; i < dets.length; i++) {
          if ((dets[i].confidence || 0) > (dets[bestIdx].confidence || 0)) bestIdx = i;
        }
        if (bestIdx > 0) {
          var best = dets.splice(bestIdx, 1)[0];
          dets.unshift(best);
        }
      }
      document.getElementById('modalRecCount').textContent = dets.length + ' captured';
      document.getElementById('modalRecordings').innerHTML = dets.length
        ? dets.map(function (d, i) {
            var detId = d.id || '';
            var bestLabel = i === 0 ? ' <span class="best-badge">best</span>' : '';
            return '<li class="rec-row' + (i === 0 ? ' is-best' : '') + '" data-file="' + detId + '" data-date="' + (d.date || '') + '">'
              + '<button class="play" type="button" aria-label="play">' + ICON_PLAY + '</button>'
              + '<span class="when">' + fmtRecTime(d.date, d.time) + bestLabel + '<small>' + fmtDateLine(d.date, d.time) + '</small></span>'
              + '<span class="conf">' + ((+d.confidence || 0) * 100).toFixed(0) + '%</span>'
              + '<div class="rec-spectro" aria-hidden="true">'
              +   '<div class="rec-spectro-loading">loading spectrogram...</div>'
              +   '<div class="rec-spectro-played"></div>'
              +   '<div class="rec-spectro-cursor"></div>'
              +   '<div class="rec-spectro-scrub" role="slider" aria-label="scrub" tabindex="0"></div>'
              + '</div>'
              + '</li>';
          }).join('')
        : '<li class="rec-empty">No recordings yet.</li>';
    }).catch(function () {
      document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Failed to load recordings.</li>';
    });

    // Wikipedia summary - direct from Wikipedia REST API
    var loadWiki = WIKI_CACHE[sci]
      ? Promise.resolve(WIKI_CACHE[sci])
      : fetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(sci)).then(function (j) {
          WIKI_CACHE[sci] = j; return j;
        });
    loadWiki.then(function (j) {
      var desc = document.getElementById('modalDesc');
      desc.textContent = j.extract || 'No description available.';
      desc.classList.toggle('placeholder', !j.extract);
    }).catch(function () {
      var desc = document.getElementById('modalDesc');
      desc.textContent = 'No description available.';
      desc.classList.add('placeholder');
    });
  }
  function closeDetailModal() {
    var modal = document.getElementById('detail-modal');
    stopModalAudio();
    var sci = (document.getElementById('modalSci').textContent || '').trim();
    var sourceCard = sci && atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    morphModalClose(modal.querySelector('.modal-card'), sourceCard, function () {
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    });
  }

  var atlasGridEl = document.getElementById('atlasGrid');
  function morphTransform(modalCard, sourceCard) {
    if (!modalCard || !sourceCard) return null;
    var s = sourceCard.getBoundingClientRect();
    if (!s.width || s.bottom < 0 || s.top > window.innerHeight ||
        s.right < 0 || s.left > window.innerWidth) return null;
    var m = modalCard.getBoundingClientRect();
    if (!m.width) return null;
    var scale = Math.max(0.1, s.width / m.width);
    var dx = (s.left + s.width / 2) - (m.left + m.width / 2);
    var dy = (s.top + s.height / 2) - (m.top + m.height / 2);
    return 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0) scale(' + scale.toFixed(4) + ')';
  }
  function onceTransformEnd(el, cb, fallbackMs) {
    var fired = false;
    function handler(ev) {
      if (ev && ev.propertyName && ev.propertyName !== 'transform') return;
      if (fired) return;
      fired = true;
      el.removeEventListener('transitionend', handler);
      cb();
    }
    el.addEventListener('transitionend', handler);
    setTimeout(handler, fallbackMs);
  }
  function morphModalOpen(modalCard, sourceCard) {
    var modal = document.getElementById('detail-modal');
    if (!modalCard) { modal.classList.add('is-open'); return; }
    modalCard.classList.remove('is-morphing');
    modalCard.style.transform = '';
    void modalCard.offsetWidth;
    var start = morphTransform(modalCard, sourceCard);
    if (start) {
      modalCard.style.transform = start;
      void modalCard.offsetWidth;
    }
    setTimeout(function () {
      modal.classList.add('is-open');
      if (start) {
        modalCard.classList.add('is-morphing');
        modalCard.style.transform = 'translate3d(0,0,0) scale(1)';
      }
    }, 0);
    if (start) {
      onceTransformEnd(modalCard, function () {
        modalCard.classList.remove('is-morphing');
        modalCard.style.transform = '';
      }, 360);
    }
  }
  function morphModalClose(modalCard, sourceCard, done) {
    var modal = document.getElementById('detail-modal');
    modal.classList.remove('is-open');
    var end = modalCard ? morphTransform(modalCard, sourceCard) : null;
    var finish = function () {
      if (modalCard) {
        modalCard.classList.remove('is-morphing');
        modalCard.style.transform = '';
      }
      if (done) done();
    };
    if (modalCard && end) {
      modalCard.classList.add('is-morphing');
      void modalCard.offsetWidth;
      modalCard.style.transform = end;
      onceTransformEnd(modalCard, finish, 360);
    } else {
      setTimeout(finish, 280);
    }
  }

  document.getElementById('modalPoseToggle').addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('button');
    if (!btn || btn.getAttribute('data-unavailable') === 'true') return;
    var pose = +btn.dataset.pose;
    var toggle = document.getElementById('modalPoseToggle');
    [].slice.call(toggle.querySelectorAll('button')).forEach(function (b) {
      b.setAttribute('aria-current', b === btn ? 'true' : 'false');
    });
    syncPill(toggle);
    var img = document.getElementById('modalImg');
    var sci = document.getElementById('modalSci').textContent;
    img.classList.add('swapping');
    setTimeout(function () {
      img.src = sketchSrc(sci, pose);
      img.addEventListener('load', function once() {
        img.classList.remove('swapping');
        img.removeEventListener('load', once);
      });
    }, 180);
  });

  window.__openDetailModal = openDetailModal;
  window.__closeDetailModal = closeDetailModal;

  // Routing
  (function syncRouter() {
    window.__lastHashchange = Date.now();
    var sci = readHash();
    if (location.hash === '#about') { openAbout(); return; }
    closeAbout();
    if (sci) { go(2); highlightAtlas(sci); openDetailModal(sci); }
    else     { highlightAtlas(null); closeDetailModal(); }
  })();
  if (location.hash === '#about') openAbout();
  window.addEventListener('hashchange', function () {
    window.__lastHashchange = Date.now();
    var sci = readHash();
    var adm = location.hash.match(/^#admin=/);
    if (adm) { /* admin overlay removed in standalone */ location.hash = ''; return; }
    if (location.hash === '#about') { openAbout(); return; }
    closeAbout();
    if (sci) { go(2); highlightAtlas(sci); openDetailModal(sci); }
    else     { highlightAtlas(null); closeDetailModal(); }
  });

  function openAbout()  { document.getElementById('about-modal').setAttribute('aria-hidden', 'false'); }
  function closeAbout() { document.getElementById('about-modal').setAttribute('aria-hidden', 'true'); }

  document.getElementById('detail-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
        document.getElementById('detail-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });

  document.getElementById('about-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
        document.getElementById('about-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.getElementById('aboutLink').addEventListener('click', function () {
    location.hash = '#about';
  });

  // ---- Client-side spectrogram generation ----
  var _specAudioCtx = null;
  function getSpecCtx() {
    if (!_specAudioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) _specAudioCtx = new C();
    }
    return _specAudioCtx;
  }

  var _decodedCache = {};

  
  function _fft(real, imag) {
    var n = real.length;
    var j = 0;
    for (var i = 0; i < n - 1; i++) {
      if (i < j) {
        var tr = real[i]; real[i] = real[j]; real[j] = tr;
        var ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      var k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (var stage = 2; stage <= n; stage *= 2) {
      var half = stage >> 1;
      var ang = -2 * Math.PI / stage;
      var wR = Math.cos(ang), wI = Math.sin(ang);
      for (var sBase = 0; sBase < n; sBase += stage) {
        var cR = 1, cI = 0;
        for (var sb = 0; sb < half; sb++) {
          var a = sBase + sb;
          var b = a + half;
          var trA = real[b] * cR - imag[b] * cI;
          var tiA = real[b] * cI + imag[b] * cR;
          real[b] = real[a] - trA;
          imag[b] = imag[a] - tiA;
          real[a] = real[a] + trA;
          imag[a] = imag[a] + tiA;
          var nR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR;
          cR = nR;
        }
      }
    }
  }

  function paintSpectrogram(canvas, audioBuffer) {
    requestAnimationFrame(function () {
      _paintSpectrogramNow(canvas, audioBuffer);
    });
  }
  function _paintSpectrogramNow(canvas, audioBuffer) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var strip = canvas.parentElement;
    var cssW = strip ? strip.clientWidth : (canvas.clientWidth || 600);
    var cssH = strip ? strip.clientHeight : (canvas.clientHeight || 88);
    if (cssW < 32 || cssH < 32) {
      requestAnimationFrame(function () { _paintSpectrogramNow(canvas, audioBuffer); });
      return;
    }
    var W = Math.max(1, Math.floor(cssW * dpr));
    var H = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = W; canvas.height = H;

    var ctx = canvas.getContext('2d');
    var samples = audioBuffer.getChannelData(0);
    var sr = audioBuffer.sampleRate;
    var FFT_SIZE = 1024;
    var bins = FFT_SIZE >> 1;
    var nyquist = sr / 2;

    var fLo = 200, fHi = Math.min(12000, nyquist);
    var binLo = Math.max(1, Math.floor(fLo / nyquist * bins));
    var binHi = Math.min(bins - 1, Math.ceil(fHi / nyquist * bins));

    var win = new Float32Array(FFT_SIZE);
    for (var i = 0; i < FFT_SIZE; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
    }

    var hop = Math.max(1, Math.floor((samples.length - FFT_SIZE) / Math.max(1, W - 1)));
    var real = new Float32Array(FFT_SIZE);
    var imag = new Float32Array(FFT_SIZE);

    var imgData = ctx.createImageData(W, H);
    var data = imgData.data;

    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var BG_R = dark ? 23  : 245, BG_G = dark ? 24  : 240, BG_B = dark ? 28  : 230;
    var FG_R = dark ? 236 : 26,  FG_G = dark ? 232 : 22,  FG_B = dark ? 225 : 18;
    for (var p = 0; p < data.length; p += 4) {
      data[p] = BG_R; data[p + 1] = BG_G; data[p + 2] = BG_B; data[p + 3] = 255;
    }

    var rowToBin = new Int32Array(H);
    for (var row = 0; row < H; row++) {
      var t = 1 - row / (H - 1);
      var bin = Math.round(binLo + (binHi - binLo) * Math.pow(t, 1.55));
      rowToBin[row] = Math.max(binLo, Math.min(binHi, bin));
    }

    for (var col = 0; col < W; col++) {
      var start = col * hop;
      if (start + FFT_SIZE > samples.length) break;
      for (var s = 0; s < FFT_SIZE; s++) {
        real[s] = samples[start + s] * win[s];
        imag[s] = 0;
      }
      _fft(real, imag);
      for (var row2 = 0; row2 < H; row2++) {
        var bin2 = rowToBin[row2];
        var re = real[bin2], im = imag[bin2];
        var mag = Math.sqrt(re * re + im * im);
        var db = 20 * Math.log10(mag + 1e-9);
        var v = (db + 75) / 65;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        var e = v * v * (3 - 2 * v);
        var r = BG_R + Math.round((FG_R - BG_R) * e);
        var g = BG_G + Math.round((FG_G - BG_G) * e);
        var b = BG_B + Math.round((FG_B - BG_B) * e);
        var px = (row2 * W + col) * 4;
        data[px] = r; data[px + 1] = g; data[px + 2] = b; data[px + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    canvas.classList.add('ready');
  }

  function ensureSpectroImage(row) {
    var file = row && row.dataset.file;
    if (!file) return;
    var strip = row.querySelector('.rec-spectro');
    if (!strip) return;
    var loadingEl = strip.querySelector('.rec-spectro-loading');
    var canvas = strip.querySelector('canvas');
    if (canvas && canvas.classList.contains('ready')) {
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      var played = strip.querySelector('.rec-spectro-played');
      strip.insertBefore(canvas, played);
    }
    if (loadingEl) {
      loadingEl.style.display = '';
      loadingEl.textContent = 'rendering spectrogram...';
    }

    function done() {
      if (loadingEl) loadingEl.style.display = 'none';
    }
    function fail(reason) {
      if (loadingEl) {
        loadingEl.style.display = '';
        loadingEl.textContent = reason || 'spectrogram unavailable';
      }
    }

    if (_decodedCache[file]) {
      paintSpectrogram(canvas, _decodedCache[file]);
      done();
      return;
    }
    var ctx = getSpecCtx();
    if (!ctx) { fail('WebAudio not available'); return; }
    var audioUrl = audioApiUrl(file);
    fetch(audioUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (audioBuffer) {
        _decodedCache[file] = audioBuffer;
        paintSpectrogram(canvas, audioBuffer);
        done();
      })
      .catch(function (e) {
        fail('spectrogram failed: ' + (e && e.message ? e.message : ''));
      });
  }

  document.getElementById('modalRecordings').addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    if (ev.target.closest('.rec-spectro-scrub')) return;

    var playBtn = ev.target.closest('.play');
    if (playBtn) {
      var prow = playBtn.closest('.rec-row');
      var pfile = prow && prow.dataset.file;
      if (!pfile) return;

      if (modalRecBtn === playBtn && modalAudio) {
        if (modalAudio.paused) {
          playBtn.setAttribute('data-active', 'true');
          playBtn.innerHTML = ICON_PAUSE;
          audioClaim(stopModalAudio);
          modalAudio.play().catch(function () {});
        } else {
          pauseModalAudio();
        }
        return;
      }

      stopModalAudio();
      audioClaim(stopModalAudio);
      playBtn.setAttribute('data-active', 'true');
      playBtn.innerHTML = ICON_PAUSE;
      modalRecBtn = playBtn;
      prow.classList.add('expanded');
      ensureSpectroImage(prow);
      var strip = prow.querySelector('.rec-spectro');
      var audio = new Audio(audioApiUrl(pfile));
      modalAudio = audio;
      audio.addEventListener('loadedmetadata', function () {
        strip.classList.add('armed');
      });
      audio.addEventListener('playing', startCursorLoop);
      audio.addEventListener('pause', stopCursorLoop);
      audio.addEventListener('ended', function () {
        stopCursorLoop();
        var p = strip.querySelector('.rec-spectro-played');
        var c = strip.querySelector('.rec-spectro-cursor');
        if (p) p.style.width = '0%';
        if (c) c.style.left = '0%';
        if (modalAudio) modalAudio.currentTime = 0;
        if (modalRecBtn) {
          modalRecBtn.removeAttribute('data-active');
          modalRecBtn.innerHTML = ICON_PLAY;
        }
      });
      audio.addEventListener('error', function () {
        stopModalAudio();
        playBtn.innerHTML = '<span style="font-size:8px">!</span>';
        setTimeout(function () { playBtn.innerHTML = ICON_PLAY; }, 1500);
      });
      audio.play().catch(function () { stopModalAudio(); });
      return;
    }

    var row = ev.target.closest('.rec-row');
    if (!row) return;
    var willExpand = !row.classList.contains('expanded');
    if (willExpand) {
      row.classList.add('expanded');
      ensureSpectroImage(row);
    } else {
      if (modalRecBtn && modalRecBtn.closest('.rec-row') === row) stopModalAudio();
      row.classList.remove('expanded');
    }
  });

  (function () {
    var dragRow = null;
    function seekFromEvent(row, clientX) {
      if (!modalAudio || !modalAudio.duration) return;
      var rowBtn = row.querySelector('.play');
      if (rowBtn !== modalRecBtn) return;
      var strip = row.querySelector('.rec-spectro');
      var rect = strip.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      modalAudio.currentTime = pct * modalAudio.duration;
      var pctStr = (pct * 100).toFixed(2) + '%';
      var played = strip.querySelector('.rec-spectro-played');
      var cur = strip.querySelector('.rec-spectro-cursor');
      if (played) played.style.width = pctStr;
      if (cur) cur.style.left = pctStr;
    }
    document.getElementById('modalRecordings').addEventListener('mousedown', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.clientX);
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.clientX);
    });
    document.addEventListener('mouseup', function () { dragRow = null; });
    document.getElementById('modalRecordings').addEventListener('touchstart', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.touches[0].clientX);
      ev.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.touches[0].clientX);
    });
    document.addEventListener('touchend', function () { dragRow = null; });
  })();

  function jumpToSci(sci) {
    if (!sci) return;
    if (location.hash !== '#sci=' + encodeURIComponent(sci)) {
      location.hash = '#sci=' + encodeURIComponent(sci);
    } else {
      go(2); highlightAtlas(sci);
    }
  }
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var card = ev.target.closest('.bird-card');
    if (card) {
      if (ev.target.closest('.actions, .spectro-wrap')) return;
      return jumpToSci(card.dataset.sci);
    }
    var liRow = ev.target.closest('li[data-sci]');
    if (liRow) return jumpToSci(liRow.dataset.sci);
    var heatRow = ev.target.closest('tr[data-sci]');
    if (heatRow) return openDetailModal(heatRow.dataset.sci);
    var tlCol = ev.target.closest('.stats-tl-col[data-sci]');
    if (tlCol) return jumpToSci(tlCol.dataset.sci);
  });

  var _origRenderAtlas = renderAtlas;
  renderAtlas = function (animate) {
    _origRenderAtlas(animate);
    var s = readHash();
    if (s) highlightAtlas(s);
  };
})();
