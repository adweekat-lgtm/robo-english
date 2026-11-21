/* عمو أحمد يعلّمني الإنجليزي — منطق التطبيق (بدون مكتبات) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app');
  const main = $('#main');
  const robotEl = $('#robot');
  const bubble = $('#bubble');
  const overlay = $('#overlay');
  const LEVELS = window.LEVELS;
  const getLevel = (id) => LEVELS.find((l) => l.id === id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PRAISE = [
    ['Excellent!', 'ممتاز!'], ['Super!', 'رائع!'], ['Great job!', 'أحسنت!'],
    ['Wonderful!', 'عظيم!'], ['Well done!', 'برافو عليك!'],
  ];

  /* =====================================================================
   * التقدم (يُحفظ في جهاز الطفل فقط)
   * ===================================================================== */
  // كل طفل له ملف (اسم + صورة + نجومه). الإعدادات مشتركة على مستوى الجهاز.
  const STORAGE_KEY = 'robo-english-v2';
  const OLD_KEY = 'robo-english-progress-v1'; // نسخة ما قبل الملفات — تُنقل تلقائياً
  const AVATARS = ['🦁', '🐼', '🦊', '🐯', '🐸', '🐵', '🦄', '🐨', '🐰', '🐻', '🐙', '🦖'];
  const COLORS = ['#FF6B6B', '#FF9F43', '#1DD1A1', '#48DBFB', '#7C5CFF', '#F368E0'];
  const MAX_PROFILES = 6;
  const defaultSettings = () => ({ arabicVoice: true, slow: true });
  const newProfile = (name, avatar, color) => ({
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name, avatar, color: color || COLORS[0], nameEn: '', levels: {}, celebrated: [],
  });
  let store = loadStore();
  let progress = currentProfile(); // ملف الطفل الحالي (أو null قبل الاختيار)

  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.profiles)) return { ...s, settings: { ...defaultSettings(), ...s.settings } };
    } catch (e) { /* storage unavailable */ }
    const st = { profiles: [], currentId: null, settings: defaultSettings() };
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && old.levels) {
        st.settings = { ...st.settings, ...old.settings };
        if (Object.keys(old.levels).length || old.childName) {
          const p = newProfile(old.childName || 'بطلي', '🦁');
          p.levels = old.levels;
          p.nameEn = old.childName || '';
          p.celebrated = old.celebrated || [];
          st.profiles.push(p);
        }
      }
    } catch (e) { /* ignore */ }
    return st;
  }
  function currentProfile() { return store.profiles.find((p) => p.id === store.currentId) || null; }
  function selectProfile(id) {
    store.currentId = id;
    progress = currentProfile();
    saveProgress();
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
    updateStarCount();
  }
  /** يشغّل fn وكأن الملف p هو الحالي (لحساب نجوم كل طفل في شاشة الاختيار) */
  function withProfile(p, fn) {
    const saved = progress;
    progress = p;
    try { return fn(); } finally { progress = saved; }
  }
  const isLatin = (str) => /^[A-Za-z][A-Za-z' -]*$/.test(String(str || '').trim());
  /** الاسم الذي يستطيع الصوت الإنجليزي نطقه (من الميكروفون أو إن كُتب بحروف إنجليزية) */
  const spokenName = () => (progress ? (progress.nameEn || (isLatin(progress.name) ? progress.name.trim() : '')) : '');

  function lp(id) {
    if (!progress.levels[id]) progress.levels[id] = { heard: [], spoken: [], gameBest: 0, chat: false };
    return progress.levels[id];
  }
  const gameStarNeeded = (L) => Math.ceil(L.words.length * 0.6);
  function activityDone(L) {
    const p = lp(L.id);
    return {
      learn: L.words.every((w) => p.heard.includes(w.id)),
      play: p.gameBest >= gameStarNeeded(L),
      talk: !!p.chat,
    };
  }
  function levelStars(L) {
    if (!L.ready) return 0;
    const d = activityDone(L);
    return (d.learn ? 1 : 0) + (d.play ? 1 : 0) + (d.talk ? 1 : 0);
  }
  function isUnlocked(L) {
    if (!L.ready) return false;
    if (L.id === 1) return true;
    const prev = getLevel(L.id - 1);
    return !!prev && levelStars(prev) === 3;
  }
  function totalStars() {
    return LEVELS.reduce((sum, L) => sum + (L.ready ? levelStars(L) + lp(L.id).spoken.length : 0), 0);
  }
  function updateStarCount() {
    $('#starCount').textContent = progress ? totalStars() : 0;
    const pb = $('#profileBtn');
    if (pb) {
      pb.textContent = progress ? progress.avatar : '👤';
      pb.style.background = progress ? progress.color : '';
      pb.setAttribute('aria-label', progress ? `الطفل: ${progress.name} — اضغط للتبديل` : 'اختر الطفل');
    }
  }

  /* =====================================================================
   * الأصوات: نطق (Text-to-Speech) + أصوات مكافأة صغيرة
   * ===================================================================== */
  const synth = window.speechSynthesis || null;
  let voices = [];
  function loadVoices() { if (synth) voices = synth.getVoices() || []; }
  if (synth) {
    loadVoices();
    if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
  }
  const VOICE_PREF = {
    en: ['Google US English', 'Samantha', 'Microsoft Jenny', 'Microsoft Aria', 'Karen', 'Google UK English Female', 'Moira'],
    ar: ['Google العربية', 'Majed', 'Maged', 'Laila', 'Tarik', 'Microsoft Hamed', 'Microsoft Zariyah', 'Microsoft Salma'],
  };
  function pickVoice(lang) {
    const base = lang.slice(0, 2).toLowerCase();
    const cand = voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base));
    for (const name of VOICE_PREF[base] || []) {
      const v = cand.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return cand.find((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) || cand[0] || null;
  }
  const hasArabicVoice = () => !!pickVoice('ar-SA');

  function setRobot(cls, on) { robotEl.classList.toggle(cls, on); }
  function robotMood(cls, ms = 1000) {
    robotEl.classList.remove(cls);
    void robotEl.offsetWidth; // restart the animation
    robotEl.classList.add(cls);
    setTimeout(() => robotEl.classList.remove(cls), ms);
  }

  let speakSeq = 0;
  function speak(text, opts = {}) {
    const { lang = 'en-US', pitch = 1.15, robot = true } = opts;
    return new Promise((resolve) => {
      if (!synth || !text) { resolve(); return; }
      const my = ++speakSeq;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = pickVoice(lang);
      if (v) u.voice = v;
      u.rate = opts.rate || (lang.startsWith('en') ? (store.settings.slow ? 0.72 : 0.92) : 1);
      u.pitch = pitch;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        if (robot && my === speakSeq) setRobot('talking', false);
        resolve();
      };
      // بعض المتصفحات لا تُطلق onend أحياناً — مؤقّت احتياطي
      const guard = setTimeout(finish, 1500 + (text.length * 120) / u.rate);
      u.onend = finish;
      u.onerror = finish;
      if (robot) setRobot('talking', true);
      synth.cancel();
      setTimeout(() => { if (!finished) synth.speak(u); }, 60);
    });
  }

  let saySeq = 0;
  let lastSay = null;
  function setBubble(en, ar) {
    $('.b-en', bubble).textContent = en || '';
    $('.b-ar', bubble).textContent = ar || '';
  }
  /** عمو أحمد يقول جملة بالإنجليزي، ثم (اختيارياً) الشرح بالعربي. يُرجع false إذا قوطِع. */
  async function say(en, ar, opts = {}) {
    lastSay = { en, ar, opts };
    setBubble(en, ar);
    const my = ++saySeq;
    await speak(en, opts);
    if (my !== saySeq) return false;
    if (ar && opts.arabic !== false && store.settings.arabicVoice && hasArabicVoice()) {
      await wait(150);
      if (my !== saySeq) return false;
      await speak(ar, { lang: 'ar-SA', pitch: 1.1 });
    }
    return my === saySeq;
  }
  function hush() {
    saySeq++;
    speakSeq++;
    if (synth) synth.cancel();
    setRobot('talking', false);
  }
  bubble.addEventListener('click', () => { if (lastSay) say(lastSay.en, lastSay.ar, lastSay.opts); });

  // أصوات مكافأة بسيطة عبر Web Audio (بدون ملفات)
  let audioCtx = null;
  function tone(freqs, dur = 0.12, type = 'sine', gain = 0.12) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      let t = audioCtx.currentTime;
      for (const f of freqs) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur * 0.9;
      }
    } catch (e) { /* no audio */ }
  }
  const sfx = {
    tap: () => tone([660], 0.07, 'triangle', 0.08),
    good: () => tone([523, 659, 784, 1047], 0.13, 'triangle'),
    bad: () => tone([300, 220], 0.16, 'sine', 0.1),
    win: () => tone([523, 659, 784, 659, 784, 1047], 0.14, 'triangle'),
  };

  /* =====================================================================
   * التعرّف على الكلام (الميكروفون)
   * ===================================================================== */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let activeRec = null;

  let activeListen = null;
  /**
   * يستمع للطفل ويُرجع ما سمعه. لا يعتمد أبداً على onend، لأن Safari في الآيفون
   * أحياناً لا يُطلقه (فيعلق الزر على «أسمعك…»):
   *  - ننهي فوراً عند نتيجة نهائية، أو عند نتيجة جزئية تطابق المطلوب (match)،
   *  - وبعد المهلة نطلب stop()، وإن لم يرد المتصفح خلال ثانية ننهي بأنفسنا.
   */
  function listen({ timeoutMs = 6000, match = null } = {}) {
    return new Promise((resolve) => {
      if (!SR) { resolve({ error: 'unsupported', texts: [] }); return; }
      hush();
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 5;
      const texts = [];
      let settled = false;
      let hard = null;
      const finish = (res = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        clearTimeout(hard);
        activeListen = null;
        setRobot('listening', false);
        try { rec.abort(); } catch (e) { /* ignore */ }
        resolve({ ...res, texts: [...new Set(texts.map((t) => t.trim()).filter(Boolean))] });
      };
      rec.onresult = (e) => {
        let final = false;
        for (let i = e.resultIndex || 0; i < e.results.length; i++) {
          const r = e.results[i];
          for (let j = 0; j < r.length; j++) texts.push(r[j].transcript);
          if (r.isFinal) final = true;
        }
        if (final || (match && match(texts))) finish();
      };
      rec.onerror = (e) => finish({ error: e.error });
      rec.onend = () => finish();
      const guard = setTimeout(() => {
        try { rec.stop(); } catch (e) { /* ignore */ }
        hard = setTimeout(() => finish(), 1200);
      }, timeoutMs);
      activeListen = { cancel: () => finish({ cancelled: true }) };
      try {
        rec.start();
        setRobot('listening', true);
      } catch (e) {
        finish({ error: 'start-failed' });
      }
    });
  }
  function stopListening() { if (activeListen) activeListen.cancel(); }

  function micErrorMessage(err) {
    if (err === 'not-allowed' || err === 'service-not-allowed') return 'اسمح للتطبيق باستخدام الميكروفون من إعدادات المتصفح 🎤';
    if (err === 'network') return 'التعرّف على الصوت يحتاج إنترنت. تأكد من الاتصال 📶';
    if (err === 'audio-capture') return 'لم نجد ميكروفون في هذا الجهاز 🎤';
    return '';
  }

  const norm = (s) => String(s).toLowerCase().replace(/[’]/g, "'").replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  /** هل نطق الطفل الكلمة؟ (متسامح قليلاً لأن نطق الأطفال غير مثالي) */
  function heardWord(texts, word) {
    const targets = [word.en, ...(word.alts || [])].map(norm);
    for (const t of texts) {
      const tokens = norm(t).split(' ');
      for (const tok of tokens) {
        if (targets.includes(tok)) return true;
        const base = norm(word.en);
        if (base.length >= 3 && lev(tok, base) <= (base.length <= 4 ? 1 : 2)) return true;
      }
    }
    return false;
  }
  function heardKeys(texts, keys) {
    return texts.some((t) => {
      const n = ` ${norm(t)} `;
      return keys.some((k) => n.includes(` ${norm(k)} `));
    });
  }

  /* =====================================================================
   * واجهة مساعدة: إشعار، احتفال، نافذة
   * ===================================================================== */
  let toastTimer = null;
  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function confetti(n = 70) {
    const box = $('#confetti');
    const colors = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#C77DFF', '#FF9F43'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = pick(colors);
      c.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
      c.style.animationDelay = `${Math.random() * 0.5}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(c);
      setTimeout(() => c.remove(), 4200);
    }
  }
  function openSheet(html, onClose) {
    overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close" type="button" aria-label="إغلاق">✕</button>${html}</div>`;
    overlay.hidden = false;
    overlay._onClose = onClose || null;
    $('.close', overlay).addEventListener('click', closeSheet);
    return $('.sheet', overlay);
  }
  function closeSheet() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    overlay.innerHTML = '';
    stopListening();
    const cb = overlay._onClose;
    overlay._onClose = null;
    if (cb) cb();
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

  /** زر الميكروفون: يستمع ويستدعي check(texts) ⇒ true/false */
  async function micAttempt(btn, resultEl, check, { early = true } = {}) {
    if (btn.classList.contains('listening')) { stopListening(); return null; }
    if (!SR) {
      toast('الميكروفون غير مدعوم في هذا المتصفح. استخدم Chrome على أندرويد أو Safari على آيفون. الآن: قلها بصوت عالٍ! 🗣️', 5000);
      return 'unsupported';
    }
    const label = btn.innerHTML;
    btn.classList.add('listening');
    btn.innerHTML = '👂 أسمعك… تكلّم';
    resultEl.className = 'result';
    resultEl.textContent = '';
    const res = await listen({ match: early ? check : null });
    btn.classList.remove('listening');
    btn.innerHTML = label;
    if (res.cancelled) return null;
    // الآيفون يحتاج لحظة ليعيد الصوت للسماعة بعد الميكروفون، وإلا قد لا يُسمع كلام عمو أحمد
    await wait(350);
    const errMsg = micErrorMessage(res.error);
    if (errMsg) { toast(errMsg, 5000); return null; }
    if (!res.texts.length) {
      resultEl.className = 'result no';
      resultEl.textContent = 'لم أسمع شيئاً… اقترب وتكلّم بصوت أعلى 🙂';
      return false;
    }
    return check(res.texts);
  }

  /* =====================================================================
   * التنقل (hash router) — يدعم زر الرجوع في الجوال
   * ===================================================================== */
  let started = false;
  let screenCleanup = null;

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  function parentOf(hash) {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'level' && parts.length > 2) return `#/level/${parts[1]}`;
    if (parts[0] === 'profiles' && parts.length > 1) return '#/profiles';
    if (parts[0] === 'profiles' && !progress) return '#/profiles';
    return '#/home';
  }
  $('#backBtn').addEventListener('click', () => { sfx.tap(); go(parentOf(location.hash)); });
  // إن كانت index.html قديمة من الكاش وليس فيها زر الطفل، ننشئه (حتى لا يتوقف التطبيق)
  if (!$('#profileBtn')) {
    const pb = document.createElement('button');
    pb.id = 'profileBtn';
    pb.className = 'icon-btn profile-btn';
    pb.type = 'button';
    $('.topbar').appendChild(pb);
  }
  $('#profileBtn').addEventListener('click', () => { sfx.tap(); go('#/profiles'); });
  window.addEventListener('hashchange', route);

  function setScreen(title, isHome = false) {
    $('#title').textContent = title;
    app.classList.remove('is-splash');
    app.classList.toggle('is-home', isHome);
    window.scrollTo(0, 0);
  }

  function route() {
    hush();
    stopListening();
    closeSheet();
    if (screenCleanup) { screenCleanup(); screenCleanup = null; }
    if (!started) { renderSplash(); return; }
    const [p0, p1, p2] = location.hash.replace(/^#\/?/, '').split('/');
    if (p0 === 'profiles' && p1 === 'new') return renderProfileForm(null);
    if (p0 === 'profiles' && p1 === 'edit' && p2) {
      const prof = store.profiles.find((x) => x.id === p2);
      return prof ? renderProfileForm(prof) : go('#/profiles');
    }
    if (p0 === 'profiles' || !progress) return renderProfiles();
    if (p0 === 'level' && p1) {
      const L = getLevel(Number(p1));
      if (!L || !isUnlocked(L)) { go('#/home'); return; }
      if (p2 === 'learn') return renderLearn(L);
      if (p2 === 'play') return renderGame(L);
      if (p2 === 'talk') return renderChat(L);
      return renderLevel(L);
    }
    renderHome();
  }

  /* =====================================================================
   * الشاشات
   * ===================================================================== */
  function renderSplash() {
    app.classList.add('is-splash');
    main.innerHTML = `
      <div class="splash screen">
        <div class="robot">${robotEl.innerHTML}</div>
        <h1>عمو أحمد يعلّمني الإنجليزي<span class="en-text" dir="ltr">English with Uncle Ahmad</span></h1>
        <p>تعلّم، العب، وتكلّم مع صديقك الروبوت!</p>
        <button class="btn green" id="startBtn" type="button">▶ ابدأ</button>
      </div>`;
    $('#startBtn').addEventListener('click', () => {
      started = true;
      sfx.good();
      // أول نطق يجب أن يكون بعد لمسة من المستخدم (شرط في iOS)
      if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
      // كل مرة يُفتح التطبيق: يختار الطفل ملفه أولاً
      go(store.profiles.length ? '#/profiles' : '#/profiles/new');
    });
  }

  /* ---------- ملفات الأطفال: من سيلعب؟ ---------- */
  let editMode = false;
  function renderProfiles() {
    if (!store.profiles.length) { go('#/profiles/new'); return; }
    setScreen('من سيلعب؟ 👫', !progress);
    const tiles = store.profiles.map((p) => {
      const stars = withProfile(p, totalStars);
      return `
        <button class="profile-tile ${p.id === store.currentId ? 'current' : ''}" style="--c:${p.color}" data-id="${p.id}" type="button">
          ${editMode ? '<span class="edit-badge">✏️</span>' : ''}
          <span class="p-avatar">${p.avatar}</span>
          <span class="p-name" dir="auto">${esc(p.name)}</span>
          <span class="p-stars">⭐ ${stars}</span>
        </button>`;
    }).join('');
    const canAdd = store.profiles.length < MAX_PROFILES;
    main.innerHTML = `
      <div class="screen">
        <div class="section-title">${editMode ? '✏️ اضغط على الطفل لتعديل اسمه أو صورته' : 'اضغط على صورتك 👇'}</div>
        <div class="profiles">
          ${tiles}
          ${canAdd ? '<button class="profile-tile add" id="addProfile" type="button"><span class="p-avatar">➕</span><span class="p-name">طفل جديد</span></button>' : ''}
        </div>
        <div class="home-actions">
          <button class="btn white" id="editToggle" type="button">${editMode ? '✅ تم' : '✏️ تعديل الملفات'}</button>
        </div>
      </div>`;
    main.querySelectorAll('.profile-tile[data-id]').forEach((t) => t.addEventListener('click', () => {
      sfx.tap();
      if (editMode) { go(`#/profiles/edit/${t.dataset.id}`); return; }
      selectProfile(t.dataset.id);
      greetOnHome = true;
      go('#/home');
    }));
    const add = $('#addProfile');
    if (add) add.addEventListener('click', () => { sfx.tap(); editMode = false; go('#/profiles/new'); });
    $('#editToggle').addEventListener('click', () => { sfx.tap(); editMode = !editMode; renderProfiles(); });
    robotMood('wave', 1500);
    say('Who is playing today?', 'مين بيلعب اليوم؟ اضغط على صورتك!');
  }

  function renderProfileForm(prof) {
    const isNew = !prof;
    editMode = false;
    setScreen(isNew ? 'طفل جديد ✨' : 'تعديل الملف ✏️', isNew && !store.profiles.length);
    const used = new Set(store.profiles.filter((p) => p !== prof).map((p) => p.avatar));
    let avatar = prof ? prof.avatar : (AVATARS.find((a) => !used.has(a)) || AVATARS[0]);
    main.innerHTML = `
      <div class="screen">
        <label class="field-label" for="nameInput">✍️ اكتب اسم الطفل</label>
        <input id="nameInput" class="name-input" type="text" maxlength="20" autocomplete="off" dir="auto"
          placeholder="مثلاً: سارة" value="${prof ? esc(prof.name) : ''}">
        <div class="hint">💡 إذا كتبته بالإنجليزي (Sara) سيناديه عمو أحمد باسمه بصوته.</div>
        <div class="field-label">🖼️ اختر صورتك</div>
        <div class="avatars">
          ${AVATARS.map((a) => `<button class="avatar-choice ${a === avatar ? 'on' : ''}" data-a="${a}" type="button" aria-label="${a}">${a}</button>`).join('')}
        </div>
        <button class="btn green block" id="saveProfile" type="button">${isNew ? '✅ هيا نبدأ!' : '💾 حفظ'}</button>
        ${isNew ? '' : '<div style="margin-top:14px"><button class="btn white block" id="deleteProfile" type="button">🗑️ حذف هذا الملف</button></div>'}
      </div>`;
    const input = $('#nameInput');
    main.querySelectorAll('.avatar-choice').forEach((b) => b.addEventListener('click', () => {
      sfx.tap();
      avatar = b.dataset.a;
      main.querySelectorAll('.avatar-choice').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#saveProfile').addEventListener('click', () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { sfx.bad(); toast('اكتب الاسم أولاً ✍️'); input.focus(); return; }
      if (isNew) {
        const color = COLORS[store.profiles.length % COLORS.length];
        const p = newProfile(name, avatar, color);
        store.profiles.push(p);
        selectProfile(p.id);
        sfx.good();
        confetti(40);
        greetOnHome = true;
        go('#/home');
      } else {
        if (prof.name !== name) prof.nameEn = ''; // اسم جديد ⇒ ننسى ما التُقط بالصوت
        prof.name = name;
        prof.avatar = avatar;
        saveProgress();
        sfx.good();
        go('#/profiles');
      }
    });
    const del = $('#deleteProfile');
    if (del) del.addEventListener('click', () => {
      if (!confirm(`حذف ملف ${prof.name} وكل نجومه؟ لا يمكن التراجع.`)) return;
      store.profiles = store.profiles.filter((p) => p !== prof);
      if (store.currentId === prof.id) { store.currentId = null; progress = null; }
      saveProgress();
      go('#/profiles');
    });
    if (isNew) say('Hello! What is your name?', 'أهلاً! اكتب اسمك واختر صورتك.');
    else setBubble('Change your name or picture.', 'غيّر الاسم أو الصورة ثم اضغط حفظ.');
  }

  let greetOnHome = true;
  function renderHome() {
    setScreen('عمو أحمد 🤖', true);
    const current = LEVELS.filter((L) => isUnlocked(L)).filter((L) => levelStars(L) < 3)[0];
    const tiles = LEVELS.map((L) => {
      const unlocked = isUnlocked(L);
      const stars = levelStars(L);
      const lock = !L.ready ? '<span class="lock">🔒 قريباً</span>' : !unlocked ? '<span class="lock">🔒 أكمل السابق</span>' : '';
      return `
        <button class="level-tile ${unlocked ? '' : 'locked'} ${current === L ? 'current' : ''}" style="--c:${L.color}" data-id="${L.id}" type="button">
          <span class="num">${L.id}</span>
          <span class="ico">${L.icon}</span>
          <span class="t-ar">${esc(L.titleAr)}</span>
          <span class="t-en" dir="ltr">${esc(L.title)}</span>
          ${unlocked ? `<span class="lstars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : lock}
        </button>`;
    }).join('');
    main.innerHTML = `
      <div class="screen">
        <div class="section-title">اختر مستوى 🗺️</div>
        <div class="levels">${tiles}</div>
        <div class="home-actions">
          <button class="btn white" id="switchBtn" type="button">${progress.avatar} تغيير الطفل</button>
          <button class="btn white" id="settingsBtn" type="button">⚙️ الإعدادات</button>
          <button class="btn white" id="installBtn" type="button" ${canShowInstall() ? '' : 'hidden'}>📲 ثبّت التطبيق</button>
        </div>
      </div>`;
    main.querySelectorAll('.level-tile').forEach((tile) => tile.addEventListener('click', () => {
      const L = getLevel(Number(tile.dataset.id));
      if (isUnlocked(L)) { sfx.tap(); go(`#/level/${L.id}`); return; }
      sfx.bad();
      robotMood('wave', 1500);
      if (!L.ready) say('Coming soon!', `المستوى ${L.id} (${L.titleAr}) قادم قريباً! 🚧`, { arabic: true });
      else say('Finish the level before!', 'أكمل المستوى السابق واجمع ٣ نجوم لتفتح هذا المستوى.');
    }));
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#switchBtn').addEventListener('click', () => { sfx.tap(); go('#/profiles'); });
    $('#installBtn').addEventListener('click', doInstall);

    if (greetOnHome) {
      greetOnHome = false;
      robotMood('wave', 1600);
      const n = spokenName();
      say(`Hi${n ? `, ${n}` : ''}! Let's learn English!`, `مرحباً يا ${progress.name}! هيا نتعلم الإنجليزية. اختر مستوى لنبدأ.`);
    } else {
      setBubble('Choose a level!', 'اختر مستوى لنبدأ 👇');
    }
  }

  function renderLevel(L) {
    setScreen(`المستوى ${L.id}`);
    const d = activityDone(L);
    const p = lp(L.id);
    const stars = levelStars(L);
    const acts = [
      { key: 'learn', ico: '🖼️', ar: 'تعلّم الكلمات', en: 'Learn', sub: `<bdi dir="ltr">${p.heard.length} / ${L.words.length}</bdi>`, c: '#FFE3E3' },
      { key: 'play', ico: '🎮', ar: 'العب وابحث', en: 'Play', sub: p.gameBest ? `أفضل نتيجة: <bdi dir="ltr">${p.gameBest} / ${L.words.length}</bdi>` : '', c: '#E3F4FF' },
      { key: 'talk', ico: '💬', ar: 'تكلّم مع عمو أحمد', en: 'Talk', sub: '', c: '#E9FBEF' },
    ];
    main.innerHTML = `
      <div class="screen">
        <div class="level-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <div class="goals"><b>📚 في هذا المستوى ستتعلّم:</b><ul>${L.goalsAr.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>
        <div class="activities">
          ${acts.map((a) => `
            <button class="activity" style="--c:${a.c}" data-key="${a.key}" type="button">
              <span class="a-ico">${a.ico}</span>
              <span class="a-body">
                <span class="a-ar">${a.ar}</span>
                <span class="a-en" dir="ltr">${a.en}</span>
                ${a.sub ? `<span class="a-en">${a.sub}</span>` : ''}
              </span>
              <span class="a-state">${d[a.key] ? '✅' : '◀'}</span>
            </button>`).join('')}
        </div>
      </div>`;
    main.querySelectorAll('.activity').forEach((b) => b.addEventListener('click', () => {
      sfx.tap();
      go(`#/level/${L.id}/${b.dataset.key}`);
    }));
    if (stars === 3) say('You finished this level! Super star!', 'أنهيت هذا المستوى! أنت نجم! ⭐');
    else say(L.intro.en, `${L.intro.ar} ابدأ بـ «تعلّم الكلمات».`);
  }

  /* ---------- تعلّم الكلمات: صور تفاعلية ---------- */
  function renderLearn(L) {
    setScreen('تعلّم الكلمات 🖼️');
    const p = lp(L.id);
    main.innerHTML = `
      <div class="screen">
        <div class="tip">👆 اضغط على الصورة لتسمع الكلمة، ثم اضغط 🎤 وقلها بصوتك!</div>
        <div class="cards">
          ${L.words.map((w) => `
            <button class="pcard ${p.heard.includes(w.id) ? 'heard' : ''}" data-id="${w.id}" type="button" aria-label="${esc(w.en)}">
              <span class="badge">${p.spoken.includes(w.id) ? '⭐' : p.heard.includes(w.id) ? '👂' : ''}</span>
              <span class="emoji">${w.img}</span>
              <span class="word" dir="ltr">${esc(w.en)}</span>
            </button>`).join('')}
        </div>
        <div style="margin-top:18px" id="learnNext"></div>
      </div>`;
    main.querySelectorAll('.pcard').forEach((c) => c.addEventListener('click', () => {
      const w = L.words.find((x) => x.id === c.dataset.id);
      c.classList.remove('bounce'); void c.offsetWidth; c.classList.add('bounce');
      sfx.tap();
      openWord(L, w);
    }));
    refreshLearnFooter(L);
    say('Tap a picture!', 'اضغط على أي صورة لتسمع اسمها بالإنجليزي.');
  }

  function refreshLearnCards(L) {
    const p = lp(L.id);
    main.querySelectorAll('.pcard').forEach((c) => {
      const id = c.dataset.id;
      c.classList.toggle('heard', p.heard.includes(id));
      $('.badge', c).textContent = p.spoken.includes(id) ? '⭐' : p.heard.includes(id) ? '👂' : '';
    });
    refreshLearnFooter(L);
  }
  function refreshLearnFooter(L) {
    const box = $('#learnNext');
    if (!box) return;
    if (activityDone(L).learn) {
      box.innerHTML = '<button class="btn orange block" type="button">🎮 أحسنت! هيا نلعب</button>';
      $('button', box).addEventListener('click', () => go(`#/level/${L.id}/play`));
    } else box.innerHTML = '';
  }

  function openWord(L, w) {
    const p = lp(L.id);
    const firstTime = !p.heard.includes(w.id);
    if (firstTime) { p.heard.push(w.id); saveProgress(); }
    const idx = L.words.indexOf(w);
    const next = L.words[(idx + 1) % L.words.length];
    const sheet = openSheet(`
      <div class="big-emoji">${w.img}</div>
      <div class="big-word" dir="ltr">${esc(w.en)}</div>
      <div class="big-ar">${esc(w.ar)}</div>
      <div class="example"><span class="en-text" dir="ltr">${esc(w.sentence)}</span>${esc(w.sentenceAr)}</div>
      <div class="btn-row">
        <button class="btn white" data-act="hear" type="button">🔊 اسمع</button>
        <button class="btn white" data-act="slow" type="button">🐢 ببطء</button>
      </div>
      <div class="btn-row">
        <button class="btn mic" data-act="mic" type="button">🎤 قلها أنت</button>
      </div>
      <div class="result" aria-live="polite"></div>
      <div class="btn-row"><button class="btn orange" data-act="next" type="button">التالي: ${next.img} ◀</button></div>
    `, () => refreshLearnCards(L));
    const emoji = $('.big-emoji', sheet);
    const resultEl = $('.result', sheet);
    const bounce = () => { emoji.classList.remove('bounce'); void emoji.offsetWidth; emoji.classList.add('bounce'); };
    const intro = async () => {
      bounce();
      if (!(await say(w.en, w.ar, { arabic: false }))) return;
      await wait(250);
      if (!(await say(w.en, w.ar))) return;
      await wait(200);
      say(w.sentence, w.sentenceAr, { arabic: false });
    };
    intro();
    emoji.addEventListener('click', () => { bounce(); say(w.en, w.ar, { arabic: false }); });
    sheet.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'hear') { bounce(); say(w.en, w.ar, { arabic: false }); }
      if (act === 'slow') { bounce(); say(w.en, w.ar, { arabic: false, rate: 0.45 }); }
      if (act === 'next') { sfx.tap(); closeSheet(); openWord(L, next); }
      if (act === 'mic') {
        const btn = e.target.closest('[data-act]');
        const r = await micAttempt(btn, resultEl, (texts) => heardWord(texts, w));
        if (r === 'unsupported') {
          await say(`Say: ${w.en}!`, `قل: ${w.en}`, { arabic: false });
          await wait(2200);
          awardWord();
          return;
        }
        if (r === true) awardWord();
        else if (r === false) {
          sfx.bad();
          if (!resultEl.textContent) {
            resultEl.className = 'result no';
            resultEl.textContent = 'قريب! اسمع مرة ثانية وحاول 💪';
          }
          say(`Almost! Say: ${w.en}`, 'قريب جداً! اسمعني وحاول مرة ثانية.');
        }
      }
    });
    function awardWord() {
      const [en, ar] = pick(PRAISE);
      resultEl.className = 'result ok';
      resultEl.textContent = `${ar} ⭐`;
      sfx.good();
      confetti(40);
      robotMood('happy', 1000);
      if (!p.spoken.includes(w.id)) { p.spoken.push(w.id); saveProgress(); }
      say(`${en} ${w.en}!`, ar, { arabic: false });
      checkLevelComplete(L);
    }
  }

  /* ---------- اللعبة: أين القطة؟ ---------- */
  function renderGame(L) {
    setScreen('العب وابحث 🎮');
    const rounds = shuffle(L.words);
    const results = [];
    let i = 0;
    let locked = false;
    let firstTry = true;

    const draw = () => {
      const target = rounds[i];
      const others = shuffle(L.words.filter((w) => w !== target)).slice(0, 2);
      const options = shuffle([target, ...others]);
      firstTry = true;
      locked = false;
      main.innerHTML = `
        <div class="screen">
          <div class="dots">${rounds.map((_, k) => `<span class="${k < i ? (results[k] ? 'ok' : 'miss') : k === i ? 'now' : ''}"></span>`).join('')}</div>
          <div class="tip">👂 اسمع عمو أحمد، واضغط على الصورة الصحيحة!</div>
          <div class="choices">
            ${options.map((w) => `<button class="choice" data-id="${w.id}" type="button" aria-label="${esc(w.en)}">${w.img}</button>`).join('')}
          </div>
          <div class="replay-row"><button class="btn white" id="replayQ" type="button">🔊 أعد السؤال</button></div>
        </div>`;
      const ask = () => say(`Where is the ${target.en}?`, `أين ${target.arDef}؟`);
      $('#replayQ').addEventListener('click', ask);
      main.querySelectorAll('.choice').forEach((c) => c.addEventListener('click', async () => {
        if (locked) return;
        if (c.dataset.id === target.id) {
          locked = true;
          results[i] = firstTry;
          c.classList.add('right');
          sfx.good();
          robotMood('happy', 900);
          const [en, ar] = pick(PRAISE);
          await say(`${en} It is ${target.phrase}!`, ar, { arabic: false });
          await wait(300);
          if (!main.contains(c)) return; // left the screen
          i++;
          if (i < rounds.length) draw(); else finish();
        } else {
          firstTry = false;
          c.classList.remove('wrong'); void c.offsetWidth; c.classList.add('wrong');
          sfx.bad();
          const w = L.words.find((x) => x.id === c.dataset.id);
          say(`Oops! This is ${w.phrase}. Try again!`, `هذه صورة ${w.ar}. حاول مرة ثانية!`);
        }
      }));
      ask();
    };

    const finish = () => {
      const score = results.filter(Boolean).length;
      const p = lp(L.id);
      p.gameBest = Math.max(p.gameBest, score);
      saveProgress();
      const n = rounds.length;
      const s = score >= n - 1 ? 3 : score >= gameStarNeeded(L) ? 2 : 1;
      sfx.win();
      confetti(80);
      robotMood('happy', 1000);
      main.innerHTML = `
        <div class="screen score">
          <div class="stars3">${'⭐'.repeat(s)}${'☆'.repeat(3 - s)}</div>
          <div class="big" dir="ltr">${score} / ${n}</div>
          <p class="tip">${score >= gameStarNeeded(L) ? 'رائع! حصلت على نجمة اللعبة ⭐' : `تحتاج ${gameStarNeeded(L)} إجابات صحيحة من أول مرة لتحصل على النجمة. حاول مرة ثانية! 💪`}</p>
          <div class="btn-row">
            <button class="btn orange" id="again" type="button">🔄 العب مرة أخرى</button>
            <button class="btn green" id="toTalk" type="button">💬 تكلّم مع عمو أحمد</button>
          </div>
        </div>`;
      $('#again').addEventListener('click', () => renderGame(L));
      $('#toTalk').addEventListener('click', () => go(`#/level/${L.id}/talk`));
      say(score >= gameStarNeeded(L) ? 'You did it! Great game!' : 'Good try! Play again!',
        score >= gameStarNeeded(L) ? 'أحسنت! لعبة رائعة!' : 'محاولة جيدة! هيا نلعب مرة أخرى!');
      checkLevelComplete(L);
    };

    draw();
  }

  /* ---------- المحادثة مع عمو أحمد ---------- */
  function renderChat(L) {
    setScreen('المحادثة 💬');
    main.innerHTML = `
      <div class="screen">
        <div class="tip">💡 عمو أحمد يسألك، وأنت تجيب: اضغط على الجواب، أو اضغط 🎤 وقله بصوتك!</div>
        <div class="chat" id="chatLog"></div>
        <div class="replies" id="replies"></div>
      </div>`;
    const log = $('#chatLog');
    const repliesEl = $('#replies');
    const steps = L.chat;
    let i = 0;
    let alive = true;
    screenCleanup = () => { alive = false; };

    const scrollDown = () => setTimeout(() => repliesEl.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
    const addMsg = (who, en, ar, img) => {
      const m = document.createElement('div');
      m.className = `msg ${who}`;
      m.innerHTML = `
        <span class="who">${who === 'robot' ? '🤖 عمو أحمد' : '🧒 أنت'}</span>
        ${img ? `<span class="m-img">${img}</span>` : ''}
        <span class="m-en" dir="ltr">${esc(en)}</span>
        ${ar ? `<span class="m-ar">${esc(ar)}</span>` : ''}`;
      if (who === 'robot') m.addEventListener('click', () => say(en, ar));
      log.appendChild(m);
      scrollDown();
    };

    const resolveStep = (step) => {
      if (step.type === 'name') {
        // إن كان اسم الطفل معروفاً بالإنجليزي نضعه في زر الجواب
        const n = spokenName();
        return n ? { ...step, replies: [{ ...step.replies[0], en: `My name is ${n}.`, ar: `اسمي ${progress.name}.` }] } : step;
      }
      if (step.type !== 'picture') return step;
      const w = L.words.find((x) => x.id === step.word);
      const wrong = pick(L.words.filter((x) => x !== w));
      return {
        robot: 'What is this?', ar: 'ما هذا؟', img: w.img, word: w,
        replies: shuffle([
          { en: `It is ${w.phrase}.`, ar: `صورة ${w.ar}`, correct: true, word: w },
          { en: `It is ${wrong.phrase}.`, ar: `صورة ${wrong.ar}`, correct: false, word: wrong },
        ]),
      };
    };

    const robotTurn = async () => {
      if (!alive) return;
      if (i >= steps.length) { finish(); return; }
      const step = resolveStep(steps[i]);
      repliesEl.innerHTML = '';
      addMsg('robot', step.robot, step.ar, step.img);
      if (i === 0) robotMood('wave', 1500);
      await say(step.robot, step.ar);
      if (!alive) return;
      showReplies(step);
    };

    const showReplies = (step) => {
      repliesEl.innerHTML = `
        ${step.replies.map((r, k) => `
          <button class="btn white reply" data-k="${k}" type="button">
            <span class="en-text" dir="ltr">${esc(r.en)}</span><small>${esc(r.ar)}</small>
          </button>`).join('')}
        <button class="btn mic mic-big" type="button">🎤 قلها بصوتك</button>
        <div class="result" aria-live="polite"></div>`;
      const resultEl = $('.result', repliesEl);
      repliesEl.querySelectorAll('.reply').forEach((b) => b.addEventListener('click', () => {
        sfx.tap();
        kidAnswer(step, step.replies[Number(b.dataset.k)], null);
      }));
      $('.mic', repliesEl).addEventListener('click', async (e) => {
        let chosen = null;
        let name = null;
        const r = await micAttempt(e.currentTarget, resultEl, (texts) => {
          if (step.type === 'name') {
            name = extractName(texts);
            chosen = step.replies[0];
            return true;
          }
          if (step.word) {
            chosen = step.replies.find((x) => x.correct && heardWord(texts, x.word))
              || step.replies.find((x) => !x.correct && heardWord(texts, x.word));
          } else {
            chosen = step.replies.find((x) => heardKeys(texts, x.keys));
          }
          return !!chosen;
        }, { early: step.type !== 'name' }); // الاسم: ننتظر الجملة كاملة
        if (r === 'unsupported') return;
        if (r === true && chosen) {
          kidAnswer(step, chosen, name, true);
        } else if (r === false) {
          sfx.bad();
          if (!resultEl.textContent) {
            resultEl.className = 'result no';
            resultEl.textContent = 'لم أفهم جيداً… حاول مرة ثانية أو اضغط على الجواب 🙂';
          }
          say('Sorry? Say it again!', 'لم أفهم، قلها مرة ثانية أو اضغط على الجواب.');
        }
      });
      scrollDown();
    };

    const kidAnswer = async (step, reply, name, bySpeech = false) => {
      repliesEl.innerHTML = '';
      let shown = reply.en;
      if (step.type === 'name' && name) {
        shown = `My name is ${name}.`;
        progress.nameEn = name;
        saveProgress();
      }
      addMsg('kid', shown, bySpeech ? '🎤 قلتها بصوتك! ⭐' : reply.ar);
      if (bySpeech) sfx.good();
      if (!bySpeech) await speak(shown.replace('…', ''), { pitch: 1.6, robot: false });
      if (!alive) return;
      await wait(250);

      let after = null;
      if (step.word) {
        const w = step.word;
        if (reply.correct) {
          robotMood('happy', 900);
          const [en, ar] = pick(PRAISE);
          after = { en: `${en} It is ${w.phrase}!`, ar: `${ar} هذه صورة ${w.ar}.` };
        } else {
          after = { en: `Good try! It is ${w.phrase}. Say: ${w.en}!`, ar: `محاولة جيدة! هذه صورة ${w.ar}، وبالإنجليزي: ${w.en}` };
        }
      } else if (step.after) {
        const n = name || spokenName();
        after = { en: step.after.replace('{name}', n ? `, ${n}` : ''), ar: step.afterAr };
      }
      if (after) {
        addMsg('robot', after.en, after.ar);
        await say(after.en, after.ar);
        if (!alive) return;
        await wait(300);
      }
      i++;
      robotTurn();
    };

    const finish = () => {
      const p = lp(L.id);
      p.chat = true;
      saveProgress();
      sfx.win();
      confetti(80);
      robotMood('happy', 1000);
      repliesEl.innerHTML = `
        <div class="tip" style="text-align:center">🎉 أحسنت! أكملت المحادثة مع عمو أحمد وحصلت على نجمة ⭐</div>
        <div class="btn-row">
          <button class="btn orange" id="chatAgain" type="button">🔄 مرة أخرى</button>
          <button class="btn green" id="chatBack" type="button">✅ تم</button>
        </div>`;
      $('#chatAgain').addEventListener('click', () => renderChat(L));
      $('#chatBack').addEventListener('click', () => go(`#/level/${L.id}`));
      scrollDown();
      say('You can talk in English! Great!', 'أنت تستطيع التكلم بالإنجليزية! رائع!');
      checkLevelComplete(L);
    };

    robotTurn();
  }

  function extractName(texts) {
    const STOP = new Set(['is', 'am', 'my', 'name', 'i', 'im', "i'm", 'the', 'a', 'robo', 'uncle', 'ahmad', 'ahmed', 'hello', 'hi']);
    for (const t of texts) {
      const n = norm(t);
      const m = n.match(/(?:my name is|my name's|name is|i am|i'm|im|call me)\s+([a-z']+)/);
      if (m && !STOP.has(m[1])) return cap(m[1]);
    }
    const words = norm(texts[0] || '').split(' ').filter((x) => x && !STOP.has(x));
    return words.length ? cap(words[words.length - 1]) : null;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- إكمال المستوى ---------- */
  function checkLevelComplete(L) {
    if (levelStars(L) < 3 || progress.celebrated.includes(L.id)) return;
    progress.celebrated.push(L.id);
    saveProgress();
    const next = getLevel(L.id + 1);
    setTimeout(() => {
      sfx.win();
      confetti(140);
      robotMood('happy', 1400);
      openSheet(`
        <div class="big-emoji">🏆</div>
        <h2>أنهيت المستوى ${L.id}!</h2>
        <div class="level-stars">⭐⭐⭐</div>
        <p>${next ? (next.ready ? `فتحت المستوى ${next.id}: ${esc(next.titleAr)} ${next.icon}` : `المستوى ${next.id} (${esc(next.titleAr)} ${next.icon}) قادم قريباً! 🚧`) : 'أنهيت كل المستويات! 🎉'}</p>
        <div class="btn-row"><button class="btn green" id="yay" type="button">🎉 رائع!</button></div>`);
      $('#yay').addEventListener('click', () => { closeSheet(); go('#/home'); });
      say('Hooray! You are a super star!', `مبروك! أنهيت المستوى ${L.id}. أنت نجم!`);
    }, 1800);
  }

  /* ---------- الإعدادات ---------- */
  function openSettings() {
    sfx.tap();
    const s = store.settings;
    const sheet = openSheet(`
      <h2>⚙️ الإعدادات</h2>
      <button class="setting" data-k="arabicVoice" type="button"><span>🗣️ عمو أحمد يشرح بصوت عربي<br><small style="color:var(--muted)">${hasArabicVoice() ? '' : 'لا يوجد صوت عربي في هذا الجهاز، سيظهر الشرح مكتوباً'}</small></span><span class="switch ${s.arabicVoice ? 'on' : ''}"></span></button>
      <button class="setting" data-k="slow" type="button"><span>🐢 نطق إنجليزي بطيء</span><span class="switch ${s.slow ? 'on' : ''}"></span></button>
      <p style="text-align:start">👨‍👩‍👧 <b>للأهل:</b> الميكروفون يعمل في Chrome (أندرويد) و Safari (آيفون)، ويحتاج إنترنت للتعرّف على الصوت. التقدم محفوظ على هذا الجهاز فقط.</p>
      <div class="btn-row"><button class="btn white" id="resetBtn" type="button">🗑️ مسح نجوم ${esc(progress.name)} والبدء من جديد</button></div>
      <div class="btn-row"><button class="btn white" id="manageBtn" type="button">👨‍👩‍👧 إدارة ملفات الأطفال</button></div>`);
    sheet.querySelectorAll('.setting').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      s[k] = !s[k];
      $('.switch', b).classList.toggle('on', s[k]);
      saveProgress();
      sfx.tap();
      if (k === 'slow') say('Hello! I am Uncle Ahmad.', '', { arabic: false });
    }));
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm(`هل تريد مسح كل نجوم ${progress.name} وتقدّمه؟`)) return;
      progress.levels = {};
      progress.celebrated = [];
      saveProgress();
      closeSheet();
      greetOnHome = true;
      go('#/home');
    });
    $('#manageBtn').addEventListener('click', () => { closeSheet(); go('#/profiles'); });
  }

  /* ---------- التثبيت كتطبيق (PWA) ---------- */
  let deferredInstall = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canShowInstall = () => !isStandalone() && (!!deferredInstall || isIOS());
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const b = $('#installBtn');
    if (b) b.hidden = false;
  });
  async function doInstall() {
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice.catch(() => {});
      deferredInstall = null;
      const b = $('#installBtn');
      if (b) b.hidden = true;
    } else if (isIOS()) {
      openSheet(`
        <div class="big-emoji">📲</div>
        <h2>ثبّت عمو أحمد على الآيفون</h2>
        <p>١. اضغط زر المشاركة <b>⬆️</b> في أسفل Safari</p>
        <p>٢. اختر <b>«إضافة إلى الشاشة الرئيسية»</b></p>
        <p>٣. اضغط <b>«إضافة»</b> — وسيظهر عمو أحمد مع تطبيقاتك! 🤖</p>`);
    }
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  updateStarCount();
  route();
  window.__roboReady = true;
})();
