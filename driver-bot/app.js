/* مساعد السائق — صفحة السائق
 * ضع هنا رابط تطبيق الويب من Google Apps Script (ينتهي بـ /exec).
 * إذا تُرك فارغاً تعمل الصفحة في «وضع التجربة»: البيانات على الجهاز فقط والأجوبة تجريبية. */
const API_URL = '';

/* ===================== النصوص بثلاث لغات ===================== */
const T = {
  ar: {
    dir: 'rtl', appName: 'مساعد السائق', truckNo: 'رقم الشاحنة', pin: 'الرمز السري', login: 'دخول',
    logout: 'خروج', odometer: 'العداد', km: 'كم', updateKm: 'تحديث العداد', oilChanged: 'غيّرت الزيت',
    left: 'باقي {n} كم على غيار الزيت', soon: 'قرّب غيار الزيت: باقي {n} كم', over: 'تجاوزت موعد غيار الزيت بـ {n} كم! غيّره بأسرع وقت',
    unknownOil: 'لا يوجد تسجيل لآخر غيار زيت. اضغط «غيّرت الزيت» واكتب قراءة العداد وقت الغيار.',
    noKm: 'لم تُسجَّل قراءة العداد بعد.',
    sub: 'آخر غيار: {last} كم ({date}) · الغيار القادم عند {next} كم',
    enterKm: 'اكتب قراءة العداد الآن', enterOilKm: 'اكتب قراءة العداد عند غيار الزيت',
    save: 'حفظ', cancel: 'إلغاء', saved: 'تم الحفظ ✅', oilSaved: 'تم تسجيل غيار الزيت ✅',
    confirmJump: 'القراءة أكبر من السابقة بـ {n} كم. هل أنت متأكد؟ اضغط «حفظ» مرة أخرى للتأكيد.',
    askTitle: 'اسأل المساعد', askPh: 'اكتب سؤالك هنا…', typing: 'يكتب…',
    hello: 'أهلاً {name}! اسألني عن الشاحنة أو التوصيل أو تعليمات الشركة.',
    chips: ['متى موعد غيار الزيت؟', 'ماذا أفعل إذا تعطّلت الشاحنة؟', 'ما هي أوقات الدوام؟'],
    listening: 'أستمع… تكلّم الآن', demo: 'وضع التجربة: البيانات على هذا الجهاز فقط، والأجوبة تجريبية.',
    demoHint: 'للتجربة: الشاحنة 101 والرمز 1234',
    err: {
      bad_login: 'رقم الشاحنة أو الرمز غير صحيح.', locked: 'محاولات كثيرة. انتظر 15 دقيقة.',
      bad_km: 'اكتب رقماً صحيحاً بدون فواصل عشرية.', km_lower: 'القراءة أقل من آخر قراءة ({n} كم). تأكد من الرقم.',
      oil_lower: 'القراءة أقل من آخر غيار مسجّل ({n} كم).', oil_high: 'القراءة أكبر بكثير من العداد الحالي ({n} كم). حدّث العداد أولاً.',
      limit: 'وصلت إلى حد الأسئلة لهذا اليوم. حاول غداً أو اتصل بالمشرف.', ai_busy: 'المساعد مشغول الآن. حاول بعد دقيقة.',
      network: 'لا يوجد اتصال بالإنترنت. حاول مرة أخرى.', empty: 'اكتب سؤالك أولاً.', other: 'حدث خلل. حاول لاحقاً أو أخبر المشرف.',
    },
  },
  en: {
    dir: 'ltr', appName: 'Driver Assistant', truckNo: 'Truck number', pin: 'PIN', login: 'Log in',
    logout: 'Log out', odometer: 'Odometer', km: 'km', updateKm: 'Update odometer', oilChanged: 'I changed the oil',
    left: '{n} km left until oil change', soon: 'Oil change soon: {n} km left', over: 'Oil change overdue by {n} km! Change it as soon as possible',
    unknownOil: 'No oil change recorded yet. Tap “I changed the oil” and enter the odometer reading at that time.',
    noKm: 'No odometer reading yet.',
    sub: 'Last change: {last} km ({date}) · Next change at {next} km',
    enterKm: 'Enter the current odometer reading', enterOilKm: 'Enter the odometer reading at the oil change',
    save: 'Save', cancel: 'Cancel', saved: 'Saved ✅', oilSaved: 'Oil change recorded ✅',
    confirmJump: 'This is {n} km more than the last reading. Are you sure? Tap “Save” again to confirm.',
    askTitle: 'Ask the assistant', askPh: 'Type your question…', typing: 'Typing…',
    hello: 'Hi {name}! Ask me about the truck, deliveries or company rules.',
    chips: ['When is my oil change?', 'What do I do if the truck breaks down?', 'What are the working hours?'],
    listening: 'Listening… speak now', demo: 'Demo mode: data stays on this phone and answers are samples.',
    demoHint: 'Demo: truck 101, PIN 1234',
    err: {
      bad_login: 'Wrong truck number or PIN.', locked: 'Too many tries. Wait 15 minutes.',
      bad_km: 'Enter a whole number.', km_lower: 'Lower than the last reading ({n} km). Check the number.',
      oil_lower: 'Lower than the last recorded oil change ({n} km).', oil_high: 'Much higher than the current odometer ({n} km). Update the odometer first.',
      limit: 'Daily question limit reached. Try tomorrow or call your supervisor.', ai_busy: 'The assistant is busy. Try again in a minute.',
      network: 'No internet connection. Try again.', empty: 'Type your question first.', other: 'Something went wrong. Try later or tell your supervisor.',
    },
  },
  ur: {
    dir: 'rtl', appName: 'ڈرائیور اسسٹنٹ', truckNo: 'ٹرک نمبر', pin: 'پن کوڈ', login: 'داخل ہوں',
    logout: 'باہر نکلیں', odometer: 'میٹر ریڈنگ', km: 'کلومیٹر', updateKm: 'میٹر ریڈنگ درج کریں', oilChanged: 'میں نے تیل بدل دیا',
    left: 'تیل بدلنے میں {n} کلومیٹر باقی ہیں', soon: 'تیل بدلنے کا وقت قریب ہے: {n} کلومیٹر باقی', over: 'تیل بدلنے کا وقت {n} کلومیٹر پہلے گزر گیا! جلد از جلد تیل بدلیں',
    unknownOil: 'ابھی تک تیل کی تبدیلی درج نہیں ہوئی۔ «میں نے تیل بدل دیا» دبائیں اور اس وقت کی میٹر ریڈنگ لکھیں۔',
    noKm: 'ابھی تک میٹر ریڈنگ درج نہیں ہوئی۔',
    sub: 'آخری تبدیلی: {last} کلومیٹر ({date}) · اگلی تبدیلی {next} کلومیٹر پر',
    enterKm: 'ابھی کی میٹر ریڈنگ لکھیں', enterOilKm: 'تیل بدلتے وقت کی میٹر ریڈنگ لکھیں',
    save: 'محفوظ کریں', cancel: 'منسوخ', saved: 'محفوظ ہو گیا ✅', oilSaved: 'تیل کی تبدیلی درج ہو گئی ✅',
    confirmJump: 'یہ پچھلی ریڈنگ سے {n} کلومیٹر زیادہ ہے۔ کیا آپ کو یقین ہے؟ تصدیق کے لیے دوبارہ «محفوظ کریں» دبائیں۔',
    askTitle: 'اسسٹنٹ سے پوچھیں', askPh: 'اپنا سوال یہاں لکھیں…', typing: 'لکھ رہا ہے…',
    hello: 'السلام علیکم {name}! ٹرک، ڈیلیوری یا کمپنی کے قوانین کے بارے میں پوچھیں۔',
    chips: ['تیل کب بدلنا ہے؟', 'اگر ٹرک خراب ہو جائے تو کیا کروں؟', 'کام کے اوقات کیا ہیں؟'],
    listening: 'سن رہا ہوں… اب بولیں', demo: 'ڈیمو موڈ: ڈیٹا صرف اسی فون پر ہے اور جوابات نمونہ ہیں۔',
    demoHint: 'ڈیمو: ٹرک 101، پن 1234',
    err: {
      bad_login: 'ٹرک نمبر یا پن کوڈ غلط ہے۔', locked: 'بہت زیادہ کوششیں۔ 15 منٹ انتظار کریں۔',
      bad_km: 'پورا نمبر لکھیں۔', km_lower: 'یہ آخری ریڈنگ ({n} کلومیٹر) سے کم ہے۔ نمبر چیک کریں۔',
      oil_lower: 'یہ آخری درج شدہ تیل کی تبدیلی ({n} کلومیٹر) سے کم ہے۔', oil_high: 'یہ موجودہ میٹر ریڈنگ ({n} کلومیٹر) سے بہت زیادہ ہے۔ پہلے میٹر ریڈنگ درج کریں۔',
      limit: 'آج کے سوالات کی حد پوری ہو گئی۔ کل کوشش کریں یا سپروائزر کو فون کریں۔', ai_busy: 'اسسٹنٹ ابھی مصروف ہے۔ ایک منٹ بعد کوشش کریں۔',
      network: 'انٹرنیٹ کنکشن نہیں ہے۔ دوبارہ کوشش کریں۔', empty: 'پہلے اپنا سوال لکھیں۔', other: 'کچھ خرابی ہو گئی۔ بعد میں کوشش کریں یا سپروائزر کو بتائیں۔',
    },
  },
};
const SPEECH_LANG = { ar: 'ar-SA', en: 'en-US', ur: 'ur-PK' };
const STORE_KEY = 'driver-bot-v1';

