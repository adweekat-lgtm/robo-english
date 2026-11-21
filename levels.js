/*
 * بيانات المستويات العشرة.
 * المستوى الجاهز يحمل ready:true ويحتوي على الكلمات (words) وسيناريو المحادثة (chat).
 * لإضافة مستوى جديد: انسخ بنية المستوى 1، املأ words و chat، ثم اجعل ready:true.
 *
 * حقول الكلمة:
 *   id       معرّف فريد داخل المستوى
 *   en       الكلمة بالإنجليزية (هي التي يُنطق بها ويُقارن بها كلام الطفل)
 *   phrase   الكلمة مع أداة النكرة (a / an) لجمل المحادثة
 *   ar       المعنى بالعربي
 *   arDef    المعنى مع "ال" التعريف (لجملة: أين القطة؟)
 *   img      الصورة (إيموجي كبير، يعمل بدون إنترنت)
 *   sentence / sentenceAr  جملة مثال قصيرة
 *   alts     كلمات قد يسمعها مُتعرّف الصوت بدلاً من الكلمة الصحيحة ونقبلها
 */
window.LEVELS = [
  {
    id: 1,
    ready: true,
    icon: '👋',
    color: '#FF6B6B',
    title: 'Hello! First Words',
    titleAr: 'مرحباً! أول الكلمات',
    intro: {
      en: "Level one! Let's learn our first words.",
      ar: 'المستوى الأول! هيا نتعلم أول ثماني كلمات، ونلعب، ونتكلم معاً.',
    },
    goalsAr: [
      'ثماني كلمات: حيوانات وأشياء من حولنا',
      'التحية: Hello و Goodbye',
      'أن تقول اسمك: My name is …',
      'أن تجيب عن: What is this?',
    ],
    words: [
      { id: 'cat',   en: 'cat',   phrase: 'a cat',   ar: 'قطة',   arDef: 'القطة',   img: '🐱', sentence: 'The cat says meow!',   sentenceAr: 'القطة تقول: مياو!', alts: ['cats', 'kat', 'kitty'] },
      { id: 'dog',   en: 'dog',   phrase: 'a dog',   ar: 'كلب',   arDef: 'الكلب',   img: '🐶', sentence: 'The dog says woof!',   sentenceAr: 'الكلب يقول: هاو هاو!', alts: ['dogs', 'doug', 'dug'] },
      { id: 'fish',  en: 'fish',  phrase: 'a fish',  ar: 'سمكة',  arDef: 'السمكة',  img: '🐟', sentence: 'The fish can swim.',   sentenceAr: 'السمكة تستطيع السباحة.', alts: ['fishes', 'fist'] },
      { id: 'bird',  en: 'bird',  phrase: 'a bird',  ar: 'عصفور', arDef: 'العصفور', img: '🐦', sentence: 'The bird can fly.',    sentenceAr: 'العصفور يستطيع الطيران.', alts: ['birds', 'bert', 'burt', 'bud'] },
      { id: 'apple', en: 'apple', phrase: 'an apple', ar: 'تفاحة', arDef: 'التفاحة', img: '🍎', sentence: 'The apple is red.',   sentenceAr: 'التفاحة لونها أحمر.', alts: ['apples', 'appel'] },
      { id: 'ball',  en: 'ball',  phrase: 'a ball',  ar: 'كرة',   arDef: 'الكرة',   img: '⚽', sentence: 'I play with the ball.', sentenceAr: 'أنا ألعب بالكرة.', alts: ['balls', 'bowl', 'bol', 'paul', 'fall'] },
      { id: 'car',   en: 'car',   phrase: 'a car',   ar: 'سيارة', arDef: 'السيارة', img: '🚗', sentence: 'The car is fast.',     sentenceAr: 'السيارة سريعة.', alts: ['cars', 'card', 'kar'] },
      { id: 'sun',   en: 'sun',   phrase: 'the sun', ar: 'شمس',   arDef: 'الشمس',   img: '☀️', sentence: 'The sun is hot.',      sentenceAr: 'الشمس حارّة.', alts: ['son', 'sunny', 'some'] },
    ],
    /*
     * سيناريو المحادثة: كل خطوة يقولها عمو أحمد، ثم يختار الطفل رداً (بالضغط أو بالكلام).
     * type:'name'    يلتقط اسم الطفل من كلامه ("My name is Sara")
     * type:'picture' يعرض صورة كلمة ويسأل What is this? (الردود تُولَّد تلقائياً)
     * after / afterAr  ما يقوله عمو أحمد بعد رد الطفل ({name} يُستبدل باسم الطفل إن عُرف)
     */
    chat: [
      {
        robot: 'Hello! I am Uncle Ahmad.', ar: 'مرحباً! أنا عمو أحمد.',
        replies: [
          { en: 'Hello!', ar: 'مرحباً!', keys: ['hello', 'hallo', 'hi', 'hey'] },
          { en: 'Hi, Uncle Ahmad!', ar: 'أهلاً يا عمو أحمد!', keys: ['uncle', 'ahmad', 'ahmed', 'robo', 'robot'] },
        ],
      },
      {
        type: 'name',
        robot: 'What is your name?', ar: 'ما اسمك؟',
        replies: [{ en: 'My name is …', ar: 'اسمي … (قل اسمك في الميكروفون)', keys: ['name', 'i am', "i'm"] }],
        after: 'Nice to meet you{name}!', afterAr: 'تشرّفت بمعرفتك!',
      },
      {
        robot: 'How are you?', ar: 'كيف حالك؟',
        replies: [
          { en: 'I am fine.', ar: 'أنا بخير.', keys: ['fine', 'good', 'ok', 'okay', 'great'] },
          { en: 'I am happy!', ar: 'أنا سعيد!', keys: ['happy'] },
        ],
        after: 'Me too! I am happy!', afterAr: 'وأنا أيضاً سعيد!',
      },
      { type: 'picture', word: 'cat' },
      { type: 'picture', word: 'apple' },
      {
        robot: 'Do you like the ball?', ar: 'هل تحب الكرة؟', img: '⚽',
        replies: [
          { en: 'Yes, I do!', ar: 'نعم، أحبها!', keys: ['yes', 'yeah', 'yep', 'do', 'like'] },
          { en: 'No, I don’t.', ar: 'لا، لا أحبها.', keys: ['no', 'nope', "don't", 'dont'] },
        ],
        after: 'OK! Thank you!', afterAr: 'حسناً! شكراً لك!',
      },
      { type: 'picture', word: 'sun' },
      {
        robot: 'Goodbye! See you soon!', ar: 'مع السلامة! أراك قريباً!',
        replies: [
          { en: 'Goodbye!', ar: 'مع السلامة!', keys: ['goodbye', 'good bye', 'bye'] },
          { en: 'Bye bye, Uncle Ahmad!', ar: 'باي باي يا عمو أحمد!', keys: ['bye', 'uncle', 'ahmad', 'ahmed'] },
        ],
      },
    ],
  },
  // ===== المستويات القادمة (الخطة) — ستُبنى لاحقاً =====
  { id: 2,  ready: false, icon: '🎨', color: '#FF9F43', title: 'Colors',          titleAr: 'الألوان' },
  { id: 3,  ready: false, icon: '🔢', color: '#FECA57', title: 'Numbers 1–10',    titleAr: 'الأرقام من ١ إلى ١٠' },
  { id: 4,  ready: false, icon: '👨‍👩‍👧', color: '#1DD1A1', title: 'My Family',       titleAr: 'عائلتي' },
  { id: 5,  ready: false, icon: '🍌', color: '#10AC84', title: 'Food',            titleAr: 'الطعام' },
  { id: 6,  ready: false, icon: '🖐️', color: '#48DBFB', title: 'My Body',         titleAr: 'جسمي' },
  { id: 7,  ready: false, icon: '🏠', color: '#2E86DE', title: 'My House',        titleAr: 'بيتي' },
  { id: 8,  ready: false, icon: '🏃', color: '#5F27CD', title: 'Actions',         titleAr: 'الأفعال والحركات' },
  { id: 9,  ready: false, icon: '💬', color: '#C44569', title: 'Short Sentences', titleAr: 'جمل قصيرة' },
  { id: 10, ready: false, icon: '📖', color: '#222F3E', title: 'Stories & Talk',  titleAr: 'قصص ومحادثة' },
];
