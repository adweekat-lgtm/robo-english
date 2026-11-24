/* ماسح السندات - reads the printed invoice number on a Delivery Note with the phone
 * camera (offline OCR, Tesseract.js bundled in vendor/) and keeps a list for Excel. */
(function () {
  'use strict';

  const VERSION = 'dn-v2';          // keep in sync with sw.js
  const KEY = 'dn-scanner-v1';
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- state
  const DEFAULTS = { device: '', len: 11, sound: true, confirm: true };
  let state = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      return { scans: Array.isArray(s.scans) ? s.scans : [], settings: { ...DEFAULTS, ...(s.settings || {}) }, exported: s.exported || 0 };
    } catch (e) {
      return { scans: [], settings: { ...DEFAULTS }, exported: 0 };
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { showResult('err', 'تعذّر الحفظ على الجهاز (الذاكرة ممتلئة؟)'); }
  }
  const has = (n) => state.scans.some((s) => s.n === n);

  // ---------------------------------------------------------------- number parsing
  function extract(text) {
    const t = toAscii(text).toUpperCase();
    const L = Number(state.settings.len) || 0;
    const ok = (r) => (L > 0 ? r.length === L : r.length >= 8 && r.length <= 14);
    const pick = (runs) => {
      const good = runs.filter(ok);
      if (!good.length) return null;
      // Prefer the run that follows "DN"
      const afterDn = good.find((r) => new RegExp('DN\\s*' + r).test(t.replace(/\s+/g, ' ')));
      return afterDn || good.sort((a, b) => b.length - a.length)[0];
    };
    return pick(t.match(/\d+/g) || []) ||
      pick(t.replace(/(\d)\s+(?=\d)/g, '$1').match(/\d+/g) || []); // OCR may insert spaces
  }
  // Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> 0-9 (Arabic keyboards type these)
  function toAscii(v) {
    return String(v || '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) & 0xf));
  }
  function cleanManual(v) {
    return toAscii(v).toUpperCase().replace(/^\s*DN/, '').replace(/[^0-9]/g, '');
  }

  // ---------------------------------------------------------------- UI helpers
  let resultTimer = 0;
  function showResult(kind, html) {
    const el = $('result');
    el.className = 'result ' + kind;
    el.innerHTML = html;
    clearTimeout(resultTimer);
    if (kind !== 'idle') resultTimer = setTimeout(() => { el.className = 'result idle'; el.textContent = 'جاهز للسند التالي'; }, 4000);
  }
  let audio = null;
  function beep(freq, ms) {
    if (!state.settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + ms / 1000);
    } catch (e) { /* no audio */ }
  }
  function flashFrame(cls) {
    const f = $('frame');
    f.classList.remove('ok', 'dup');
    f.classList.add(cls);
    setTimeout(() => f.classList.remove(cls), 700);
  }
  const pad = (x) => String(x).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  function render(flashFirst) {
    $('count').innerHTML = `<bdi dir="ltr">${state.scans.length}</bdi>`;
    const list = $('list');
    if (!state.scans.length) {
      list.innerHTML = '<li class="empty">لا توجد أرقام بعد</li>';
      return;
    }
    const total = state.scans.length;
    list.innerHTML = state.scans.slice().reverse().map((s, i) => {
      const d = new Date(s.t);
      return `<li data-n="${s.n}"${i === 0 && flashFirst ? ' class="flash"' : ''}>
        <span class="idx"><bdi dir="ltr">${total - i}</bdi></span>
        <span class="num" dir="ltr">${s.n}</span>
        <span class="meta"><bdi dir="ltr">${timeStr(d)}</bdi><br>${s.src === 'manual' ? '✍️' : '📷'}</span>
        <button data-act="edit" aria-label="تعديل">✏️</button>
        <button data-act="del" aria-label="حذف">✕</button>
      </li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- add / edit / delete
  function add(n, src) {
    if (has(n)) {
      showResult('dup', `⚠ مكرر <bdi dir="ltr">${n}</bdi><small>هذا الرقم ممسوح من قبل ولم يُضف مرة ثانية</small>`);
      flashFrame('dup');
      beep(220, 250);
      if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
      return false;
    }
    state.scans.push({ n, t: new Date().toISOString(), src });
    save();
    render(true);
    showResult('ok', `✅ <bdi dir="ltr">${n}</bdi><small>رقم <bdi dir="ltr">${state.scans.length}</bdi></small>`);
    flashFrame('ok');
    beep(1200, 120);
    if (navigator.vibrate) navigator.vibrate(60);
    return true;
  }

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const n = btn.closest('li').dataset.n;
    const idx = state.scans.findIndex((s) => s.n === n);
    if (idx < 0) return;
    if (btn.dataset.act === 'del') {
      if (!confirm(`حذف الرقم ${n}؟`)) return;
      state.scans.splice(idx, 1);
    } else {
      const v = cleanManual(prompt('تعديل رقم الفاتورة:', n));
      if (!v) return;
      if (v !== n && has(v)) { alert('هذا الرقم موجود في القائمة.'); return; }
      state.scans[idx].n = v;
      state.scans[idx].src = 'manual';
    }
    save();
    render();
  });

  $('manual').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('manualInput');
    const v = cleanManual(inp.value);
    if (v.length < 5) { showResult('err', 'اكتب رقم الفاتورة كاملاً'); return; }
    unlockAudio();
    if (add(v, 'manual')) inp.value = '';
  });

  // ---------------------------------------------------------------- OCR
  let worker = null;
  let ocrPromise = null;
  function initOcr() {
    if (ocrPromise) return ocrPromise;
    ocrPromise = (async () => {
      if (!window.Tesseract) throw new Error('OCR library missing');
      const base = new URL('vendor/', location.href).href;
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
      });
      await w.setParameters({
        tessedit_char_whitelist: 'DN0123456789',
        tessedit_pageseg_mode: '7', // single text line
      });
      worker = w;
      return w;
    })();
    ocrPromise.catch(() => { ocrPromise = null; });
    return ocrPromise;
  }

  const crop = document.createElement('canvas');
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  function grab() {
    const video = $('video');
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const vr = video.getBoundingClientRect();
    const fr = $('frame').getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    let sx = (fr.left - vr.left - offX) / scale;
    let sy = (fr.top - vr.top - offY) / scale;
    let sw = fr.width / scale;
    let sh = fr.height / scale;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    const outH = 110;
    const outW = Math.min(1400, Math.round(sw * outH / sh));
    crop.width = outW;
    crop.height = outH;
    cctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    // grayscale + contrast stretch (2%..98%) - helps with faded thermal print
    const img = cctx.getImageData(0, 0, outW, outH);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = g;
      hist[g]++;
    }
    const total = outW * outH;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    cctx.putImageData(img, 0, 0);
    return crop;
  }

  // ---------------------------------------------------------------- scan loop
  let running = false;
  let paused = false;
  let stream = null;
  let recent = [];          // last candidate reads
  let lastHit = { n: null, seen: 0 };
  let wakeLock = null;

  async function scanLoop() {
    while (running) {
      if (!paused && worker && $('video').readyState >= 2) {
        const c = grab();
        if (c) {
          try {
            const { data } = await worker.recognize(c);
            handleRead(data.text || '');
          } catch (e) { /* skip frame */ }
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  function handleRead(text) {
    const raw = text.replace(/\s+/g, ' ').trim();
    $('ocrLive').textContent = raw ? '👁 ' + raw.slice(0, 40) : '';
    const n = extract(text);
    const now = Date.now();
    recent.push(n);
    if (recent.length > 3) recent.shift();
    if (!n) return;
    // Same note still in front of the camera -> ignore until it is moved away.
    if (n === lastHit.n && now - lastHit.seen < 1800) { lastHit.seen = now; return; }
    const votes = recent.filter((x) => x === n).length;
    if (state.settings.confirm && votes < 2) return;
    lastHit = { n, seen: now };
    recent = [];
    add(n, 'cam');
  }

  async function startCamera() {
    unlockAudio();
    const msg = $('camMsg');
    msg.hidden = true;
    if (!window.isSecureContext) {
      camError('يجب فتح التطبيق من رابط https حتى تعمل الكاميرا.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camError('هذا المتصفح لا يدعم الكاميرا. استخدم Chrome (أندرويد) أو Safari (آيفون).');
      return;
    }
    $('btnStart').hidden = true;
    showResult('idle', '⏳ جاري تشغيل الكاميرا وتجهيز القارئ…');
    const ocr = initOcr();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      $('btnStart').hidden = false;
      if (e && e.name === 'NotAllowedError') camError('لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح ثم أعد المحاولة.');
      else if (e && e.name === 'NotFoundError') camError('لم يتم العثور على كاميرا في هذا الجهاز.');
      else camError('تعذّر تشغيل الكاميرا: ' + ((e && e.message) || e));
      return;
    }
    const video = $('video');
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay muted is allowed */ }
    setupTrackTools(stream.getVideoTracks()[0]);
    try {
      await ocr;
    } catch (e) {
      camError('تعذّر تجهيز قارئ الأرقام. افتح التطبيق مرة واحدة مع الإنترنت ليُحمَّل، ثم يعمل بدونه.');
      stopCamera();
      $('btnStart').hidden = false;
      return;
    }
    running = true;
    paused = false;
    $('btnPause').hidden = false;
    $('btnPause').textContent = '⏸';
    showResult('idle', 'وجّه الكاميرا على رقم الفاتورة');
    requestWakeLock();
    scanLoop();
  }

  function stopCamera() {
    running = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
    $('btnTorch').hidden = true;
    $('zoom').hidden = true;
    $('btnPause').hidden = true;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function camError(text) {
    const msg = $('camMsg');
    msg.textContent = text;
    msg.hidden = false;
    showResult('err', text);
  }

  let torchOn = false;
  function setupTrackTools(track) {
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const adv = [];
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.push({ focusMode: 'continuous' });
    if (adv.length) track.applyConstraints({ advanced: adv }).catch(() => {});
    if (caps.torch) {
      const b = $('btnTorch');
      b.hidden = false;
      b.onclick = () => {
        torchOn = !torchOn;
        track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
      };
    }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const z = $('zoom');
      z.min = caps.zoom.min;
      z.max = Math.min(caps.zoom.max, caps.zoom.min * 5);
      z.step = caps.zoom.step || 0.1;
      z.value = (track.getSettings && track.getSettings().zoom) || caps.zoom.min;
      z.hidden = false;
      z.oninput = () => track.applyConstraints({ advanced: [{ zoom: Number(z.value) }] }).catch(() => {});
    }
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
  }

  function unlockAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* ignore */ }
  }

  let resumeOnShow = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeOnShow = running;
      if (running) stopCamera();
    } else if (resumeOnShow) {
      resumeOnShow = false;
      startCamera();
    }
  });

  $('btnStart').addEventListener('click', startCamera);
  $('btnPause').addEventListener('click', () => {
    paused = !paused;
    $('btnPause').textContent = paused ? '▶' : '⏸';
    showResult('idle', paused ? '⏸ متوقف مؤقتاً' : 'وجّه الكاميرا على رقم الفاتورة');
  });

  // ---------------------------------------------------------------- export
  function exportRows() {
    const dev = state.settings.device || '';
    const rows = [['#', 'Invoice Number', 'Date', 'Time', 'Device', 'Source']];
    state.scans.forEach((s, i) => {
      const d = new Date(s.t);
      rows.push([i + 1, s.n.length <= 15 ? Number(s.n) : s.n, dateStr(d), timeStr(d), dev, s.src === 'manual' ? 'Manual' : 'Camera']);
    });
    return rows;
  }

  $('btnExport').addEventListener('click', async () => {
    if (!state.scans.length) { showResult('err', 'القائمة فارغة'); return; }
    const blob = window.makeXlsx(exportRows(), { sheetName: 'Scans', widths: [6, 18, 12, 10, 16, 10] });
    const dev = (state.settings.device || '').replace(/[^\w؀-ۿ-]+/g, '_');
    const d = new Date();
    const name = `DN_Scans_${dateStr(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${dev ? '_' + dev : ''}.xlsx`;
    const file = new File([blob], name, { type: blob.type });
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        shared = true;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    if (!shared) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }
    state.exported = state.scans.length;
    save();
    showResult('ok', `📊 تم التصدير<small><bdi dir="ltr">${state.scans.length}</bdi> رقم</small>`);
  });

  $('btnCopy').addEventListener('click', async () => {
    if (!state.scans.length) { showResult('err', 'القائمة فارغة'); return; }
    const text = state.scans.map((s) => s.n).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showResult('ok', `📋 تم نسخ <bdi dir="ltr">${state.scans.length}</bdi> رقم<small>الصقها في عمود في Excel</small>`);
  });

  $('btnClear').addEventListener('click', () => {
    if (!state.scans.length) return;
    const notExported = state.exported !== state.scans.length;
    const q = notExported
      ? `⚠ لم تقم بتصدير القائمة بعد!\nسيتم حذف ${state.scans.length} رقم. هل أنت متأكد؟`
      : `بدء قائمة جديدة وحذف ${state.scans.length} رقم؟`;
    if (!confirm(q)) return;
    state.scans = [];
    state.exported = 0;
    lastHit = { n: null, seen: 0 };
    save();
    render();
    showResult('idle', 'قائمة جديدة');
  });

  // ---------------------------------------------------------------- settings
  $('btnSettings').addEventListener('click', () => {
    $('setDevice').value = state.settings.device;
    $('setLen').value = state.settings.len;
    $('setSound').checked = state.settings.sound;
    $('setConfirm').checked = state.settings.confirm;
    $('settings').showModal();
  });
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue !== 'ok') return;
    const len = parseInt($('setLen').value, 10);
    state.settings = {
      device: $('setDevice').value.trim(),
      len: Number.isFinite(len) && len >= 0 && len <= 20 ? len : 11,
      sound: $('setSound').checked,
      confirm: $('setConfirm').checked,
    };
    save();
  });
  $('ver').textContent = VERSION;

  render();
  // Warm up the OCR engine in the background so the first scan is instant.
  if (window.requestIdleCallback) requestIdleCallback(() => initOcr().catch(() => {}));
  else setTimeout(() => initOcr().catch(() => {}), 500);

  window.__dn = { extract, add, state: () => state, grab, handleRead };
})();