/* ===================== الحالة ===================== */
const $ = (id) => document.getElementById(id);
let state = load();
let truck = null;          // آخر حالة للشاحنة من الخادم
let history = [];          // المحادثة الحالية [{role:'me'|'bot', text}]
let kmMode = null;         // 'reading' | 'oil'
let pendingJump = null;    // قراءة تحتاج تأكيد

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* وضع خاص */ }
}
const L = () => T[state.lang] || T.ar;
function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : ''));
}
const num = (n) => Number(n).toLocaleString('en-US');
function toLatinDigits(s) {
  return String(s).replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}
function errText(res) {
  const e = L().err;
  const n = res.current != null ? num(res.current) : '';
  return fmt(e[res.error] || e.other, { n });
}

/* ===================== الاتصال بالخادم ===================== */
async function api(action, data) {
  const payload = Object.assign({ action, truck: state.truck, pin: state.pin, lang: state.lang }, data || {});
  if (!API_URL) return demoApi(payload);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    // بدون headers مخصّصة: الطلب يبقى «بسيطاً» فلا يحتاج CORS preflight مع Apps Script
    const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), signal: ctrl.signal });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/* ===================== الشاشات ===================== */
function applyLang() {
  const l = L();
  document.documentElement.lang = state.lang || 'ar';
  document.documentElement.dir = l.dir;
  document.title = l.appName;
  $('appName').textContent = l.appName;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = l[el.dataset.t]; });
  $('askInput').placeholder = l.askPh;
  $('logoutBtn').title = l.logout;
  $('logoutBtn').setAttribute('aria-label', l.logout);
  $('langBtn').setAttribute('aria-label', 'Language / اللغة / زبان');
  $('demoBanner').textContent = l.demo;
  $('demoBanner').hidden = !!API_URL;
  $('demoHint').textContent = l.demoHint;
  $('demoHint').hidden = !!API_URL;
  renderChips();
  if (truck) renderStatus();
}

