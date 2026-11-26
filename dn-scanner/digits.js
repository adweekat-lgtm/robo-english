/* Recogniser for the dot-matrix digits printed on delivery notes, in Arabic-Indic
 * ("DN١٢٠٢٠٤٠٠٢٠٦") or English ("DN12020400281") form. Pure JS, no libraries, a few ms per frame.
 *
 * Pipeline: gray image -> local threshold -> dilate (joins printer dots) ->
 * connected components -> pick the text line -> one 16x16 feature grid per glyph ->
 * nearest-neighbour against templates (shipped + learned on the device).
 *
 * Works in the browser (window.DNDigits) and in Node (module.exports) for training. */
(function (root) {
  'use strict';

  let G = 16;                   // feature grid size
  let SRC = 'ink';              // feature source: 'ink' (sharper) or 'dil' (dilated mask)
  const WORK_H = 96;            // input is rescaled to this height

  // ------------------------------------------------------------------ image ops
  function resizeGray(img, newH) {
    const s = newH / img.h;
    const w = Math.max(1, Math.round(img.w * s));
    const h = newH;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy0 = y / s, sy1 = (y + 1) / s;
      for (let x = 0; x < w; x++) {
        const sx0 = x / s, sx1 = (x + 1) / s;
        let sum = 0, n = 0;
        for (let yy = Math.floor(sy0); yy < Math.min(img.h, Math.ceil(sy1)); yy++) {
          for (let xx = Math.floor(sx0); xx < Math.min(img.w, Math.ceil(sx1)); xx++) {
            sum += img.data[yy * img.w + xx]; n++;
          }
        }
        out[y * w + x] = n ? sum / n : 255;
      }
    }
    return { w, h, data: out };
  }

  // Bradley adaptive threshold: ink where pixel is clearly darker than its neighbourhood.
  function binarize(img) {
    const { w, h, data } = img;
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += data[y * w + x];
        ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(h / 3));
    const out = new Uint8Array(w * h);
    let mean = 0;
    for (let i = 0; i < data.length; i++) mean += data[i];
    mean /= data.length;
    // Otsu threshold: print is much darker than paper texture, shadows or the moiré
    // stripes you get when photographing a screen; only pixels below it can be ink.
    const hist = new Float64Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    let sumAll = 0;
    for (let v = 0; v < 256; v++) sumAll += v * hist[v];
    let wB = 0, sumB = 0, best = 0, otsu = 255;
    for (let v = 0; v < 256; v++) {
      wB += hist[v]; if (!wB) continue;
      const wF = data.length - wB; if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; otsu = v; }
    }
    const lim = Math.min(mean * 0.92, otsu + 0.15 * (mean - otsu));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
        const local = sum / ((x1 - x0) * (y1 - y0));
        const v = data[y * w + x];
        out[y * w + x] = v < local * 0.82 && v < lim ? 1 : 0;
      }
    }
    return out;
  }

  function dilate(mask, w, h, r) {
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1; }
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function components(mask, w, h) {
    const lab = new Int32Array(w * h);
    const comps = [];
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
      const id = comps.length + 1;
      lab[i] = id;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p / w) | 0;
        c.n++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] && !lab[q]) { lab[q] = id; stack.push(q); }
          }
        }
      }
      c.x1++; c.y1++;
      comps.push(c);
    }
    return comps;
  }

  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  // ------------------------------------------------------------------ segmentation
  /* Returns { glyphs: [{x0,x1,y0,y1,f:Float32Array}], band:{top,bottom} } for the
   * text line with the most characters in the image. */
  function segment(gray, workH = WORK_H) {
    const img = resizeGray(gray, workH);
    const { w, h } = img;
    const ink = binarize(img);
    const dil = dilate(ink, w, h, 2);
    let comps = components(dil, w, h).filter((c) => c.y1 - c.y0 >= 3 && c.x1 - c.x0 >= 2 && c.n >= 6);
    if (!comps.length) return { lines: [], glyphs: [], img, dil };

    // Group into lines by vertical overlap.
    comps.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const lines = [];
    for (const c of comps) {
      const ch = c.y1 - c.y0;
      let best = null;
      for (const L of lines) {
        const ov = Math.min(L.y1, c.y1) - Math.max(L.y0, c.y0);
        if (ov > 0.4 * Math.min(ch, L.y1 - L.y0)) { best = L; break; }
      }
      if (best) {
        best.items.push(c);
        best.y0 = median(best.items.map((i) => i.y0));
        best.y1 = median(best.items.map((i) => i.y1));
      } else lines.push({ y0: c.y0, y1: c.y1, items: [c] });
    }
    const score = (L) => L.items.length - 3 * Math.abs((L.y0 + L.y1) / 2 - h / 2) / h; // prefer centre
    lines.sort((a, b) => score(b) - score(a));
    const out = lines.filter((L) => L.items.length >= 3).slice(0, 3).map((L) => lineGlyphs(L.items, ink, dil, w, h));
    return { lines: out, glyphs: out.length ? out[0].glyphs : [], img, dil };
  }

  function lineGlyphs(items, ink, dil, w, h) {
    // Line band from the taller glyphs (digits like ١٢٣ reach full height).
    const hs = items.map((c) => c.y1 - c.y0).sort((a, b) => b - a);
    const H = Math.max(6, hs[Math.floor((hs.length - 1) / 3)]);
    const tall = items.filter((c) => c.y1 - c.y0 >= 0.7 * H);
    // Fit top(x) and bottom(x) as straight lines: curled paper makes the text slope.
    const fit = (key) => {
      const xs = tall.map((c) => (c.x0 + c.x1) / 2), ys = tall.map((c) => c[key]);
      const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
      let k = n > 2 && sxx > 0 ? sxy / sxx : 0;
      k = Math.max(-0.15, Math.min(0.15, k));
      const med = median(ys.map((y, i) => y - k * xs[i]));
      return (x) => med + k * x;
    };
    const topAt = fit('y0'), botAt = fit('y1');
    const top = median(tall.map((c) => c.y0));
    const bottom = median(tall.map((c) => c.y1));
    const BH = Math.max(6, bottom - top);

    // Drop specks and anything outside the band; merge pieces of one glyph.
    items = items.filter((c) => {
      const cy = (c.y0 + c.y1) / 2, x = (c.x0 + c.x1) / 2;
      return cy > topAt(x) - 0.3 * BH && cy < botAt(x) + 0.3 * BH && Math.max(c.x1 - c.x0, c.y1 - c.y0) >= 0.14 * BH;
    }).sort((a, b) => a.x0 - b.x0);
    const merged = [];
    for (const c of items) {
      const p = merged[merged.length - 1];
      if (p) {
        const ov = Math.min(p.x1, c.x1) - Math.max(p.x0, c.x0);
        if (ov > 0.5 * Math.min(p.x1 - p.x0, c.x1 - c.x0)) {
          p.x0 = Math.min(p.x0, c.x0); p.x1 = Math.max(p.x1, c.x1);
          p.y0 = Math.min(p.y0, c.y0); p.y1 = Math.max(p.y1, c.y1); p.n += c.n;
          continue;
        }
      }
      merged.push({ ...c });
    }

    // Feature grid: same scale in x and y, glyph centred, vertical frame = band +-20%.
    const src = SRC === 'ink' ? ink : dil;
    const span = 1.4 * BH;
    const glyphs = merged.map((c) => {
      const f = new Float32Array(G * G + 2);
      const cx = (c.x0 + c.x1) / 2;
      const fy0 = topAt(cx) - 0.2 * BH;
      const cell = span / G;
      for (let gy = 0; gy < G; gy++) {
        const sy0 = fy0 + gy * cell, sy1 = sy0 + cell;
        for (let gx = 0; gx < G; gx++) {
          const sx0 = cx - span / 2 + gx * cell, sx1 = sx0 + cell;
          let on = 0, n = 0;
          for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
            if (y < c.y0 || y >= c.y1) { n += Math.ceil(sx1) - Math.floor(sx0); continue; }
            for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
              n++;
              if (x >= c.x0 && x < c.x1 && src[y * w + x]) on++;
            }
          }
          f[gy * G + gx] = n ? on / n : 0;
        }
      }
      f[G * G] = (c.x1 - c.x0) / BH;      // width
      f[G * G + 1] = (c.y1 - c.y0) / BH;  // height
      return { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, f };
    });
    // A line cut by the top/bottom of the picture has truncated digits: never trust it.
    const clipped = merged.some((c) => (c.y0 <= 0 || c.y1 >= h) && c.y1 - c.y0 >= 0.5 * BH);
    return { glyphs, band: { top, bottom }, clipped, BH };
  }

  // ------------------------------------------------------------------ classification
  function dist(a, b) {
    let d = 0;
    for (let i = 0; i < G * G; i++) { const t = a[i] - b[i]; d += t * t; }
    const dw = a[G * G] - b[G * G], dh = a[G * G + 1] - b[G * G + 1];
    return d + 12 * (dw * dw + dh * dh);
  }

  // k-nearest-neighbour; ratio = distance to the best other class / distance to the winner
  function classify(f, templates, k = 3) {
    const near = [];
    for (const t of templates) {
      const d = dist(f, t.f);
      if (near.length < 12 || d < near[near.length - 1].d) {
        near.push({ d, l: t.l, s: t.s || '' });
        near.sort((a, b) => a.d - b.d);
        if (near.length > 12) near.pop();
      }
    }
    if (!near.length) return { l: '?', d: Infinity, ratio: 0 };
    const votes = {};
    near.slice(0, k).forEach((n) => { votes[n.l] = (votes[n.l] || 0) + 1 / (n.d + 0.5); });
    const l = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    const bd = near.find((n) => n.l === l).d;
    // Confidence is measured against other digits only (a digit vs a noise speck is
    // caught later by the length check).
    const isD = /\d/.test(l);
    const other = near.find((n) => n.l !== l && (!isD || /\d/.test(n.l)));
    return { l, d: bd, ratio: other ? other.d / (bd + 1e-6) : 9, s: near[0].s };
  }

  // Templates of one script ('a' Arabic-Indic, 'e' English digits) plus the shared ones
  // (D, N, noise, and learned glyphs without a script). Cached per template array.
  const byScript = new WeakMap();
  function scriptSet(templates, sc) {
    let m = byScript.get(templates);
    if (!m) { m = {}; byScript.set(templates, m); }
    if (!m[sc]) m[sc] = templates.filter((t) => !t.s || t.s === sc);
    return m[sc];
  }

  /* Read the text: tries the best few lines and returns the first that contains an
   * invoice number. text uses 0-9, D, N and '.' for punctuation/noise.
   * sure = every digit was recognised with confidence ratio >= minRatio. */
  function read(gray, templates, len, minRatio = 1.2, workH = WORK_H) {
    const seg = segment(gray, workH);
    let first = null;
    for (const line of seg.lines) {
      // A DN line is all English or all Arabic-Indic digits, and some shapes exist in both
      // (English 1 ~ Arabic ٦). Vote the script over the line, then read with that script only.
      let glyphs = line.glyphs.map((g) => ({ ...g, ...classify(g.f, templates) }));
      const votes = { a: 0, e: 0 };
      glyphs.forEach((g) => { if (/\d/.test(g.l) && votes[g.s] !== undefined) votes[g.s]++; });
      const script = votes.e > votes.a ? 'e' : votes.a > votes.e ? 'a' : '';
      if (script) glyphs = line.glyphs.map((g) => ({ ...g, ...classify(g.f, scriptSet(templates, script)), script }));
      // A wide gap (e.g. between the number and the Arabic label) ends the number.
      let text = '';
      glyphs.forEach((g, i) => {
        if (i && g.x0 - glyphs[i - 1].x1 > 1.2 * line.BH) text += ' ';
        text += g.l === 'x' ? '.' : g.l;
      });
      const inv = invoiceFrom(text, len);
      const digits = glyphs.filter((g) => /\d/.test(g.l));
      const sure = !line.clipped && digits.every((g) => g.ratio >= minRatio);
      const r = { text, glyphs, inv, sure, script };
      if (inv) return r;
      if (!first) first = r;
    }
    return first || { text: '', glyphs: [], inv: null, sure: false };
  }

  // Pull the invoice number out of a read: digits after "DN", else the longest digit run.
  function invoiceFrom(text, len) {
    const t = text;
    const m = t.match(/D?N(\d+)/);
    const cands = [];
    if (m) cands.push(m[1]);
    (t.match(/\d+/g) || []).forEach((r) => cands.push(r));
    for (const c of cands) {
      if (len > 0 ? c.length === len : c.length >= 8 && c.length <= 14) return c;
    }
    return null;
  }

  // Templates are stored compactly: grid values as 0-9 chars + width/height.
  function packTemplate(l, f, script) {
    let s = '';
    for (let i = 0; i < G * G; i++) s += Math.min(9, Math.round(f[i] * 9));
    const p = [l, s, +f[G * G].toFixed(3), +f[G * G + 1].toFixed(3)];
    if (script) p.push(script);
    return p;
  }
  function unpackTemplate(p) {
    const f = new Float32Array(G * G + 2);
    for (let i = 0; i < G * G; i++) f[i] = (p[1].charCodeAt(i) - 48) / 9;
    f[G * G] = p[2];
    f[G * G + 1] = p[3];
    return { l: p[0], f, s: p[4] || '' };
  }

  const api = { setOpts: (o) => { if (o.G) G = o.G; if (o.SRC) SRC = o.SRC; }, segment, classify, read, invoiceFrom, packTemplate, unpackTemplate, dist, G };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DNDigits = api;
})(typeof self !== 'undefined' ? self : this);
