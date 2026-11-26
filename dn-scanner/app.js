/* ماسح السندات - reads the printed invoice number on a Delivery Note with the phone
 * camera (digits.js: offline recogniser for the dot-matrix Arabic-Indic digits) and keeps
 * a list for Excel. */
(function () {
  'use strict';

  const VERSION = 'dn-v10';          // keep in sync with sw.js
  const KEY = 'dn-scanner-v1';
  const LEARN_KEY = 'dn-scanner-learned';
  const LEARN_MAX = 500;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- state
  const DEFAULTS = { device: '', len: 11, sound: true, confirm: true, zoom: 0 };
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
      if (v !== n && readsByNumber[n]) learn(readsByNumber[n], v);
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
    if (lastRead && Date.now() - lastRead.at < 8000) learn(lastRead.glyphs, v);
    if (add(v, 'manual')) inp.value = '';
  });

  // ---------------------------------------------------------------- digit recogniser
  // digits.js reads the dot-matrix Arabic-Indic digits. Templates = shipped (from real
  // DN photos) + learned on this phone whenever the user types or corrects a number.
  let templates = [];
  let learned = [];
  function loadTemplates() {
    try { learned = JSON.parse(localStorage.getItem(LEARN_KEY)) || []; } catch (e) { learned = []; }
    const base = (window.DN_TEMPLATES || []).map(DNDigits.unpackTemplate);
    templates = base.concat(learned.map(DNDigits.unpackTemplate));
  }
  function learn(glyphs, number) {
    if (!glyphs || !glyphs.length) return false;
    // Keep only glyphs that can be digits (drop D, N and punctuation), then align.
    let g = glyphs.filter((x) => x.l !== 'D' && x.l !== 'N' && x.l !== 'x');
    if (g.length !== number.length) {
      const all = glyphs.filter((x) => x.l !== 'x');
      if (all.length === number.length + 2) g = all.slice(2);      // "DN" + digits
      else if (all.length === number.length) g = all;
      else return false;
    }
    g.forEach((x, i) => learned.push(DNDigits.packTemplate(number[i], x.f, x.script)));
    if (learned.length > LEARN_MAX) learned = learned.slice(-LEARN_MAX);
    try { localStorage.setItem(LEARN_KEY, JSON.stringify(learned)); } catch (e) { /* full */ }
    loadTemplates();
    setTimeout(() => { $('ocrLive').textContent = '🧠 تعلّم القارئ من هذا السند'; }, 50);
    return true;
  }

  const crop = document.createElement('canvas');
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  // The on-screen frame as a fraction (0..1) of the video picture (video uses object-fit: cover).
  function frameNorm() {
    const video = $('video');
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const vr = video.getBoundingClientRect();
    const fr = $('frame').getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;
    return {
      x: (fr.left - vr.left - offX) / scale / vw,
      y: (fr.top - vr.top - offY) / scale / vh,
      w: fr.width / scale / vw,
      h: fr.height / scale / vh,
    };
  }

  // Crop a region (pixels of src) into a gray image about outH pixels high.
  function cropGray(src, sx, sy, sw, sh, outH = 160) {
    const W = src.videoWidth || src.naturalWidth || src.width, H = src.videoHeight || src.naturalHeight || src.height;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(W - sx, sw); sh = Math.min(H - sy, sh);
    if (sw < 8 || sh < 8) return null;
    const outW = Math.min(2400, Math.round(sw * outH / sh));
    crop.width = outW;
    crop.height = outH;
    cctx.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
    const d = cctx.getImageData(0, 0, outW, outH).data;
    const gray = new Uint8Array(outW * outH);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    return { w: outW, h: outH, data: gray };
  }

  // Crop the frame region; grow = extra height around the frame (1 = frame only).
  function grab(grow = 1) {
    const video = $('video');
    const n = frameNorm();
    if (!n) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const h = n.h * grow, y = n.y - (h - n.h) / 2;
    return cropGray(video, n.x * vw, y * vh, n.w * vw, h * vh, Math.round(160 * grow));
  }

  // ---------------------------------------------------------------- scan loop
  let running = false;
  let paused = false;
  let stream = null;
  let recent = [];          // last candidate reads
  let lastHit = { n: null, seen: 0 };
  let wakeLock = null;

  let lastRead = null;        // most recent read with glyphs (for learning)
  const readsByNumber = {};   // number -> glyphs it was read from (to learn from corrections)

  async function scanLoop() {
    while (running) {
      if (!paused && $('video').readyState >= 2) {
        const g = grab();
        if (g) {
          try { handleRead(DNDigits.read(g, templates, Number(state.settings.len) || 0)); } catch (e) { /* skip frame */ }
        }
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  function handleRead(r) {
    if (confirmOpen) return;
    if (r.glyphs.length >= 6) lastRead = { glyphs: r.glyphs, at: Date.now() };
    const live = r.text.replace(/\./g, '');
    if (!$('ocrLive').textContent.startsWith('🧠') || live) $('ocrLive').textContent = live ? '👁 ' + live + (r.inv && !r.sure ? ' ?' : '') : '';
    const n = r.inv && r.sure ? r.inv : null;
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
    readsByNumber[n] = r.glyphs;
    add(n, 'cam');
  }

  // quiet = restart in the background without replacing the message on screen
  async function startCamera(quiet) {
    quiet = quiet === true;
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
    if (!quiet) showResult('idle', '⏳ جاري تشغيل الكاميرا…');
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
    if (!window.DNDigits || !templates.length) {
      camError('تعذّر تجهيز قارئ الأرقام. أغلق التطبيق وافتحه مرة ثانية مع الإنترنت.');
      stopCamera();
      $('btnStart').hidden = false;
      return;
    }
    running = true;
    paused = false;
    $('btnPause').hidden = false;
    $('btnPause').textContent = '⏸';
    if ($('btnShot')) $('btnShot').hidden = false;
    if (!quiet) showResult('idle', 'ضع سطر رقم السند (DN) داخل الإطار، أو اضغط 📸');
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
    if ($('btnShot')) $('btnShot').hidden = true;
    camTrack = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function camError(text) {
    const msg = $('camMsg');
    msg.textContent = text;
    msg.hidden = false;
    showResult('err', text);
  }

  // ---------------------------------------------------------------- 📸 capture / confirm / phone camera
  let camTrack = null;
  let shotBusy = false;
  let confirmOpen = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const invLen = () => Number(state.settings.len) || 0;
  // grow = crop height relative to the frame: keep the digits the same size for the reader.
  function tryRead(gray, grow = 1) {
    if (!gray) return null;
    try { return DNDigits.read(gray, templates, invLen(), 1.2, Math.round(96 * grow)); } catch (e) { return null; }
  }
  const mode = (arr) => {
    const c = {};
    arr.forEach((x) => { c[x] = (c[x] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  };

  // The video shows the centre of the camera picture; map the frame into a full photo.
  function photoRegion(pw, ph, videoAspect, n, grow) {
    let fx0 = 0, fy0 = 0, fw = pw, fh = ph;
    if (videoAspect > pw / ph) { fh = pw / videoAspect; fy0 = (ph - fh) / 2; } else { fw = ph * videoAspect; fx0 = (pw - fw) / 2; }
    const h = n.h * grow, y = n.y - (h - n.h) / 2;
    return [fx0 + n.x * fw, fy0 + y * fh, n.w * fw, h * fh];
  }

  async function takeShot() {
    if (shotBusy || !stream) return;
    unlockAudio();
    shotBusy = true;
    const wasPaused = paused;
    paused = true;                       // the live loop must not add while we decide
    const btn = $('btnShot');
    if (btn) btn.disabled = true;
    showResult('idle', '📸 جاري القراءة…');
    const reads = [];
    try {
      // 1) Full-resolution still photo where the browser supports it (Android Chrome).
      if (window.ImageCapture && camTrack) {
        try {
          const ic = new ImageCapture(camTrack);
          const blob = await Promise.race([ic.takePhoto(), sleep(2500).then(() => { throw new Error('timeout'); })]);
          const bmp = await createImageBitmap(blob);
          const video = $('video');
          const n = frameNorm();
          if (n) {
            for (const g of [1, 2]) {
              const r = photoRegion(bmp.width, bmp.height, video.videoWidth / video.videoHeight, n, g);
              reads.push(tryRead(cropGray(bmp, r[0], r[1], r[2], r[3], Math.round(160 * g)), g));
            }
          }
          if (bmp.close) bmp.close();
        } catch (e) { /* not supported or failed: use video frames */ }
      }
      // 2) A short burst of video frames.
      for (let i = 0; i < 6; i++) {
        reads.push(tryRead(grab(1)), tryRead(grab(2), 2));
        await sleep(70);
      }
    } finally {
      paused = wasPaused;
      shotBusy = false;
      if (btn) btn.disabled = false;
    }
    decide(reads.filter(Boolean));
  }

  // Sure and agreed -> add. Read but unsure -> ask the user. Nothing -> explain.
  function decide(reads) {
    const sure = reads.filter((r) => r.inv && r.sure);
    if (sure.length) {
      const n = mode(sure.map((r) => r.inv));
      const agree = sure.filter((r) => r.inv === n).length;
      const g = sure.find((r) => r.inv === n).glyphs;
      // Another number also read with confidence, and not clearly outvoted -> let the user decide.
      const rival = sure.some((r) => r.inv !== n && sure.filter((x) => x.inv === r.inv).length * 2 >= agree);
      if (!rival && (agree >= 2 || !state.settings.confirm)) {
        readsByNumber[n] = g;
        lastHit = { n, seen: Date.now() };
        add(n, 'cam');
        return;
      }
      askConfirm(n, g);
      return;
    }
    const cand = reads.filter((r) => r.inv);
    if (cand.length) {
      const n = mode(cand.map((r) => r.inv));
      askConfirm(n, cand.find((r) => r.inv === n).glyphs);
      return;
    }
    const any = reads.find((r) => r.glyphs.length >= 6);
    if (any) lastRead = { glyphs: any.glyphs, at: Date.now() };   // typing the number now teaches the reader
    showResult('err', 'لم أستطع قراءة الرقم<small>قرّب الجوال قليلاً أو شغّل الفلاش 🔦، أو اكتب الرقم يدوياً (سيتعلّم القارئ)</small>');
    beep(300, 150);
  }

  let pending = null;
  function askConfirm(n, glyphs) {
    const box = $('confirmBox');
    if (!box) {                                   // older page without the box
      if (confirm(`هل الرقم ${n} صحيح؟`)) { learn(glyphs, n); add(n, 'cam'); }
      return;
    }
    pending = { n, glyphs };
    confirmOpen = true;
    $('confirmNum').textContent = n;
    box.hidden = false;
    showResult('idle', 'تأكد من الرقم ↓');
    beep(700, 100);
  }
  function closeConfirm() {
    const box = $('confirmBox');
    if (box) box.hidden = true;
    confirmOpen = false;
    pending = null;
  }
  function onConfirm(act) {
    if (!pending) return closeConfirm();
    const { n, glyphs } = pending;
    closeConfirm();
    if (act === 'yes') {
      learn(glyphs, n);
      readsByNumber[n] = glyphs;
      lastHit = { n, seen: Date.now() };
      add(n, 'cam');
    } else if (act === 'edit') {
      const v = cleanManual(prompt('اكتب رقم الفاتورة الصحيح:', n));
      if (!v) return;
      learn(glyphs, v);
      lastHit = { n: v, seen: Date.now() };
      add(v, 'manual');
    } else {
      showResult('idle', 'وجّه الكاميرا على سطر DN واضغط 📸');
    }
  }

  // Phone's own camera app (sharper on weak phones): take a photo, then tap the DN number.
  let nativeImg = null;
  // The phone photo is shrunk once (iPhone photos are 12 MP: slow and heavy to read),
  // kept only in memory while the user taps, then dropped.
  let nativeBusy = false;
  function openNativePhoto(file) {
    showResult('idle', '⏳ جاري فتح الصورة…');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2000;
      const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const src = document.createElement('canvas');
      src.width = Math.round(img.naturalWidth * sc);
      src.height = Math.round(img.naturalHeight * sc);
      src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
      URL.revokeObjectURL(url);
      nativeImg = src;
      const cv = $('photoCanvas');
      const vw = Math.min(window.innerWidth, 900);
      cv.width = vw;
      cv.height = Math.round(src.height * vw / src.width);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      const hint = $('photoHint');
      if (hint) hint.textContent = 'المس رقم السند (DN) في الصورة';
      paused = true;                                // the live camera rests meanwhile
      $('photoView').hidden = false;
      showResult('idle', 'المس رقم السند في الصورة');
    };
    img.onerror = () => { URL.revokeObjectURL(url); showResult('err', 'تعذّر فتح الصورة'); };
    img.src = url;
  }
  // Find the printed line nearest to (ix, iy): dark-pixel profile of the rows around the tap.
  // Returns { cy, lh } (centre and height of the line, in photo pixels) or null.
  function locateLine(src, ix, iy) {
    const W = src.width, H = src.height;
    const x0 = Math.max(0, Math.round(ix - 0.3 * W)), x1 = Math.min(W, Math.round(ix + 0.3 * W));
    const y0 = Math.max(0, Math.round(iy - 0.06 * H)), y1 = Math.min(H, Math.round(iy + 0.06 * H));
    const rw = x1 - x0, rh = y1 - y0;
    if (rw < 20 || rh < 20) return null;
    crop.width = rw; crop.height = rh;
    cctx.drawImage(src, x0, y0, rw, rh, 0, 0, rw, rh);
    const d = cctx.getImageData(0, 0, rw, rh).data;
    let mean = 0;
    const g = new Float32Array(rw * rh);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) { g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; mean += g[j]; }
    mean /= g.length;
    const row = new Float32Array(rh);
    let max = 0;
    for (let y = 0; y < rh; y++) {
      let n = 0;
      for (let x = 0; x < rw; x++) if (g[y * rw + x] < mean * 0.7) n++;
      row[y] = n; if (n > max) max = n;
    }
    if (!max) return null;
    // Runs of "text rows" (small gaps allowed); pick the run nearest the tap.
    const on = (y) => row[y] > max * 0.12;
    const runs = [];
    for (let y = 0; y < rh; y++) {
      if (!on(y)) continue;
      let e = y;
      while (e + 1 < rh && (on(e + 1) || (e + 2 < rh && on(e + 2)))) e++;
      runs.push([y, e]);
      y = e;
    }
    const ty = iy - y0;
    let best = null, bd = Infinity;
    for (const [a, b] of runs) {
      if (b - a < 4) continue;
      const dd = ty < a ? a - ty : ty > b ? ty - b : 0;
      if (dd < bd) { bd = dd; best = [a, b]; }
    }
    if (!best) return null;
    return { cy: y0 + (best[0] + best[1]) / 2, lh: best[1] - best[0] + 1 };
  }

  async function readAtTap(e) {
    if (!nativeImg || nativeBusy) return;
    nativeBusy = true;
    const cv = $('photoCanvas');
    const r = cv.getBoundingClientRect();
    const W = nativeImg.width, H = nativeImg.height;
    const ix = (e.clientX - r.left) / r.width * W;
    const iy = (e.clientY - r.top) / r.height * H;
    const hint = $('photoHint');
    if (hint) hint.textContent = '⏳ جاري القراءة…';
    await sleep(30);                                // let the message show
    const reads = [];
    const t0 = Date.now();
    const agreed = () => {
      const sure = reads.filter((x) => x.inv && x.sure);
      return sure.some((x) => sure.filter((y) => y.inv === x.inv).length >= 2);
    };
    // 1) Crop exactly around the line nearest the finger.
    const line = locateLine(nativeImg, ix, iy);
    if (line) {
      // The finger may be on "DN" or on the last digits: also try crops shifted right/left.
      const tries = [[0.45, 0], [0.6, 0], [0.35, 0], [0.5, 0.18], [0.5, -0.18], [0.6, 0.25], [0.6, -0.25]];
      for (const k of [2.6, 2.1, 3.3]) {
        for (const [wf, dx] of tries) {
          const h = k * line.lh, w = wf * W, cx = ix + dx * W;
          // Keep the printed line about 50 px tall for the reader (more detail = fewer mistakes).
          const workH = Math.round(50 * k);
          const g = cropGray(nativeImg, cx - w / 2, line.cy - h / 2, w, h, Math.max(160, workH));
          let rd = null;
          if (g) { try { rd = DNDigits.read(g, templates, invLen(), 1.2, workH); } catch (err) { rd = null; } }
          if (rd) reads.push(rd);
        }
        if (agreed()) break;
      }
    }
    // 2) Otherwise a wider search of sizes and offsets around the tap.
    outer:
    for (const hf of agreed() ? [] : [0.04, 0.055, 0.03, 0.075, 0.022, 0.016]) {
      for (const wf of [0.45, 0.6, 0.35]) {
        for (const dy of [0, -0.3, 0.3]) {
          const h = hf * H, w = wf * W;
          const rd = tryRead(cropGray(nativeImg, ix - w / 2, iy - h / 2 + dy * h, w, h, 160));
          if (rd) reads.push(rd);
          // Stop early once two confident reads agree, or after ~4 s.
          if (agreed() || Date.now() - t0 > 4000) break outer;
        }
        await sleep(0);                             // keep the screen responsive
      }
    }
    nativeBusy = false;
    window.__lastReads = reads.map((x) => x.text + (x.sure ? ' SURE' : ''));   // for diagnosis
    window.__lastLine = line;
    closePhoto();
    unlockAudio();
    decide(reads);
  }
  function closePhoto() {
    $('photoView').hidden = true;
    nativeImg = null;                               // the photo is not kept
    paused = false;
    if ($('btnPause')) $('btnPause').textContent = '⏸';
    resumeAfterNative();
  }
  // The phone's camera app cannot focus well while this page still holds the camera,
  // so the live camera is stopped first and restarted when the user comes back.
  let resumeLive = false;
  function openNativeCamera() {
    const i = $('nativeCam');
    if (!i) return;
    resumeLive = running;
    if (running) stopCamera();
    showResult('idle', 'صوّر من مسافة 20–30 سم حتى لا تكون الصورة مغبّشة');
    i.click();
  }
  function resumeAfterNative() {
    if (!resumeLive) return;
    resumeLive = false;
    if (!running) startCamera(true);
  }

  // Tap on the live picture -> focus there (where the phone supports it).
  function tapFocus(e) {
    if (!camTrack || !camTrack.getCapabilities) return;
    const caps = camTrack.getCapabilities();
    const r = e.currentTarget.getBoundingClientRect();
    const adv = { pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] };
    if (caps.focusMode && caps.focusMode.includes('single-shot')) adv.focusMode = 'single-shot';
    camTrack.applyConstraints({ advanced: [adv] }).catch(() => {});
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      setTimeout(() => camTrack && camTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}), 2500);
    }
    const ring = $('focusRing');
    if (ring) {
      const cr = $('cam').getBoundingClientRect();
      ring.style.left = (e.clientX - cr.left) + 'px';
      ring.style.top = (e.clientY - cr.top) + 'px';
      ring.hidden = false;
      setTimeout(() => { ring.hidden = true; }, 700);
    }
  }

  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('btnShot', 'click', takeShot);
  on('confirmYes', 'click', () => onConfirm('yes'));
  on('confirmEdit', 'click', () => onConfirm('edit'));
  on('confirmNo', 'click', () => onConfirm('no'));
  on('btnNative', 'click', openNativeCamera);
  on('nativeCam', 'change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) openNativePhoto(f); else resumeAfterNative(); });
  on('nativeCam', 'cancel', resumeAfterNative);
  // Older browsers have no 'cancel' event: resume when the page gets focus back without a photo.
  window.addEventListener('focus', () => setTimeout(() => {
    if (resumeLive && $('photoView').hidden && !nativeBusy) resumeAfterNative();
  }, 1500));
  on('photoCanvas', 'click', readAtTap);
  on('photoClose', 'click', closePhoto);
  on('video', 'click', tapFocus);

  let torchOn = false;
  function setupTrackTools(track) {
    camTrack = track || null;
    if (track) {
      const revive = () => {
        if (!running || track !== camTrack) return;
        stopCamera();
        setTimeout(() => startCamera(true), 300);
      };
      track.addEventListener('ended', revive);
      track.addEventListener('mute', () => setTimeout(() => { if (track.muted) revive(); }, 1500));
    }
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
      // Phones cannot focus closer than ~15-20 cm: start at x2 so the DN line is big
      // while the phone stays far enough to be sharp. The user's last choice is remembered.
      const want = Number(state.settings.zoom) || 2;
      const zv = Math.min(Number(z.max), Math.max(caps.zoom.min, want));
      z.value = zv;
      track.applyConstraints({ advanced: [{ zoom: zv }] }).catch(() => {});
      z.hidden = false;
      z.oninput = () => track.applyConstraints({ advanced: [{ zoom: Number(z.value) }] }).catch(() => {});
      z.onchange = () => { state.settings.zoom = Number(z.value); save(); };
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

  $('btnStart').addEventListener('click', () => startCamera());
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
    const lc = $('learnCount');
    if (lc) lc.textContent = String(learned.length);
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
  const resetBtn = $('btnResetLearn');
  if (resetBtn) resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!confirm('مسح كل ما تعلّمه القارئ على هذا الجهاز؟')) return;
    learned = [];
    try { localStorage.removeItem(LEARN_KEY); } catch (err) { /* ignore */ }
    loadTemplates();
    $('learnCount').textContent = '0';
  });

  render();
  loadTemplates();

  window.__dn = { decide, takeShot, askConfirm, extract, add, state: () => state, grab, handleRead, learned: () => learned.length, templates: () => templates.length };
})();