function show(id) {
  ['langScreen', 'loginScreen', 'homeScreen'].forEach((s) => { $(s).hidden = s !== id; });
  const inHome = id === 'homeScreen';
  $('logoutBtn').hidden = !inHome;
  $('truckBadge').hidden = !inHome;
}

function start() {
  if (!state.lang) { applyLang(); show('langScreen'); return; }
  applyLang();
  if (state.truck && state.pin) enterHome(); else show('loginScreen');
}

async function enterHome() {
  show('homeScreen');
  $('truckBadge').textContent = '🚚 ' + state.truck;
  const res = await api('login');
  if (!res.ok) {
    if (res.error === 'bad_login' || res.error === 'locked') { logout(); $('loginMsg').textContent = errText(res); return; }
    toast(errText(res));
    return;
  }
  truck = res.truck;
  renderStatus();
  if (!history.length) addBubble('bot', helloText());
}

function helloText() {
  return fmt(L().hello, { name: (truck && truck.driver) || '' }).replace(/\s+([!،])/, '$1');
}

function renderStatus() {
  const l = L();
  const t = truck;
  $('kmValue').textContent = t.km != null ? num(t.km) : '—';
  const card = $('statusCard');
  card.className = 'card status ' + (t.level || 'unknown');
  let line = '';
  let pct = 0;
  if (t.level === 'unknown') {
    line = t.lastOilKm == null ? l.unknownOil : l.noKm;
  } else {
    const n = num(Math.abs(t.leftKm));
    line = fmt(t.level === 'over' ? l.over : t.level === 'soon' ? l.soon : l.left, { n });
    pct = Math.max(0, Math.min(100, ((t.km - t.lastOilKm) / t.interval) * 100));
  }
  $('oilLine').textContent = line;
  $('barFill').style.width = pct + '%';
  $('oilSub').textContent = t.lastOilKm != null
    ? fmt(l.sub, { last: num(t.lastOilKm), date: '\u2066' + (t.lastOilDate || '') + '\u2069', next: num(t.nextOilKm) })
    : '';
}

function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  L().chips.forEach((q) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = q;
    b.addEventListener('click', () => sendQuestion(q));
    box.appendChild(b);
  });
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

function logout() {
  state.truck = '';
  state.pin = '';
  persist();
  truck = null;
  history = [];
  $('messages').innerHTML = '';
  $('pinInput').value = '';
  show('loginScreen');
}

/* ===================== الدخول ===================== */
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('loginForm').querySelector('button');
  state.truck = toLatinDigits($('truckInput').value).replace(/\s+/g, '').toUpperCase();
  state.pin = toLatinDigits($('pinInput').value).trim();
  $('loginMsg').textContent = '';
  btn.disabled = true;
  const res = await api('login');
  btn.disabled = false;
  if (!res.ok) { $('loginMsg').textContent = errText(res); state.pin = ''; return; }
  persist();
  truck = res.truck;
  history = [];
  $('messages').innerHTML = '';
  enterHome();
});

/* ===================== اللغة ===================== */
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
  state.lang = b.dataset.lang;
  persist();
  start();
}));
$('langBtn').addEventListener('click', () => {
  const order = ['ar', 'en', 'ur'];
  if (!state.lang) return;
  state.lang = order[(order.indexOf(state.lang) + 1) % order.length];
  persist();
  applyLang();
  if (truck && history.length === 1 && history[0].role === 'bot') {
    // رسالة الترحيب فقط: أعد كتابتها باللغة الجديدة
    history = [];
    $('messages').innerHTML = '';
    addBubble('bot', helloText());
  }
});
$('logoutBtn').addEventListener('click', logout);

/* ===================== العداد ===================== */
function openKm(mode) {
  kmMode = mode;
  pendingJump = null;
  $('kmTitle').textContent = mode === 'oil' ? L().enterOilKm : L().enterKm;
  $('kmInput').value = mode === 'oil' && truck && truck.km != null ? String(truck.km) : '';
  $('kmMsg').textContent = '';
  $('kmDialog').hidden = false;
  setTimeout(() => $('kmInput').focus(), 50);
}
$('readingBtn').addEventListener('click', () => openKm('reading'));
$('oilBtn').addEventListener('click', () => openKm('oil'));
$('kmCancel').addEventListener('click', () => { $('kmDialog').hidden = true; });
$('kmInput').addEventListener('input', () => { pendingJump = null; $('kmMsg').textContent = ''; });

$('kmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = toLatinDigits($('kmInput').value).replace(/[,\s٬]/g, '');
  if (!/^\d{1,7}$/.test(raw) || Number(raw) <= 0) { $('kmMsg').textContent = L().err.bad_km; return; }
  const km = Number(raw);
  const btn = $('kmForm').querySelector('button[type=submit]');
  btn.disabled = true;
  const res = await api(kmMode, { km, confirm: pendingJump === km });
  btn.disabled = false;
  if (!res.ok) {
    if (res.error === 'km_jump') {
      pendingJump = km;
      $('kmMsg').textContent = fmt(L().confirmJump, { n: num(res.jump) });
    } else {
      $('kmMsg').textContent = errText(res);
    }
    return;
  }
  truck = res.truck;
  renderStatus();
  $('kmDialog').hidden = true;
  toast(kmMode === 'oil' ? L().oilSaved : L().saved);
});

/* ===================== المحادثة ===================== */
function addBubble(role, text, extra) {
  const div = document.createElement('div');
  div.className = 'bubble ' + role + (extra ? ' ' + extra : '');
  div.textContent = text;
  div.dir = 'auto';
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
  if (role !== 'typing') history.push({ role, text });
  return div;
}

async function sendQuestion(q) {
  q = String(q || '').trim();
  if (!q) { toast(L().err.empty); return; }
  const prev = history.slice(-6).map((h) => ({ role: h.role === 'me' ? 'user' : 'bot', text: h.text }));
  addBubble('me', q);
  $('askInput').value = '';
  autosize();
  const typing = addBubble('typing', L().typing, 'bot');
  $('sendBtn').disabled = true;
  const res = await api('ask', { question: q, history: prev });
  $('sendBtn').disabled = false;
  typing.remove();
  if (!res.ok) { addBubble('bot', errText(res), 'unknown'); return; }
  addBubble('bot', res.answer, res.known === false ? 'unknown' : '');
}

$('askForm').addEventListener('submit', (e) => { e.preventDefault(); sendQuestion($('askInput').value); });
$('askInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendQuestion($('askInput').value); }
});
function autosize() {
  const el = $('askInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 4, 140) + 'px';
}
$('askInput').addEventListener('input', autosize);

/* ===================== الميكروفون ===================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  $('micBtn').hidden = false;
  let rec = null;
  $('micBtn').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = SPEECH_LANG[state.lang] || 'ar-SA';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const before = $('askInput').value;
    $('micBtn').classList.add('listening');
    $('askInput').placeholder = L().listening;
    let finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      $('askInput').value = (before + ' ' + finalText + interim).trim();
      autosize();
    };
    const done = () => {
      $('micBtn').classList.remove('listening');
      $('askInput').placeholder = L().askPh;
      rec = null;
    };
    rec.onend = done;
    rec.onerror = done;
    try { rec.start(); } catch (e) { done(); }
  });
}

/* ===================== وضع التجربة (بدون خادم) ===================== */
const DEMO_KEY = 'driver-bot-demo';
function demoApi(p) {
  return new Promise((resolve) => setTimeout(() => resolve(demoHandle(p)), 250));
}
function demoHandle(p) {
  let db;
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { db = null; }
  if (!db) {
    db = { '101': { pin: '1234', driver: 'Ahmad', interval: 10000, lastOilKm: 140000, lastOilDate: '2026-10-01', km: 148500, updated: '2026-11-20' } };
  }
  const save = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* */ } };
  const t = db[String(p.truck || '').toUpperCase()];
  if (!t || String(t.pin) !== String(p.pin)) return { ok: false, error: 'bad_login' };
  const today = new Date().toISOString().slice(0, 10);
  const status = () => {
    const next = t.lastOilKm != null ? t.lastOilKm + t.interval : null;
    const left = next != null && t.km != null ? next - t.km : null;
    const level = left == null ? 'unknown' : left < 0 ? 'over' : left <= 1000 ? 'soon' : 'ok';
    return { no: String(p.truck).toUpperCase(), driver: t.driver, km: t.km, interval: t.interval, lastOilKm: t.lastOilKm, lastOilDate: t.lastOilDate, nextOilKm: next, leftKm: left, level, updated: t.updated };
  };
  if (p.action === 'login') return { ok: true, truck: status() };
  if (p.action === 'reading') {
    if (t.km != null && p.km < t.km) return { ok: false, error: 'km_lower', current: t.km };
    if (t.km != null && p.km - t.km > 3000 && !p.confirm) return { ok: false, error: 'km_jump', jump: p.km - t.km };
    t.km = p.km; t.updated = today; save();
    return { ok: true, truck: status() };
  }
  if (p.action === 'oil') {
    if (t.lastOilKm != null && p.km < t.lastOilKm) return { ok: false, error: 'oil_lower', current: t.lastOilKm };
    if (t.km != null && p.km > t.km + 3000) return { ok: false, error: 'oil_high', current: t.km };
    t.lastOilKm = p.km; t.lastOilDate = today;
    if (t.km == null || p.km > t.km) t.km = p.km;
    t.updated = today; save();
    return { ok: true, truck: status() };
  }
  if (p.action === 'ask') {
    const s = status();
    const oil = /زيت|oil|تیل|tel/i.test(p.question);
    const lang = /[؀-ۿ]/.test(p.question) ? (/[ٹڈڑںےۓکگہھ]/.test(p.question) ? 'ur' : 'ar') : 'en';
    const A = {
      ar: oil && s.leftKm != null ? `(تجربة) باقي ${num(s.leftKm)} كم على غيار الزيت، عند ${num(s.nextOilKm)} كم.` : '(تجربة) هذا جواب تجريبي. بعد ربط الصفحة بالخادم سيجيب المساعد من تعليمات شركتك.',
      en: oil && s.leftKm != null ? `(Demo) ${num(s.leftKm)} km left; next oil change at ${num(s.nextOilKm)} km.` : '(Demo) This is a sample answer. Once connected, the assistant will answer from your company info.',
      ur: oil && s.leftKm != null ? `(ڈیمو) تیل بدلنے میں ${num(s.leftKm)} کلومیٹر باقی ہیں، ${num(s.nextOilKm)} کلومیٹر پر۔` : '(ڈیمو) یہ نمونے کا جواب ہے۔ سرور سے جڑنے کے بعد اسسٹنٹ کمپنی کی معلومات سے جواب دے گا۔',
    };
    return { ok: true, answer: A[lang], known: oil };
  }
  return { ok: false, error: 'other' };
}

start();
