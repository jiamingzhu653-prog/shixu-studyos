(() => {
  'use strict';

  // PERMANENT NEVER-CHANGING STORAGE KEYS (Zero data loss across all website updates)
  const PERMANENT_VAULT_KEY = 'shixu_account_vault_permanent';
  const PERMANENT_SESSION_KEY = 'shixu_session_permanent';
  const LEGACY_VAULT_KEYS = ['shixu_raw_store_v3', 'shixu_raw_store_v2'];
  const IDB_NAME = 'shixu_vault_db';
  const IDB_STORE = 'kv';

  const SYSTEM_COLORS = ['#0071E3', '#34C759', '#FF9500', '#FF3B30', '#30B0C7', '#5856D6'];
  const EXAM_PRESETS = [
    { name: '全国考研初试', tag: '考试倒计时', days: 90, color: '#0071E3' },
    { name: '国家公务员笔试', tag: '考试倒计时', days: 60, color: '#FF9500' },
    { name: '雅思冲刺考试', tag: '语言目标', days: 45, color: '#34C759' },
    { name: 'CPA 专业阶段', tag: '资格考试', days: 120, color: '#0071E3' },
    { name: '国家统一法考', tag: '资格考试', days: 100, color: '#FF3B30' },
    { name: '全国普通高考', tag: '考试倒计时', days: 180, color: '#30B0C7' }
  ];

  const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  const TAB_TITLES = {
    today: '学习序列',
    groups: '学习小组',
    exams: '目标倒计时',
    desktop: 'iOS 桌面与组件'
  };

  // Safe date helpers (hardened against invalid dates / NaN)
  function isValidDateISO(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
  }
  function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function todayKey() { return formatDateISO(new Date()); }
  function parseDateISO(str) {
    if (!isValidDateISO(str)) return new Date(new Date().setHours(0, 0, 0, 0));
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function shiftDateISO(baseStr, deltaDays) {
    const d = parseDateISO(baseStr);
    d.setDate(d.getDate() + deltaDays);
    return formatDateISO(d);
  }
  function addDaysStr(days) { return shiftDateISO(todayKey(), days); }
  function currentMonthKey(dateStr = todayKey()) { return (isValidDateISO(dateStr) ? dateStr : todayKey()).slice(0, 7); }
  function shiftMonthKey(ym, deltaMonths) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + deltaMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function normalizeAccount(acc) {
    return String(acc || '').trim().toLowerCase().slice(0, 40);
  }

  // Safe localStorage wrapper (prevents QuotaExceededError / Safari Private crashes)
  let memoryVaultFallback = null;
  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeStorageSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch { return false; }
  }
  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  // Modern UTF-8 Base64 (replaces deprecated unescape/escape)
  function encodeB64Json(obj) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(obj));
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    } catch { return ''; }
  }
  function decodeB64Json(str) {
    try {
      const bin = atob(str);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { return null; }
  }

  async function hashPassword(account, password) {
    const msg = `shixu::v1::${normalizeAccount(account)}::${String(password || '')}`;
    if (window.crypto && window.crypto.subtle) {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;
    for (let i = 0; i < msg.length; i++) {
      h ^= msg.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fnv_${(h >>> 0).toString(16)}`;
  }

  const STYLE_PACKS = {
    apple: {
      id: 'apple',
      name: '苹果原生',
      badge: '默认',
      desc: '极简克制的高级毛玻璃质感，保留原始标准表达与交互。',
      swatchBg: 'linear-gradient(135deg, #0077ED, #005AC1)',
      swatchIcon: '',
      lightMeta: '#F5F5F7',
      darkMeta: '#000000',
      authTitle: '时序 · 统一学习账户',
      tabs: { today: '今日', groups: '小组', exams: '倒计时', desktop: '桌面' },
      dayTitles: { today: '今日学习', yesterday: '昨日复盘', tomorrow: '明日计划', customSuffix: '任务' },
      countdownEmptyTitle: '尚未设定考试或目标倒计时',
      countdownEmptyDesc: '设定考试或目标日期，首页与锁屏自动倒数。',
      countdownEmptyBtn: '+ 设定目标倒计时',
      progressMeta: '进度',
      tileProgressToday: '今日进度',
      tileProgressOther: '当日进度',
      tileFocus: '今日专注',
      tileFocusCta: '开启专注计时 ›',
      tileFocusRunning: '计时运行中 ›',
      focusRingLabel: '专注',
      focusSheetTitle: '沉浸专注计时',
      focusDefaultLabel: '专注学习',
      focusLivePrefix: '专注进行中',
      taskSeqLabel: '任务序列',
      manageCatsBtn: '管理大标题',
      addTaskBtn: '+ 添加任务',
      taskEmptyTitleSuffix: '暂无安排',
      taskEmptyDesc: '先自定义任务大标题（如专业课、数学、英语），再安排当日或每日重复任务。',
      catSheetTitle: '自定义任务大标题',
      catSheetDesc: '自由命名你的学习模块大标题（如：专业课、数据结构、民法总论、雅思精听），任务将自动归类到对应大标题下。',
      catPlaceholder: '例如：专业课 · 计算机组成原理',
      hudCheckin: '今日打卡完成',
      hudAllDone: '全部任务达成',
      groupSub: '多人共学 · 互相监督',
      groupTitle: '学习小组',
      groupCreateBtn: '+ 建组',
      groupJoinBtn: '邀请码加入',
      groupProgressLabel: '今日小组总达成率',
      groupCodeLabel: '小组邀请码',
      groupMemberTitle: '组员今日进度',
      groupMemberHint: '点击成员头像可互相「拍一拍催学」或「点赞鼓励」',
      groupFeedTitle: '小组打卡动态',
      groupFeedPlaceholder: '发一条学习心得或打卡状态给组员…',
      groupEmptyTitle: '尚未创建或加入学习小组',
      groupEmptyDesc: '创建一个学习小组设定共同考试倒计时，生成专属邀请码与链接邀请同伴一起每日打卡监督。',
      groupEmptyCreate: '创建第一个小组',
      nudgeText: (name) => `拍了拍 ${name}：该学习打卡啦`,
      cheerText: (name) => `给 ${name} 送上了鼓励`,
      nudgeHud: (name) => `已拍一拍提醒 ${name}`,
      cheerHud: (name) => `已鼓励 ${name}`,
      examSub: '距离目标 · 精准追踪',
      examTitle: '目标倒计时',
      examAddBtn: '+ 新目标',
      wallpaperFallback: '前往「今日」添加你的学习任务清单',
      reviewLabel: '错题复习',
      reviewNotebook: '错题复习本',
      reviewRound: (i, n) => `第 ${i}/${n} 轮复习`,
      addReviewBtn: '+ 错题复习'
    },
    kitty: {
      id: 'kitty',
      name: '粉萌凯蒂',
      badge: '甜心风',
      desc: '樱花奶昔粉与蝴蝶结甜心美学，元气满满的温柔自律陪伴。',
      swatchBg: 'linear-gradient(135deg, #FF73A8, #E83E7D)',
      swatchIcon: '🎀',
      lightMeta: '#FFF5F8',
      darkMeta: '#160D12',
      authTitle: '时序 · 凯蒂甜心自习室',
      tabs: { today: '今日', groups: '搭子', exams: '心愿', desktop: '装扮' },
      dayTitles: { today: '今日份努力', yesterday: '昨日小复盘', tomorrow: '明日小期待', customSuffix: '小计划' },
      countdownEmptyTitle: '还没有定下心愿倒数日哦',
      countdownEmptyDesc: '设一个期待的考试或闪光日，每天一起倒数变优秀。',
      countdownEmptyBtn: '+ 许下第一个心愿日',
      progressMeta: '元气进度',
      tileProgressToday: '今日小目标',
      tileProgressOther: '当日小目标',
      tileFocus: '元气专注',
      tileFocusCta: '开启元气番茄钟 ›',
      tileFocusRunning: '认真变优秀中 ›',
      focusRingLabel: '元气',
      focusSheetTitle: '元气番茄钟',
      focusDefaultLabel: '认真变优秀',
      focusLivePrefix: '元气专注中',
      taskSeqLabel: '甜心计划表',
      manageCatsBtn: '可爱分类',
      addTaskBtn: '+ 记小目标',
      taskEmptyTitleSuffix: '还没有写下小计划',
      taskEmptyDesc: '先建几个喜欢的大标题分类（如专业课、单词本、复盘日记），开启今日自律吧。',
      catSheetTitle: '自定义甜心分类大标题',
      catSheetDesc: '自由命名你的专属学习分类，给每个科目挑一个喜欢的马卡龙标记色。',
      catPlaceholder: '例如：专业课笔记 / 英语单词本',
      hudCheckin: '太棒啦！完成一个小目标，奖励小红花',
      hudAllDone: '全部小目标 100% 达成，今天超级闪耀',
      groupSub: '闺蜜搭子 · 温柔互督',
      groupTitle: '搭子自习室',
      groupCreateBtn: '+ 建自习室',
      groupJoinBtn: '暗号入组',
      groupProgressLabel: '今日自习室元气达成率',
      groupCodeLabel: '自习室暗号',
      groupMemberTitle: '搭子今日进度',
      groupMemberHint: '点头像可「轻轻戳一下催学」或「贴贴夸夸」',
      groupFeedTitle: '自习室甜心动态',
      groupFeedPlaceholder: '和搭子分享今天的自律小确幸…',
      groupEmptyTitle: '还没有和搭子组建自习室哦',
      groupEmptyDesc: '拉上你的备考搭子或闺蜜，一起定下倒数日，每天互相打气不摆烂。',
      groupEmptyCreate: '创建甜心自习室',
      nudgeText: (name) => `轻轻戳了戳 ${name}：别摸鱼啦，一起变优秀呀`,
      cheerText: (name) => `给 ${name} 贴了一枚小红花，今天超自律`,
      nudgeHud: (name) => `已轻轻戳了戳 ${name} 去学习`,
      cheerHud: (name) => `已给 ${name} 贴上小红花夸夸`,
      examSub: '闪闪发光 · 心愿倒数',
      examTitle: '心愿倒数日',
      examAddBtn: '+ 新心愿',
      wallpaperFallback: '打开时序写下今日份小目标吧',
      reviewLabel: '错题小本',
      reviewNotebook: '甜心错题本',
      reviewRound: (i, n) => `第 ${i}/${n} 轮温习`,
      addReviewBtn: '+ 记错题'
    },
    xianxia: {
      id: 'xianxia',
      name: '问鼎修仙',
      badge: '国风玉瓷',
      desc: '宣纸玉瓷与玄墨流金国风美学，备考如渡劫，打卡即破境飞升。',
      swatchBg: 'linear-gradient(135deg, #213B32, #B87324)',
      swatchIcon: '仙',
      lightMeta: '#F6F2E9',
      darkMeta: '#0D1110',
      authTitle: '时序 · 问道修行录',
      tabs: { today: '修行', groups: '宗门', exams: '渡劫', desktop: '玉简' },
      dayTitles: { today: '今日修行', yesterday: '昨日悟道', tomorrow: '明日闭关', customSuffix: '功课' },
      countdownEmptyTitle: '尚未立下渡劫飞升之期',
      countdownEmptyDesc: '定下大考飞升之日，玉简与首页日夜警醒道心。',
      countdownEmptyBtn: '+ 立下渡劫之期',
      progressMeta: '修为圆满度',
      tileProgressToday: '今日功课',
      tileProgressOther: '当日功课',
      tileFocus: '闭关打坐',
      tileFocusCta: '开启闭关打坐 ›',
      tileFocusRunning: '闭关参悟中 ›',
      focusRingLabel: '打坐',
      focusSheetTitle: '闭关打坐计时',
      focusDefaultLabel: '闭关参悟',
      focusLivePrefix: '正在闭关参悟',
      taskSeqLabel: '修行功课簿',
      manageCatsBtn: '功法大纲',
      addTaskBtn: '+ 立功课',
      taskEmptyTitleSuffix: '尚未排定功课',
      taskEmptyDesc: '先立下你的功法大标题（如专业课剑诀、高数心法、英语真经），开启今日悟道。',
      catSheetTitle: '自定义功法大纲',
      catSheetDesc: '自由命名你的修行功法大标题，不同科目的日常功课将归于各自玉卷之下。',
      catPlaceholder: '例如：专业课心法 / 高数剑诀',
      hudCheckin: '功课圆满，道心更稳，修为精进一分',
      hudAllDone: '功课悉数圆满，隐有破境飞升之象',
      groupSub: '同门道友 · 结伴飞升',
      groupTitle: '宗门道友',
      groupCreateBtn: '+ 创宗门',
      groupJoinBtn: '令牌入门',
      groupProgressLabel: '今日宗门总修为达成率',
      groupCodeLabel: '宗门令牌',
      groupMemberTitle: '同门今日修为',
      groupMemberHint: '点击道友头像可「传音催修」或「拱手道贺」',
      groupFeedTitle: '宗门问道传音壁',
      groupFeedPlaceholder: '留下一句悟道心得或闭关宣言…',
      groupEmptyTitle: '尚未创立或拜入任何宗门',
      groupEmptyDesc: '创立一方修行宗门立下共同渡劫之期，凭宗门令牌邀同道中人结伴飞升。',
      groupEmptyCreate: '创立一方宗门',
      nudgeText: (name) => `向 ${name} 发出一道传音符：大劫将至，速来修行`,
      cheerText: (name) => `向 ${name} 拱手道贺：道友精进神速，飞升可期`,
      nudgeHud: (name) => `已向 ${name} 发出传音符催修`,
      cheerHud: (name) => `已向 ${name} 拱手道贺`,
      examSub: '大劫将至 · 问鼎飞升',
      examTitle: '渡劫倒数',
      examAddBtn: '+ 立新劫',
      wallpaperFallback: '前往修行录立下今日功课',
      reviewLabel: '心魔错题',
      reviewNotebook: '心魔破障录',
      reviewRound: (i, n) => `第 ${i}/${n} 重参悟`,
      addReviewBtn: '+ 录心魔'
    }
  };

  const REVIEW_PRESETS = {
    ebbinghaus: {
      id: 'ebbinghaus',
      name: '艾宾浩斯曲线',
      short: '艾宾浩斯 6 轮',
      desc: '自动排入当日 +1/+2/+4/+7/+15 天时间轴',
      offsets: [0, 1, 2, 4, 7, 15]
    },
    sprint: {
      id: 'sprint',
      name: '考前高频巩固',
      short: '高频 4 轮',
      desc: '自动排入当日 +1/+3/+7 天密集复盘',
      offsets: [0, 1, 3, 7]
    },
    single: {
      id: 'single',
      name: '单日专项复习',
      short: '单日复习',
      desc: '仅在选定日期复习一次',
      offsets: [0]
    }
  };

  const MASTERY_LEVELS = {
    weak: { id: 'weak', label: '未掌握', cls: 'is-weak', next: 'reviewing' },
    reviewing: { id: 'reviewing', label: '待巩固', cls: 'is-reviewing', next: 'mastered' },
    mastered: { id: 'mastered', label: '已掌握', cls: 'is-mastered', next: 'weak' }
  };

  const CLOSE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function sheetCloseBtn() {
    return `<button type="button" class="sheet-close" data-action="close-sheet" aria-label="关闭">${CLOSE_ICON_SVG}</button>`;
  }

  function generateReviewDates(startDate, presetId = 'ebbinghaus') {
    const base = isValidDateISO(startDate) ? startDate : todayKey();
    const preset = REVIEW_PRESETS[presetId] || REVIEW_PRESETS.ebbinghaus;
    return Array.from(new Set(preset.offsets.map((d) => shiftDateISO(base, d)))).sort();
  }

  function isReviewTask(task) {
    return Boolean(task && task.taskType === 'review');
  }

  function getReviewRoundInfo(task, dateStr) {
    if (!isReviewTask(task)) return null;
    const dates = Array.isArray(task.reviewDates) && task.reviewDates.length ? task.reviewDates : [task.date];
    const idx = dates.indexOf(dateStr);
    return {
      round: idx >= 0 ? idx + 1 : 1,
      total: dates.length
    };
  }

  function formatShortMD(dateStr) {
    if (!isValidDateISO(dateStr)) return dateStr;
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}`;
  }

  function getPack() {
    return STYLE_PACKS[state.stylePack] || STYLE_PACKS.apple;
  }

  function getXianxiaRealm(streak) {
    if (streak >= 30) return '化神大能';
    if (streak >= 15) return '元婴境';
    if (streak >= 7) return '金丹境';
    if (streak >= 3) return '筑基境';
    if (streak >= 1) return '炼气圆满';
    return '炼气初期';
  }

  function getHeroThemeMotifSVG() {
    if (state.stylePack === 'kitty') {
      return `
        <svg class="hero-theme-motif" width="46" height="32" viewBox="0 0 46 32" fill="none" aria-hidden="true">
          <path d="M23 16C18 8 6 5 4 14C2 23 15 26 23 18C31 26 44 23 42 14C40 5 28 8 23 16Z" fill="rgba(255,255,255,0.28)" stroke="rgba(255,255,255,0.75)" stroke-width="1.6"/>
          <circle cx="23" cy="16" r="4.8" fill="rgba(255,255,255,0.9)"/>
        </svg>
      `;
    }
    if (state.stylePack === 'xianxia') {
      return `
        <svg class="hero-theme-motif" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
          <circle cx="22" cy="22" r="18" stroke="rgba(226,184,107,0.45)" stroke-width="1.4"/>
          <circle cx="22" cy="22" r="12" stroke="rgba(226,184,107,0.28)" stroke-width="1"/>
          <path d="M22 8C25 14 25 18 22 22C19 18 19 14 22 8ZM22 36C25 30 25 26 22 22C19 26 19 30 22 36ZM8 22C14 19 18 19 22 22C18 25 14 25 8 22ZM36 22C30 19 26 19 22 22C26 25 30 25 36 22Z" fill="rgba(226,184,107,0.38)"/>
        </svg>
      `;
    }
    return '';
  }

  const state = {
    mode: 'auto', // 'server' | 'supabase' | 'local'
    userId: '',
    authMode: 'login',
    stylePack: STYLE_PACKS[safeStorageGet('shixu_style_pack')] ? safeStorageGet('shixu_style_pack') : 'apple',
    theme: safeStorageGet('shixu_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    activeTab: 'today',
    taskFilter: 'all', // 'all' | 'review' | 'todo'
    selectedDate: todayKey(),
    viewMonth: currentMonthKey(),
    showMonthCalendar: false,
    activeGroupId: null,
    pendingInvite: null,
    pendingRestore: null,
    data: null,
    scriptableCode: '',
    lastSyncedAt: null,
    focus: {
      presetMin: 25,
      remainingSec: 25 * 60,
      endAt: null,
      running: false,
      label: '专注学习',
      timerId: null
    }
  };

  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('shixu_permanent_sync') : null;

  // DOM refs
  const topNav = document.getElementById('top-nav');
  const mainScroll = document.getElementById('main-scroll');
  const viewContainer = document.getElementById('view-container');
  const compactTitle = document.getElementById('nav-compact-title');
  const navAvatar = document.getElementById('nav-avatar');
  const navUsername = document.getElementById('nav-username');
  const fabAdd = document.getElementById('fab-add');
  const hudPill = document.getElementById('hud-pill');
  const hudDot = document.getElementById('hud-dot');
  const hudText = document.getElementById('hud-text');
  const hudAction = document.getElementById('hud-action');
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  const sheetPanel = document.getElementById('sheet-panel');
  const sheetContent = document.getElementById('sheet-content');
  const importBackupInput = document.getElementById('import-backup-input');

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function daysUntil(dateStr) {
    if (!isValidDateISO(dateStr)) return 0;
    const now = parseDateISO(todayKey());
    const target = parseDateISO(dateStr);
    return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000));
  }

  function calcProgress(startDate, targetDate) {
    const start = parseDateISO(startDate).getTime();
    const end = parseDateISO(targetDate).getTime();
    const now = parseDateISO(todayKey()).getTime();
    if (!start || !end || end <= start) return 100;
    return Math.min(100, Math.max(4, Math.round(((now - start) / (end - start)) * 100)));
  }

  function formatDateCN(dateStr = todayKey()) {
    const d = parseDateISO(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS_SHORT[d.getDay()]}`;
  }

  function getRelativeDayTitle(dateStr) {
    const p = getPack().dayTitles;
    const today = todayKey();
    if (dateStr === today) return p.today;
    if (dateStr === shiftDateISO(today, -1)) return p.yesterday;
    if (dateStr === shiftDateISO(today, 1)) return p.tomorrow;
    const d = parseDateISO(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日${p.customSuffix}`;
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  }

  function formatTimer(sec) {
    const safe = Math.max(0, Math.ceil(sec));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function genId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
  function genInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function isTaskOnDate(task, dateStr) {
    if (Array.isArray(task.reviewDates) && task.reviewDates.length > 0) {
      return task.reviewDates.includes(dateStr);
    }
    if (!task.repeatDaily) return task.date === dateStr;
    return dateStr >= task.date;
  }

  function isTaskDoneOnDate(task, dateStr) {
    if (Array.isArray(task.completedDates)) return task.completedDates.includes(dateStr);
    return Boolean(task.done && task.date === dateStr);
  }

  function getDayStats(tasks, dateStr) {
    const list = (tasks || []).filter((t) => isTaskOnDate(t, dateStr));
    const done = list.filter((t) => isTaskDoneOnDate(t, dateStr)).length;
    const total = list.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { list, done, total, pct };
  }

  // Real consecutive-day streak computation from actual completedDates
  function computeRealStreak(tasks) {
    const completedDaySet = new Set();
    for (const t of tasks || []) {
      for (const d of t.completedDates || []) {
        if (isValidDateISO(d)) completedDaySet.add(d);
      }
    }
    if (completedDaySet.size === 0) return 0;
    let cursor = todayKey();
    if (!completedDaySet.has(cursor)) {
      const yest = shiftDateISO(cursor, -1);
      if (!completedDaySet.has(yest)) return 0;
      cursor = yest;
    }
    let streak = 0;
    while (completedDaySet.has(cursor)) {
      streak++;
      cursor = shiftDateISO(cursor, -1);
    }
    return streak;
  }

  function ringSVG(pct, size, strokeWidth, color, extraId = '') {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${strokeWidth}" />
        <circle ${extraId ? `id="${extraId}"` : ''} class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" data-circumference="${c.toFixed(2)}" />
      </svg>
    `;
  }

  // Floating HUD Pill with optional Undo Action
  let hudTimer = null;
  let hudActionHandler = null;
  function showHud(text, dotColor = 'var(--green)', actionOpts = null) {
    hudText.textContent = text;
    hudDot.style.background = dotColor;
    if (actionOpts && typeof actionOpts.onClick === 'function') {
      hudAction.textContent = actionOpts.label || '撤销';
      hudAction.classList.remove('hidden');
      hudPill.classList.add('has-action');
      hudActionHandler = actionOpts.onClick;
    } else {
      hudAction.classList.add('hidden');
      hudPill.classList.remove('has-action');
      hudActionHandler = null;
    }
    hudPill.classList.add('is-visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hudPill.classList.remove('is-visible');
      hudActionHandler = null;
    }, actionOpts ? 4200 : 2400);
  }

  hudAction.addEventListener('click', () => {
    const fn = hudActionHandler;
    hudActionHandler = null;
    hudPill.classList.remove('is-visible');
    if (fn) fn();
  });

  async function copyText(str, okMsg) {
    try {
      await navigator.clipboard.writeText(str);
      showHud(okMsg || '已复制到剪贴板');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showHud(okMsg || '已复制到剪贴板');
    }
  }

  // =========================================================================
  // Resilient IndexedDB Mirror + Permanent Local Vault
  // =========================================================================

  function openVaultDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function idbGet(key) {
    try {
      const db = await openVaultDB();
      if (!db) return null;
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function idbSet(key, val) {
    try {
      const db = await openVaultDB();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }

  function createEmptyStore() {
    return {
      schemaVersion: 4,
      lastRolloverDate: todayKey(),
      users: [],
      categories: [],
      exams: [],
      tasks: [],
      groups: [],
      feeds: []
    };
  }

  function migrateStore(raw) {
    if (!raw || typeof raw !== 'object') return createEmptyStore();
    const s = {
      schemaVersion: 4,
      lastRolloverDate: isValidDateISO(raw.lastRolloverDate) ? raw.lastRolloverDate : todayKey(),
      users: Array.isArray(raw.users) ? raw.users : [],
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      exams: Array.isArray(raw.exams) ? raw.exams : [],
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      groups: Array.isArray(raw.groups) ? raw.groups : [],
      feeds: Array.isArray(raw.feeds) ? raw.feeds : []
    };
    for (const u of s.users) {
      if (!u.account) u.account = normalizeAccount(u.name || u.id);
    }
    for (const t of s.tasks) {
      if (!t.category) t.category = t.subject || '未分组';
      if (!isValidDateISO(t.date)) t.date = todayKey();
      if (!Array.isArray(t.completedDates)) t.completedDates = t.done ? [t.date] : [];
    }
    return s;
  }

  async function initPermanentStorage() {
    let raw = null;
    try { raw = JSON.parse(safeStorageGet(PERMANENT_VAULT_KEY) || 'null'); } catch {}
    if (!raw) raw = await idbGet('vault');
    if (!raw) {
      for (const legacyKey of LEGACY_VAULT_KEYS) {
        try {
          const legacy = JSON.parse(safeStorageGet(legacyKey) || 'null');
          if (legacy && Array.isArray(legacy.users) && legacy.users.length > 0) { raw = legacy; break; }
        } catch {}
      }
    }
    const migrated = migrateStore(raw);
    memoryVaultFallback = migrated;
    safeStorageSet(PERMANENT_VAULT_KEY, JSON.stringify(migrated));
    idbSet('vault', migrated);

    let session = null;
    try { session = JSON.parse(safeStorageGet(PERMANENT_SESSION_KEY) || 'null'); } catch {}
    if (!session) session = await idbGet('session');
    if (session && session.userId) {
      state.userId = session.userId;
    } else {
      const legacyUid = safeStorageGet('shixu_raw_user_id');
      if (legacyUid && migrated.users.some((u) => u.id === legacyUid)) {
        state.userId = legacyUid;
        saveSession(legacyUid);
      }
    }

    if (!safeStorageGet('shixu_style_pack')) {
      const savedPack = await idbGet('stylePack');
      if (savedPack && STYLE_PACKS[savedPack]) applyStylePack(savedPack);
    }
  }

  function saveSession(userId, account = '') {
    state.userId = userId || '';
    if (userId) {
      const sess = { userId, account: normalizeAccount(account), savedAt: Date.now() };
      safeStorageSet(PERMANENT_SESSION_KEY, JSON.stringify(sess));
      idbSet('session', sess);
    } else {
      safeStorageRemove(PERMANENT_SESSION_KEY);
      idbSet('session', null);
    }
  }

  function getLocalStore() {
    let s = null;
    try { s = JSON.parse(safeStorageGet(PERMANENT_VAULT_KEY) || 'null'); } catch {}
    if (!s && memoryVaultFallback) s = memoryVaultFallback;
    s = migrateStore(s);
    const today = todayKey();
    if (s.lastRolloverDate !== today) {
      for (const u of s.users) u.focusMinutesToday = 0;
      s.lastRolloverDate = today;
      memoryVaultFallback = s;
      safeStorageSet(PERMANENT_VAULT_KEY, JSON.stringify(s));
      idbSet('vault', s);
    }
    return s;
  }

  function saveLocalStore(s, toastMsg) {
    memoryVaultFallback = s;
    safeStorageSet(PERMANENT_VAULT_KEY, JSON.stringify(s));
    idbSet('vault', s);
    if (bc) bc.postMessage({ type: 'sync', toastMsg, fromUserId: state.userId });
    if (state.mode === 'supabase' && state.userId) {
      pushAccountToSupabase(s, state.userId).catch(() => {});
      pushUserGroupsToSupabase(s, state.userId).catch(() => {});
    }
  }

  // =========================================================================
  // Supabase Zero-Cost Cloud Sync Adapter (Accounts + Study Groups)
  // =========================================================================

  function getSupabaseConfig() {
    const cfg = window.SHIXU_CLOUD_CONFIG || {};
    const url = String(cfg.supabaseUrl || '').trim().replace(/\/$/, '');
    const key = String(cfg.supabaseAnonKey || '').trim();
    return url && key ? { url, key } : null;
  }

  async function sbFetch(path, options = {}) {
    const cfg = getSupabaseConfig();
    if (!cfg) throw new Error('Supabase 未配置');
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error('云端同步失败');
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function pushAccountToSupabase(s, userId) {
    const user = s.users.find((u) => u.id === userId);
    if (!user || !user.account) return;
    const userTasks = s.tasks.filter((t) => t.userId === user.id);
    const row = {
      account: user.account,
      user_id: user.id,
      name: user.name,
      avatar: user.avatar,
      color: user.color,
      password_hash: user.passwordHash || '',
      streak: computeRealStreak(userTasks),
      focus_minutes_today: user.focusMinutesToday || 0,
      last_rollover_date: s.lastRolloverDate || todayKey(),
      payload: {
        categories: s.categories.filter((c) => c.userId === user.id),
        exams: s.exams.filter((e) => e.userId === user.id),
        tasks: userTasks
      },
      updated_at: Date.now()
    };
    await sbFetch('shixu_accounts?on_conflict=account', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row)
    });
    state.lastSyncedAt = Date.now();
  }

  async function pushUserGroupsToSupabase(s, userId) {
    const myGroups = s.groups.filter((g) => g.memberIds.includes(userId));
    const user = s.users.find((u) => u.id === userId);
    if (!user) return;
    const today = todayKey();
    const mySt = getDayStats(s.tasks.filter((t) => t.userId === userId), today);
    for (const g of myGroups) {
      const snaps = { ...(g.memberSnapshots || {}) };
      snaps[userId] = {
        id: user.id, account: user.account, name: user.name, avatar: user.avatar, color: user.color,
        streak: computeRealStreak(s.tasks.filter((t) => t.userId === userId)),
        done: mySt.done, total: mySt.total, pct: mySt.pct, date: today
      };
      g.memberSnapshots = snaps;
      await sbFetch('shixu_groups?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          id: g.id, invite_code: g.inviteCode, name: g.name, exam_name: g.examName,
          target_date: g.targetDate, notice: g.notice, owner_id: g.ownerId,
          member_ids: g.memberIds, member_snapshots: snaps,
          feeds: s.feeds.filter((f) => f.groupId === g.id).slice(-40),
          updated_at: Date.now()
        })
      });
    }
  }

  async function pullAccountFromSupabase(account, passwordHash) {
    const rows = await sbFetch(`shixu_accounts?account=eq.${encodeURIComponent(normalizeAccount(account))}&select=*`);
    if (!rows || !rows.length) return null;
    const row = rows[0];
    if (passwordHash && row.password_hash && row.password_hash !== passwordHash) {
      throw new Error('密码不正确，请重试');
    }
    const s = getLocalStore();
    const existing = s.users.find((u) => u.account === row.account);
    const hydratedUser = {
      id: row.user_id,
      account: row.account,
      name: row.name,
      avatar: row.avatar,
      color: row.color,
      passwordHash: row.password_hash,
      streak: row.streak || 0,
      focusMinutesToday: row.last_rollover_date === todayKey() ? (row.focus_minutes_today || 0) : 0,
      createdAt: existing ? existing.createdAt : Date.now()
    };
    if (existing) Object.assign(existing, hydratedUser);
    else s.users.push(hydratedUser);

    const p = row.payload || {};
    s.categories = s.categories.filter((c) => c.userId !== hydratedUser.id).concat(p.categories || []);
    s.exams = s.exams.filter((e) => e.userId !== hydratedUser.id).concat(p.exams || []);
    s.tasks = s.tasks.filter((t) => t.userId !== hydratedUser.id).concat(p.tasks || []);

    // Also pull user's cloud study groups
    const allGroups = await sbFetch('shixu_groups?select=*').catch(() => []);
    for (const rg of allGroups || []) {
      const mIds = Array.isArray(rg.member_ids) ? rg.member_ids : [];
      if (!mIds.includes(hydratedUser.id)) continue;
      const idx = s.groups.findIndex((x) => x.id === rg.id);
      const localGrp = {
        id: rg.id, inviteCode: rg.invite_code, name: rg.name, examName: rg.exam_name,
        targetDate: rg.target_date, notice: rg.notice, ownerId: rg.owner_id,
        memberIds: mIds, memberSnapshots: rg.member_snapshots || {}, createdAt: rg.updated_at || Date.now()
      };
      if (idx === -1) s.groups.push(localGrp);
      else s.groups[idx] = localGrp;
      if (Array.isArray(rg.feeds)) {
        s.feeds = s.feeds.filter((f) => f.groupId !== rg.id).concat(rg.feeds);
      }
    }

    memoryVaultFallback = s;
    safeStorageSet(PERMANENT_VAULT_KEY, JSON.stringify(s));
    idbSet('vault', s);
    state.lastSyncedAt = Date.now();
    return hydratedUser;
  }

  // =========================================================================
  // Local Data Operations (Full Parity with Server Mode)
  // =========================================================================

  function ensureLocalCategory(s, userId, name, color) {
    const clean = String(name || '').trim().slice(0, 18);
    if (!clean) return null;
    let existing = s.categories.find((c) => c.userId === userId && c.name === clean);
    if (!existing) {
      const userCats = s.categories.filter((c) => c.userId === userId);
      existing = {
        id: genId('cat'),
        userId,
        name: clean,
        color: color || SYSTEM_COLORS[userCats.length % SYSTEM_COLORS.length]
      };
      s.categories.push(existing);
    }
    return existing;
  }

  function buildLocalBootstrap(userId) {
    const s = getLocalStore();
    const user = userId ? s.users.find((u) => u.id === userId) : null;
    const today = todayKey();
    const safeUsers = s.users.map((u) => {
      const uTasks = s.tasks.filter((t) => t.userId === u.id);
      return { id: u.id, account: u.account, name: u.name, avatar: u.avatar, color: u.color, streak: computeRealStreak(uTasks) };
    });
    if (!user) {
      return { today, user: null, users: safeUsers, categories: [], tasks: [], exams: [], groups: [] };
    }
    const categories = s.categories.filter((c) => c.userId === user.id);
    const tasks = s.tasks
      .filter((t) => t.userId === user.id)
      .map((t) => ({
        ...t,
        category: t.category || t.subject || '未分组',
        completedDates: Array.isArray(t.completedDates) ? t.completedDates : (t.done ? [t.date] : []),
        done: isTaskDoneOnDate(t, today)
      }));

    const exams = s.exams
      .filter((e) => e.userId === user.id)
      .map((e) => ({ ...e, daysLeft: daysUntil(e.targetDate), progress: calcProgress(e.startDate, e.targetDate) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.daysLeft - b.daysLeft);

    const groups = s.groups
      .filter((g) => g.memberIds.includes(user.id))
      .map((g) => {
        const members = g.memberIds.map((uid) => {
          const localU = s.users.find((u) => u.id === uid);
          if (localU) {
            const uTasks = s.tasks.filter((t) => t.userId === uid);
            const st = getDayStats(uTasks, today);
            return {
              id: localU.id, account: localU.account, name: localU.name, avatar: localU.avatar, color: localU.color,
              streak: computeRealStreak(uTasks), done: st.done, total: st.total, pct: st.pct
            };
          }
          const snap = g.memberSnapshots && g.memberSnapshots[uid];
          if (snap) {
            const sameDay = snap.date === today;
            return { ...snap, done: sameDay ? snap.done : 0, pct: sameDay ? snap.pct : 0 };
          }
          return null;
        }).filter(Boolean);

        const totalTasks = members.reduce((a, m) => a + m.total, 0);
        const doneTasks = members.reduce((a, m) => a + m.done, 0);
        const feeds = s.feeds
          .filter((f) => f.groupId === g.id)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30)
          .map((f) => {
            const u = s.users.find((x) => x.id === f.userId)
              || (g.memberSnapshots && g.memberSnapshots[f.userId])
              || { name: '成员', avatar: '学', color: '#0071E3' };
            return { ...f, userName: u.name, userAvatar: u.avatar, userColor: u.color };
          });
        return {
          ...g,
          daysLeft: daysUntil(g.targetDate),
          members,
          totalTasks,
          doneTasks,
          teamPct: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
          feeds
        };
      });

    const { passwordHash, ...safeUser } = user;
    safeUser.streak = computeRealStreak(tasks);
    return { today, user: safeUser, users: safeUsers, categories, tasks, exams, groups };
  }

  function buildAccountSnapshot(userId) {
    const s = getLocalStore();
    const user = s.users.find((u) => u.id === userId);
    if (!user) return null;
    return {
      v: 4,
      exportedAt: Date.now(),
      user: { ...user },
      categories: s.categories.filter((c) => c.userId === user.id),
      exams: s.exams.filter((e) => e.userId === user.id),
      tasks: s.tasks.filter((t) => t.userId === user.id),
      groups: s.groups.filter((g) => g.memberIds.includes(user.id)).map((g) => ({
        name: g.name, inviteCode: g.inviteCode, examName: g.examName, targetDate: g.targetDate, notice: g.notice
      }))
    };
  }

  function mergeSnapshotIntoLocal(snap) {
    const s = getLocalStore();
    const acc = normalizeAccount(snap.user.account);
    let user = s.users.find((u) => u.account === acc);
    if (!user) {
      user = {
        id: snap.user.id || genId('u'),
        account: acc,
        name: snap.user.name || acc,
        avatar: (snap.user.name || acc).slice(0, 1),
        color: snap.user.color || SYSTEM_COLORS[s.users.length % SYSTEM_COLORS.length],
        passwordHash: snap.user.passwordHash || '',
        streak: snap.user.streak || 0,
        focusMinutesToday: snap.user.focusMinutesToday || 0,
        createdAt: snap.user.createdAt || Date.now()
      };
      s.users.push(user);
    } else {
      user.name = snap.user.name || user.name;
      user.avatar = user.name.slice(0, 1);
      if (snap.user.passwordHash) user.passwordHash = snap.user.passwordHash;
    }

    for (const c of snap.categories || []) ensureLocalCategory(s, user.id, c.name, c.color);
    for (const e of snap.exams || []) {
      if (!s.exams.some((x) => x.userId === user.id && x.name === e.name && x.targetDate === e.targetDate)) {
        s.exams.push({ ...e, id: genId('ex'), userId: user.id });
      }
    }
    for (const t of snap.tasks || []) {
      const existing = s.tasks.find((x) => x.userId === user.id && x.title === t.title && x.date === t.date);
      if (!existing) {
        s.tasks.push({ ...t, id: genId('t'), userId: user.id });
      } else {
        existing.completedDates = Array.from(new Set([...(existing.completedDates || []), ...(t.completedDates || [])]));
      }
    }
    for (const g of snap.groups || []) {
      let grp = s.groups.find((x) => x.inviteCode === g.inviteCode);
      if (!grp) {
        grp = {
          id: genId('g'), name: g.name, inviteCode: g.inviteCode || genInviteCode(),
          examName: g.examName || '共同目标', targetDate: g.targetDate || addDaysStr(60),
          notice: g.notice || '每天按计划完成打卡。', ownerId: user.id, memberIds: [user.id], createdAt: Date.now()
        };
        s.groups.push(grp);
      } else if (!grp.memberIds.includes(user.id)) {
        grp.memberIds.push(user.id);
      }
    }

    saveLocalStore(s);
    return user;
  }

  async function localApi(path, method = 'GET', body = {}) {
    const s = getLocalStore();
    const today = todayKey();

    if (method === 'POST' && path === '/api/reset') {
      saveLocalStore(createEmptyStore());
      return { ok: true };
    }

    if (method === 'POST' && path === '/api/auth/register') {
      const account = normalizeAccount(body.account);
      const name = String(body.name || body.account || '').trim().slice(0, 16);
      const password = String(body.password || '');
      if (account.length < 2) throw new Error('请输入至少 2 位统一账号');
      if (!name) throw new Error('请输入显示昵称');
      if (password.length < 4) throw new Error('请设置至少 4 位密码');

      if (state.mode === 'supabase') {
        const existingRemote = await sbFetch(`shixu_accounts?account=eq.${encodeURIComponent(account)}&select=account`).catch(() => []);
        if (existingRemote && existingRemote.length) throw new Error('该云端账号已注册，请直接切至「登录账户」');
      }
      if (s.users.some((u) => u.account === account)) throw new Error('该统一账号已存在，请直接切至「登录账户」');

      const passwordHash = await hashPassword(account, password);
      const user = {
        id: genId('u'), account, name, avatar: name.slice(0, 1),
        color: SYSTEM_COLORS[s.users.length % SYSTEM_COLORS.length],
        passwordHash, streak: 0, focusMinutesToday: 0, createdAt: Date.now()
      };
      s.users.push(user);

      if (body.joinCode) {
        const code = String(body.joinCode).trim().toUpperCase();
        let grp = s.groups.find((g) => g.inviteCode === code);
        if (!grp && body.sharedGroup && body.sharedGroup.name) {
          grp = {
            id: genId('g'), name: body.sharedGroup.name, inviteCode: code,
            examName: body.sharedGroup.examName || '共同目标',
            targetDate: body.sharedGroup.targetDate || addDaysStr(60),
            notice: body.sharedGroup.notice || '每天按计划完成打卡。',
            ownerId: user.id, memberIds: [user.id], createdAt: Date.now()
          };
          s.groups.push(grp);
        } else if (grp && !grp.memberIds.includes(user.id)) {
          grp.memberIds.push(user.id);
        }
        if (grp) {
          s.feeds.push({ id: genId('f'), groupId: grp.id, userId: user.id, type: 'join', text: '加入了学习小组', createdAt: Date.now(), likedBy: [] });
        }
      }
      saveLocalStore(s);
      return { user };
    }

    if (method === 'POST' && path === '/api/auth/login') {
      const account = normalizeAccount(body.account);
      const password = String(body.password || '');
      if (!account) throw new Error('请输入统一账号');
      const pwdHash = await hashPassword(account, password);

      if (state.mode === 'supabase') {
        const pulled = await pullAccountFromSupabase(account, pwdHash);
        if (pulled) return { user: pulled };
      }

      const user = s.users.find((u) => u.account === account);
      if (!user) {
        throw new Error(
          state.mode === 'supabase'
            ? '云端未找到该账号，请检查账号或先注册'
            : '当前设备未找到该账号；若从旧手机换机而来，请点击「导入账户备份文件」'
        );
      }
      if (user.passwordHash && user.passwordHash !== pwdHash) throw new Error('密码不正确，请重试');
      return { user };
    }

    if (method === 'POST' && path === '/api/account/import') {
      const snap = body.snapshot;
      if (!snap || !snap.user || !snap.user.account) throw new Error('无效的账户备份文件');
      if (snap.user.passwordHash && typeof body.password === 'string') {
        const checkHash = await hashPassword(snap.user.account, body.password);
        if (checkHash !== snap.user.passwordHash) throw new Error('账户密码验证未通过');
      }
      return { user: mergeSnapshotIntoLocal(snap) };
    }

    // Categories CRUD
    if (method === 'POST' && path === '/api/categories') {
      const uid = body.userId || state.userId;
      const name = String(body.name || '').trim().slice(0, 18);
      if (!name) throw new Error('请输入任务大标题');
      const category = ensureLocalCategory(s, uid, name, body.color);
      saveLocalStore(s);
      return { category };
    }

    const cMatch = path.match(/^\/api\/categories\/([^/]+)$/);
    if (cMatch && method === 'PATCH') {
      const cat = s.categories.find((c) => c.id === cMatch[1]);
      if (!cat) throw new Error('大标题不存在');
      const oldName = cat.name;
      if (typeof body.name === 'string' && body.name.trim()) {
        const nextName = body.name.trim().slice(0, 18);
        cat.name = nextName;
        for (const t of s.tasks) {
          if (t.userId === cat.userId && (t.category === oldName || t.subject === oldName)) {
            t.category = nextName;
            t.subject = nextName;
          }
        }
      }
      if (typeof body.color === 'string' && body.color) cat.color = body.color;
      saveLocalStore(s);
      return { category: cat };
    }

    if (cMatch && method === 'DELETE') {
      const idx = s.categories.findIndex((c) => c.id === cMatch[1]);
      if (idx !== -1) {
        const [rem] = s.categories.splice(idx, 1);
        for (const t of s.tasks) {
          if (t.userId === rem.userId && t.category === rem.name) {
            t.category = '未分组';
            t.subject = '未分组';
          }
        }
      }
      saveLocalStore(s);
      return { ok: true };
    }

    // Tasks CRUD + Restore
    if (method === 'POST' && path === '/api/tasks/restore') {
      const t = body.task;
      if (t && t.id && !s.tasks.some((x) => x.id === t.id)) {
        s.tasks.unshift(t);
        if (t.category && t.category !== '未分组') ensureLocalCategory(s, t.userId, t.category);
        saveLocalStore(s);
      }
      return { task: t };
    }

    if (method === 'POST' && path === '/api/tasks') {
      const uid = body.userId || state.userId;
      const title = String(body.title || '').trim().slice(0, 60);
      if (!title) throw new Error('请输入任务名称');
      const categoryName = String(body.category || body.subject || '未分组').trim().slice(0, 18) || '未分组';
      if (categoryName !== '未分组') ensureLocalCategory(s, uid, categoryName, body.categoryColor);

      const taskDate = isValidDateISO(body.date) ? body.date : today;
      const isReview = body.taskType === 'review';
      const cleanReviewDates = isReview && Array.isArray(body.reviewDates)
        ? Array.from(new Set(body.reviewDates.filter((d) => isValidDateISO(d)))).sort()
        : [];
      const task = {
        id: genId('t'),
        userId: uid,
        title,
        category: categoryName,
        subject: categoryName,
        taskType: isReview ? 'review' : 'normal',
        reviewPreset: isReview ? String(body.reviewPreset || 'ebbinghaus').slice(0, 20) : '',
        reviewDates: isReview ? (cleanReviewDates.length ? cleanReviewDates : [taskDate]) : [],
        mistakeNote: isReview ? String(body.mistakeNote || '').trim().slice(0, 120) : '',
        mastery: isReview && MASTERY_LEVELS[body.mastery] ? body.mastery : (isReview ? 'weak' : ''),
        durationMin: Math.min(360, Math.max(5, Number(body.durationMin) || 30)),
        repeatDaily: isReview ? false : Boolean(body.repeatDaily),
        date: taskDate,
        completedDates: [],
        createdAt: Date.now()
      };
      s.tasks.unshift(task);
      saveLocalStore(s);
      return { task };
    }

    const tMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (tMatch && method === 'PATCH') {
      const task = s.tasks.find((t) => t.id === tMatch[1]);
      if (!task) throw new Error('任务不存在');

      if (typeof body.title === 'string' && body.title.trim()) task.title = body.title.trim().slice(0, 60);
      if (typeof body.category === 'string' && body.category.trim()) {
        const cat = body.category.trim().slice(0, 18);
        task.category = cat;
        task.subject = cat;
        if (cat !== '未分组') ensureLocalCategory(s, task.userId, cat);
      }
      if (typeof body.durationMin === 'number' && body.durationMin >= 5) {
        task.durationMin = Math.min(360, Math.round(body.durationMin));
      }
      if (typeof body.repeatDaily === 'boolean') task.repeatDaily = body.repeatDaily;
      if (isValidDateISO(body.scheduledDate)) task.date = body.scheduledDate;
      if (body.taskType === 'review' || body.taskType === 'normal') {
        task.taskType = body.taskType;
        if (task.taskType === 'normal') {
          task.reviewDates = [];
          task.reviewPreset = '';
          task.mistakeNote = '';
          task.mastery = '';
        } else {
          task.repeatDaily = false;
        }
      }
      if (typeof body.reviewPreset === 'string') task.reviewPreset = body.reviewPreset.slice(0, 20);
      if (Array.isArray(body.reviewDates)) {
        task.reviewDates = Array.from(new Set(body.reviewDates.filter((d) => isValidDateISO(d)))).sort();
      }
      if (typeof body.mistakeNote === 'string') task.mistakeNote = body.mistakeNote.trim().slice(0, 120);
      if (body.mastery === '' || MASTERY_LEVELS[body.mastery]) task.mastery = body.mastery;

      const targetDate = isValidDateISO(body.date) ? body.date : today;
      if (!Array.isArray(task.completedDates)) task.completedDates = [];
      const prev = task.completedDates.includes(targetDate);
      if (typeof body.done === 'boolean') {
        if (body.done && !prev) task.completedDates.push(targetDate);
        if (!body.done && prev) task.completedDates = task.completedDates.filter((d) => d !== targetDate);
      }

      let toastMsg = null;
      if (!prev && body.done === true && targetDate === today) {
        const u = s.users.find((x) => x.id === task.userId);
        const st = getDayStats(s.tasks.filter((t) => t.userId === task.userId), today);
        for (const g of s.groups.filter((gr) => gr.memberIds.includes(task.userId))) {
          const text = st.done === st.total && st.total > 0
            ? `完成了今日全部 ${st.total} 项学习任务，达成率 100%`
            : `打卡「${task.category} · ${task.title}」`;
          s.feeds.push({ id: genId('f'), groupId: g.id, userId: task.userId, type: 'checkin', text, createdAt: Date.now(), likedBy: [] });
        }
        toastMsg = `${u ? u.name : '成员'} 刚刚完成打卡：${task.title.slice(0, 14)}`;
      }
      saveLocalStore(s, toastMsg);
      return { task };
    }

    if (tMatch && method === 'DELETE') {
      const idx = s.tasks.findIndex((t) => t.id === tMatch[1]);
      let removed = null;
      if (idx !== -1) [removed] = s.tasks.splice(idx, 1);
      saveLocalStore(s);
      return { ok: true, removed };
    }

    // Exams CRUD
    if (method === 'POST' && path === '/api/exams') {
      const uid = body.userId || state.userId;
      if (body.pinned !== false) for (const e of s.exams) if (e.userId === uid) e.pinned = false;
      const exam = {
        id: genId('ex'), userId: uid, name: String(body.name || '').trim().slice(0, 30),
        tag: String(body.tag || '核心目标').trim().slice(0, 12),
        startDate: today, targetDate: body.targetDate, color: body.color || '#0071E3',
        pinned: body.pinned !== false
      };
      s.exams.push(exam);
      saveLocalStore(s);
      return { exam };
    }

    const eMatch = path.match(/^\/api\/exams\/([^/]+)$/);
    if (eMatch && method === 'PATCH') {
      const ex = s.exams.find((e) => e.id === eMatch[1]);
      if (!ex) throw new Error('目标不存在');
      if (typeof body.name === 'string' && body.name.trim()) ex.name = body.name.trim().slice(0, 30);
      if (typeof body.tag === 'string' && body.tag.trim()) ex.tag = body.tag.trim().slice(0, 12);
      if (isValidDateISO(body.targetDate)) ex.targetDate = body.targetDate;
      if (typeof body.color === 'string' && body.color) ex.color = body.color;
      if (body.pinned === true) {
        for (const e of s.exams) if (e.userId === ex.userId) e.pinned = false;
        ex.pinned = true;
      }
      saveLocalStore(s);
      return { exam: ex };
    }

    if (eMatch && method === 'DELETE') {
      const idx = s.exams.findIndex((e) => e.id === eMatch[1]);
      if (idx !== -1) {
        const [rem] = s.exams.splice(idx, 1);
        if (rem.pinned) {
          const next = s.exams.find((e) => e.userId === rem.userId);
          if (next) next.pinned = true;
        }
      }
      saveLocalStore(s);
      return { ok: true };
    }

    // Focus
    if (method === 'POST' && path === '/api/focus/complete') {
      const u = s.users.find((x) => x.id === (body.userId || state.userId));
      if (u) {
        const mins = Math.min(240, Math.max(1, Number(body.minutes) || 25));
        u.focusMinutesToday = (u.focusMinutesToday || 0) + mins;
        for (const g of s.groups.filter((gr) => gr.memberIds.includes(u.id))) {
          s.feeds.push({ id: genId('f'), groupId: g.id, userId: u.id, type: 'focus', text: `完成了 ${mins} 分钟沉浸专注「${body.label || '专注学习'}」`, createdAt: Date.now(), likedBy: [] });
        }
      }
      saveLocalStore(s);
      return { ok: true };
    }

    // Groups
    if (method === 'POST' && path === '/api/groups') {
      const ownerId = body.userId || state.userId;
      let inviteCode = genInviteCode();
      while (s.groups.some((g) => g.inviteCode === inviteCode)) inviteCode = genInviteCode();
      const group = {
        id: genId('g'), name: String(body.name || '').trim().slice(0, 24), inviteCode,
        examName: String(body.examName || '共同备考目标').trim().slice(0, 24),
        targetDate: body.targetDate || addDaysStr(60),
        notice: String(body.notice || '每天按计划完成打卡，互相监督。').trim().slice(0, 60),
        ownerId, memberIds: [ownerId], createdAt: Date.now()
      };
      s.groups.push(group);
      s.feeds.push({ id: genId('f'), groupId: group.id, userId: ownerId, type: 'join', text: `创建了学习小组「${group.name}」，邀请码 ${inviteCode}`, createdAt: Date.now(), likedBy: [] });
      saveLocalStore(s);
      return { group };
    }

    if (method === 'POST' && path === '/api/groups/join') {
      const uid = body.userId || state.userId;
      const code = String(body.inviteCode || '').trim().toUpperCase();
      let grp = s.groups.find((g) => g.inviteCode === code);

      if (!grp && state.mode === 'supabase') {
        const remote = await sbFetch(`shixu_groups?invite_code=eq.${encodeURIComponent(code)}&select=*`).catch(() => []);
        if (remote && remote.length) {
          const rg = remote[0];
          grp = {
            id: rg.id, inviteCode: rg.invite_code, name: rg.name, examName: rg.exam_name,
            targetDate: rg.target_date, notice: rg.notice, ownerId: rg.owner_id,
            memberIds: Array.isArray(rg.member_ids) ? rg.member_ids : [],
            memberSnapshots: rg.member_snapshots || {}, createdAt: rg.updated_at || Date.now()
          };
          s.groups.push(grp);
          if (Array.isArray(rg.feeds)) s.feeds.push(...rg.feeds);
        }
      }

      if (!grp && body.sharedGroup && body.sharedGroup.name) {
        grp = {
          id: genId('g'), name: body.sharedGroup.name, inviteCode: code || genInviteCode(),
          examName: body.sharedGroup.examName || '共同备考目标',
          targetDate: body.sharedGroup.targetDate || addDaysStr(60),
          notice: body.sharedGroup.notice || '每天按计划完成打卡。',
          ownerId: uid, memberIds: [uid], createdAt: Date.now()
        };
        s.groups.push(grp);
        s.feeds.push({ id: genId('f'), groupId: grp.id, userId: uid, type: 'join', text: `通过邀请链接加入了「${grp.name}」`, createdAt: Date.now(), likedBy: [] });
        saveLocalStore(s);
        return { group: grp };
      }
      if (!grp) throw new Error('未找到该邀请码对应的学习小组，请确认邀请码');
      if (!grp.memberIds.includes(uid)) {
        grp.memberIds.push(uid);
        s.feeds.push({ id: genId('f'), groupId: grp.id, userId: uid, type: 'join', text: `加入小组，共同冲刺「${grp.examName}」`, createdAt: Date.now(), likedBy: [] });
      }
      saveLocalStore(s);
      return { group: grp };
    }

    const gfMatch = path.match(/^\/api\/groups\/([^/]+)\/feed$/);
    if (gfMatch && method === 'POST') {
      const text = String(body.text || '').trim().slice(0, 100);
      if (!text) throw new Error('请输入动态内容');
      s.feeds.push({ id: genId('f'), groupId: gfMatch[1], userId: body.userId || state.userId, type: 'note', text, createdAt: Date.now(), likedBy: [] });
      saveLocalStore(s);
      return { ok: true };
    }

    const glMatch = path.match(/^\/api\/groups\/([^/]+)\/leave$/);
    if (glMatch && method === 'POST') {
      const grp = s.groups.find((g) => g.id === glMatch[1]);
      if (grp) {
        grp.memberIds = grp.memberIds.filter((id) => id !== (body.userId || state.userId));
        if (grp.memberIds.length === 0) s.groups = s.groups.filter((g) => g.id !== grp.id);
        saveLocalStore(s);
      }
      return { ok: true };
    }

    const nMatch = path.match(/^\/api\/groups\/([^/]+)\/nudge$/);
    if (nMatch && method === 'POST') {
      const fromUser = s.users.find((u) => u.id === body.fromUserId);
      const toUser = s.users.find((u) => u.id === body.toUserId) || { name: '组员' };
      if (!fromUser) throw new Error('成员不存在');
      const kind = body.kind === 'cheer' ? 'cheer' : 'nudge';
      const p = getPack();
      const text = kind === 'cheer' ? p.cheerText(toUser.name) : p.nudgeText(toUser.name);
      s.feeds.push({ id: genId('f'), groupId: nMatch[1], userId: fromUser.id, type: kind, text, createdAt: Date.now(), likedBy: [] });
      saveLocalStore(s, `${fromUser.name}：${text}`);
      return { ok: true };
    }

    const lMatch = path.match(/^\/api\/feeds\/([^/]+)\/like$/);
    if (lMatch && method === 'POST') {
      const f = s.feeds.find((x) => x.id === lMatch[1]);
      if (f) {
        const uid = body.userId || state.userId;
        const i = f.likedBy.indexOf(uid);
        if (i === -1) f.likedBy.push(uid);
        else f.likedBy.splice(i, 1);
        saveLocalStore(s);
      }
      return { ok: true };
    }

    return { ok: true };
  }

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (state.mode !== 'server') return localApi(path, method, body);
    const res = await fetch(`.${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!res.ok) throw new Error(payload.error || '请求失败');
    return payload;
  }

  function syncThemeMeta() {
    const p = getPack();
    const isDark = state.theme === 'dark';
    const metaTheme = document.getElementById('meta-theme-color');
    const metaStatus = document.getElementById('meta-status-bar');
    if (metaTheme) metaTheme.setAttribute('content', isDark ? p.darkMeta : p.lightMeta);
    if (metaStatus) metaStatus.setAttribute('content', isDark ? 'black-translucent' : 'default');
  }

  function applyTheme(theme) {
    state.theme = theme;
    safeStorageSet('shixu_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeMeta();
    document.getElementById('theme-icon-sun').classList.toggle('hidden', theme === 'dark');
    document.getElementById('theme-icon-moon').classList.toggle('hidden', theme !== 'dark');
  }

  function applyStylePack(packId) {
    const id = STYLE_PACKS[packId] ? packId : 'apple';
    state.stylePack = id;
    safeStorageSet('shixu_style_pack', id);
    idbSet('stylePack', id);
    document.documentElement.setAttribute('data-style', id);
    syncThemeMeta();

    const p = getPack();
    const tabMap = { today: 'tab-btn-today', groups: 'tab-btn-groups', exams: 'tab-btn-exams', desktop: 'tab-btn-desktop' };
    for (const [key, domId] of Object.entries(tabMap)) {
      const lbl = document.querySelector(`#${domId} .tab-label`);
      if (lbl && p.tabs[key]) lbl.textContent = p.tabs[key];
    }
    if (!state.focus.running) {
      const defaults = Object.values(STYLE_PACKS).map((x) => x.focusDefaultLabel);
      if (defaults.includes(state.focus.label)) state.focus.label = p.focusDefaultLabel;
    }
  }

  function openStylePackSheet() {
    const packs = Object.values(STYLE_PACKS);
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">主题风格与话术切换</h2>
        ${sheetCloseBtn()}
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
        自由选择你喜欢的界面视觉与专属陪伴话术，随时无损切换，所有学习数据完整保留。
      </p>

      <div class="theme-pack-list">
        ${packs.map((p) => `
          <button type="button" class="theme-pack-card ${state.stylePack === p.id ? 'is-selected' : ''}" data-pick-style="${p.id}">
            <div class="theme-pack-swatch" style="background:${p.swatchBg}">${p.swatchIcon}</div>
            <div class="theme-pack-info">
              <div class="theme-pack-name">
                <span>${esc(p.name)}</span>
                <span class="meta-tag">${esc(p.badge)}</span>
              </div>
              <div class="theme-pack-desc">${esc(p.desc)}</div>
            </div>
            ${state.stylePack === p.id ? '<span class="account-check">使用中</span>' : ''}
          </button>
        `).join('')}
      </div>

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-separator);display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:13px;font-weight:600;">明暗外观模式</span>
        <div class="segmented-control">
          <button type="button" class="seg-btn ${state.theme === 'light' ? 'is-active' : ''}" data-pick-mode="light">浅色模式</button>
          <button type="button" class="seg-btn ${state.theme === 'dark' ? 'is-active' : ''}" data-pick-mode="dark">深色暗夜</button>
        </div>
      </div>
    `);

    sheetContent.querySelectorAll('[data-pick-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextPack = btn.dataset.pickStyle;
        applyStylePack(nextPack);
        syncHeader();
        renderView(false);
        openStylePackSheet();
        showHud(`已切换为「${STYLE_PACKS[nextPack].name}」主题`);
      });
    });

    sheetContent.querySelectorAll('[data-pick-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.pickMode);
        if (state.activeTab === 'desktop' && state.data && state.data.user) renderView(false);
        openStylePackSheet();
      });
    });
  }

  // =========================================================================
  // iOS Safari VisualViewport Guard (Prevents keyboard viewport shift &
  // fixed-button hit-testing offset on iPhone Safari!)
  // =========================================================================

  function syncVisualViewportVars() {
    const vv = window.visualViewport;
    if (!vv) return;
    const h = Math.round(vv.height);
    const t = Math.max(0, Math.round(vv.offsetTop));
    document.documentElement.style.setProperty('--vv-height', `${h}px`);
    document.documentElement.style.setProperty('--vv-top', `${t}px`);
  }

  function resetIOSViewportScroll() {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
    syncVisualViewportVars();
  }

  function blurActiveInput() {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      el.blur();
    }
  }

  (function initIOSViewportGuard() {
    syncVisualViewportVars();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncVisualViewportVars);
      window.visualViewport.addEventListener('scroll', syncVisualViewportVars);
    }
    window.addEventListener('orientationchange', () => {
      setTimeout(resetIOSViewportScroll, 120);
    });
    document.addEventListener('focusout', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
        requestAnimationFrame(resetIOSViewportScroll);
        setTimeout(resetIOSViewportScroll, 80);
        setTimeout(resetIOSViewportScroll, 220);
      }
    });
  })();

  // =========================================================================
  // Native iOS Bottom Sheet with 1:1 Touch Swipe-Down to Dismiss + Esc Key
  // =========================================================================

  function openSheet(html) {
    blurActiveInput();
    resetIOSViewportScroll();
    sheetPanel.style.transform = '';
    sheetPanel.classList.remove('is-dragging');
    sheetContent.scrollTop = 0;
    sheetContent.innerHTML = html;
    sheetBackdrop.classList.remove('hidden');
    sheetBackdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      syncVisualViewportVars();
      sheetBackdrop.classList.add('is-open');
    });
  }

  function closeSheet() {
    blurActiveInput();
    sheetPanel.style.transform = '';
    sheetPanel.classList.remove('is-dragging');
    sheetBackdrop.classList.remove('is-open');
    sheetBackdrop.setAttribute('aria-hidden', 'true');
    requestAnimationFrame(resetIOSViewportScroll);
    setTimeout(() => {
      resetIOSViewportScroll();
      if (!sheetBackdrop.classList.contains('is-open')) sheetBackdrop.classList.add('hidden');
    }, 300);
  }

  sheetBackdrop.addEventListener('click', (e) => { if (e.target === sheetBackdrop) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetBackdrop.classList.contains('is-open')) closeSheet();
  });

  // Real iOS Sheet Touch Swipe-Down Gesture on grabber bar
  (function initSheetDragGesture() {
    const grabber = sheetPanel.querySelector('.sheet-grabber-wrap');
    if (!grabber) return;
    let startY = 0;
    let currentY = 0;
    let dragging = false;

    grabber.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      if (e.target && e.target.closest('button, input, textarea, a')) return;
      startY = e.touches[0].clientY;
      currentY = 0;
      dragging = true;
    }, { passive: true });

    grabber.addEventListener('touchmove', (e) => {
      if (!dragging || !e.touches || !e.touches[0]) return;
      const dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy < 8) return;
      sheetPanel.classList.add('is-dragging');
      currentY = dy;
      sheetPanel.style.transform = `translate3d(0, ${dy}px, 0)`;
    }, { passive: true });

    grabber.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      sheetPanel.classList.remove('is-dragging');
      if (currentY > 84) closeSheet();
      else sheetPanel.style.transform = '';
    });
  })();

  // =========================================================================
  // Bootstrap & Data Refresh (Preserves scroll position, avoids mid-animation flash)
  // =========================================================================

  async function loadBootstrap(silent = false) {
    if (state.mode === 'auto') {
      try {
        const res = await fetch(`./api/bootstrap?userId=${encodeURIComponent(state.userId)}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json();
          if (data && 'user' in data) {
            state.mode = 'server';
            applyBootstrapData(data, !silent);
            return;
          }
        }
      } catch {}
      state.mode = getSupabaseConfig() ? 'supabase' : 'local';
    }

    if (state.mode === 'server') {
      try {
        const data = await api(`/api/bootstrap?userId=${encodeURIComponent(state.userId)}`);
        applyBootstrapData(data, !silent);
      } catch (err) {
        if (!silent) showHud(err.message || '连接服务失败', 'var(--red)');
      }
    } else {
      if (state.mode === 'supabase' && state.userId && !silent) {
        const localUser = getLocalStore().users.find((u) => u.id === state.userId);
        if (localUser && localUser.account) {
          await pullAccountFromSupabase(localUser.account, null).catch(() => {});
        }
      }
      applyBootstrapData(buildLocalBootstrap(state.userId), !silent);
    }
  }

  function applyBootstrapData(data, animate) {
    state.data = data;
    if (data.user) saveSession(data.user.id, data.user.account);
    if (!state.activeGroupId || !data.groups.some((g) => g.id === state.activeGroupId)) {
      state.activeGroupId = data.groups[0] ? data.groups[0].id : null;
    }
    syncHeader();
    renderView(animate);
  }

  function buildLocalScriptableCode() {
    const today = todayKey();
    const pinned = (state.data && state.data.exams[0]) || { name: '尚未设定目标', targetDate: today };
    const todayStats = getDayStats(state.data ? state.data.tasks : [], today);
    const appUrl = window.location.origin + window.location.pathname;
    const tasksJson = JSON.stringify(todayStats.list.slice(0, 3).map((t) => ({ title: `${t.category} · ${t.title}`, done: isTaskDoneOnDate(t, today) })));
    return `// 时序 StudyOS · iOS 桌面实时倒计时小组件 (Scriptable)
const APP_URL = ${JSON.stringify(appUrl)};
const EXAM_NAME = ${JSON.stringify(pinned.name)};
const TARGET_DATE = ${JSON.stringify(pinned.targetDate)};
const TASKS = ${tasksJson};

const now = new Date(); now.setHours(0,0,0,0);
const target = new Date(TARGET_DATE + "T00:00:00");
const daysLeft = Math.max(0, Math.ceil((target - now) / 86400000));

const w = new ListWidget();
w.url = APP_URL;
w.setPadding(16, 18, 16, 18);
w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"));
const fg = Color.dynamic(new Color("#1D1D1F"), new Color("#F5F5F7"));
const muted = Color.dynamic(new Color("#6E6E73"), new Color("#98989D"));
const accent = Color.dynamic(new Color("#0071E3"), new Color("#0A84FF"));

const row = w.addStack();
row.layoutHorizontally();
row.centerAlignContent();

const left = row.addStack();
left.layoutVertically();
left.size = new Size(122, 0);
const t1 = left.addText(EXAM_NAME); t1.font = Font.semiboldSystemFont(12); t1.textColor = muted; t1.lineLimit = 1;
left.addSpacer(4);
const nr = left.addStack(); nr.bottomAlignContent();
const dn = nr.addText(String(daysLeft)); dn.font = Font.boldRoundedSystemFont(40); dn.textColor = fg;
nr.addSpacer(3);
const du = nr.addText("天"); du.font = Font.mediumSystemFont(13); du.textColor = muted;
left.addSpacer(4);
const dt = left.addText(TARGET_DATE); dt.font = Font.semiboldSystemFont(11); dt.textColor = accent;

row.addSpacer(14);
const right = row.addStack();
right.layoutVertically();
const hd = right.addText("今日学习任务"); hd.font = Font.semiboldSystemFont(12); hd.textColor = fg;
right.addSpacer(6);
if (!TASKS.length) {
  const em = right.addText("点击打开网页添加任务"); em.font = Font.mediumSystemFont(12); em.textColor = muted;
} else {
  for (const item of TASKS) {
    const tr = right.addStack(); tr.centerAlignContent();
    const mk = tr.addText(item.done ? "● " : "○ "); mk.font = Font.systemFont(11); mk.textColor = item.done ? accent : muted;
    const tx = tr.addText(item.title); tx.font = Font.mediumSystemFont(12); tx.textColor = item.done ? muted : fg; tx.lineLimit = 1;
    right.addSpacer(4);
  }
}
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();`;
  }

  async function loadScriptableSnippet() {
    if (state.mode === 'server') {
      try {
        const res = await fetch(`./api/widget/scriptable?userId=${encodeURIComponent(state.userId)}`);
        if (res.ok) { state.scriptableCode = await res.text(); return; }
      } catch {}
    }
    state.scriptableCode = buildLocalScriptableCode();
  }

  function syncHeader() {
    const u = state.data && state.data.user;
    if (u) {
      navAvatar.textContent = u.avatar;
      navAvatar.style.background = u.color || 'var(--accent)';
      navUsername.textContent = u.name;
    } else {
      navAvatar.textContent = '我';
      navAvatar.style.background = 'var(--accent)';
      navUsername.textContent = '统一账户';
    }
    const p = getPack();
    const compactMap = { groups: p.groupTitle, exams: p.examTitle, desktop: p.tabs.desktop };
    compactTitle.textContent = u
      ? (state.activeTab === 'today' ? getRelativeDayTitle(state.selectedDate) : (compactMap[state.activeTab] || TAB_TITLES[state.activeTab] || '时序'))
      : '时序';
    const showFab = Boolean(u) && (state.activeTab === 'today' || state.activeTab === 'exams');
    fabAdd.classList.toggle('is-hidden', !showFab);
  }

  // =========================================================================
  // Timeline & Monthly Progress Calendar
  // =========================================================================

  function buildTimelineSection(tasks) {
    const today = todayKey();
    const yesterday = shiftDateISO(today, -1);
    const tomorrow = shiftDateISO(today, 1);
    const sel = state.selectedDate;

    const railDates = [];
    for (let i = -3; i <= 3; i++) railDates.push(shiftDateISO(sel, i));

    let monthHtml = '';
    if (state.showMonthCalendar) {
      const [y, m] = state.viewMonth.split('-').map(Number);
      const firstDay = new Date(y, m - 1, 1);
      const daysInMonth = new Date(y, m, 0).getDate();
      const startOffset = (firstDay.getDay() + 6) % 7;

      let monthDoneCount = 0;
      let monthPerfectDays = 0;
      let monthScheduledDays = 0;
      let monthPctSum = 0;

      const cells = [];
      for (let pad = 0; pad < startOffset; pad++) cells.push('<div></div>');
      for (let day = 1; day <= daysInMonth; day++) {
        const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const st = getDayStats(tasks, ds);
        if (st.total > 0) {
          monthScheduledDays++;
          monthDoneCount += st.done;
          monthPctSum += st.pct;
          if (st.done === st.total) monthPerfectDays++;
        }
        const ringColor = st.total === 0
          ? 'transparent'
          : (st.done === st.total ? 'var(--green)' : (st.done > 0 ? 'var(--accent)' : 'var(--text-tertiary)'));
        const ringPct = st.total === 0 ? 0 : (st.done > 0 ? st.pct : 100);
        const ringOpacity = st.total > 0 && st.done === 0 ? '0.28' : '1';
        const r = 14;
        const c = 2 * Math.PI * r;
        const off = c * (1 - ringPct / 100);

        cells.push(`
          <button class="cal-cell ${ds === sel ? 'is-selected' : ''} ${ds === today ? 'is-today' : ''}" data-action="pick-date" data-date="${ds}">
            <span class="cal-day-ring">
              <svg width="34" height="34" viewBox="0 0 34 34">
                <circle class="ring-track" cx="17" cy="17" r="${r}" stroke-width="2.6" />
                ${st.total > 0 ? `<circle class="ring-fill" cx="17" cy="17" r="${r}" stroke="${ringColor}" stroke-opacity="${ringOpacity}" stroke-width="2.6" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" />` : ''}
              </svg>
              <span class="cal-day-num">${day}</span>
            </span>
          </button>
        `);
      }

      const avgPct = monthScheduledDays ? Math.round(monthPctSum / monthScheduledDays) : 0;

      monthHtml = `
        <div class="month-panel">
          <div class="month-nav">
            <span class="month-label tabular">${y} 年 ${m} 月任务进程</span>
            <div class="month-nav-btns">
              <button class="month-arrow-btn" data-action="shift-month" data-delta="-1" aria-label="上个月">‹</button>
              <button class="btn-secondary btn-sm" style="padding:4px 10px;font-size:11px;" data-action="pick-date" data-date="${today}">回今日</button>
              <button class="month-arrow-btn" data-action="shift-month" data-delta="1" aria-label="下个月">›</button>
            </div>
          </div>

          <div class="month-kpi-strip">
            <div class="month-kpi">
              <div class="month-kpi-val">${monthDoneCount}</div>
              <div class="month-kpi-lbl">本月已完成</div>
            </div>
            <div class="month-kpi">
              <div class="month-kpi-val" style="color:var(--green);">${monthPerfectDays} 天</div>
              <div class="month-kpi-lbl">全勤达标</div>
            </div>
            <div class="month-kpi">
              <div class="month-kpi-val" style="color:var(--accent);">${avgPct}%</div>
              <div class="month-kpi-lbl">月均达成率</div>
            </div>
          </div>

          <div class="cal-weekdays">
            <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
          </div>
          <div class="cal-grid">${cells.join('')}</div>
          <div class="cal-legend">
            <span class="cal-legend-item"><span class="legend-dot" style="background:var(--green);"></span>全部完成</span>
            <span class="cal-legend-item"><span class="legend-dot" style="background:var(--accent);"></span>进行中</span>
            <span class="cal-legend-item"><span class="legend-dot" style="background:var(--text-tertiary);opacity:0.45;"></span>待开始</span>
          </div>
        </div>
      `;
    }

    return `
      <section class="card timeline-card">
        <div class="timeline-top">
          <div class="segmented-control" role="tablist" aria-label="快速切换昨日今日明日">
            <button class="seg-btn ${sel === yesterday ? 'is-active' : ''}" data-action="pick-date" data-date="${yesterday}">昨日</button>
            <button class="seg-btn ${sel === today ? 'is-active' : ''}" data-action="pick-date" data-date="${today}">今日</button>
            <button class="seg-btn ${sel === tomorrow ? 'is-active' : ''}" data-action="pick-date" data-date="${tomorrow}">明日</button>
          </div>
          <button class="month-toggle-btn ${state.showMonthCalendar ? 'is-open' : ''}" data-action="toggle-month-cal">
            <span>${state.showMonthCalendar ? '收起月历' : '月进程'}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>

        <div class="date-rail">
          ${railDates.map((ds) => {
            const d = parseDateISO(ds);
            const st = getDayStats(tasks, ds);
            const dotCls = st.total === 0 ? '' : (st.done === st.total ? 'has-all' : (st.done > 0 ? 'has-partial' : 'has-todo'));
            return `
              <button class="date-chip ${ds === sel ? 'is-selected' : ''} ${ds === today ? 'is-today' : ''}" data-action="pick-date" data-date="${ds}">
                <span class="date-chip-wk">${WEEKDAYS_SHORT[d.getDay()]}</span>
                <span class="date-chip-num">${d.getDate()}</span>
                <span class="date-chip-dot ${dotCls}"></span>
              </button>
            `;
          }).join('')}
        </div>

        ${monthHtml}
      </section>
    `;
  }

  // =========================================================================
  // View Rendering (Scroll-Preserving, Zero-Flicker)
  // =========================================================================

  function renderView(animate = true) {
    if (!state.data) return;
    syncHeader();

    const savedScroll = mainScroll.scrollTop;
    if (animate) {
      viewContainer.style.animation = 'none';
      void viewContainer.offsetWidth;
      viewContainer.style.animation = '';
    }

    if (!state.data.user) {
      if (state.data.users.length === 0 && state.authMode === 'login' && !state.pendingRestore) {
        state.authMode = 'register';
      }
      viewContainer.innerHTML = buildUnifiedAuthView();
      bindUnifiedAuthEvents();
      return;
    }

    const p = getPack();
    const focusCapsule = state.focus.running ? `
      <div class="focus-live-bar" data-action="open-focus" role="button" aria-label="展开正在运行的专注计时">
        <div class="focus-live-left">
          <span class="focus-live-dot"></span>
          <span class="focus-live-label">${esc(p.focusLivePrefix)} · ${esc(state.focus.label)}</span>
        </div>
        <span id="live-focus-bar-clock" class="focus-live-time">${formatTimer(getFocusRemainingSec())}</span>
      </div>
    ` : '';

    if (state.activeTab === 'today') {
      viewContainer.innerHTML = focusCapsule + buildTodayView();
    } else if (state.activeTab === 'groups') {
      viewContainer.innerHTML = focusCapsule + buildGroupsView();
      bindGroupFeedComposer();
    } else if (state.activeTab === 'exams') {
      viewContainer.innerHTML = focusCapsule + buildExamsView();
    } else if (state.activeTab === 'desktop') {
      viewContainer.innerHTML = focusCapsule + buildDesktopView();
      requestAnimationFrame(() => {
        const previewImg = document.getElementById('wallpaper-preview-img');
        if (previewImg) previewImg.src = renderLockscreenCanvasDataUrl(true);
      });
      loadScriptableSnippet().then(() => {
        const codeEl = document.getElementById('scriptable-code-preview');
        if (codeEl) codeEl.textContent = state.scriptableCode;
      });
    }

    if (!animate) mainScroll.scrollTop = savedScroll;
  }

  function buildUnifiedAuthView() {
    const p = getPack();
    const isReg = state.authMode === 'register';
    const invite = state.pendingInvite;
    const restore = state.pendingRestore;
    const cloudReady = state.mode === 'server' || state.mode === 'supabase';
    const existingUsers = (state.data && state.data.users) || [];

    return `
      <div style="padding:18px 4px 12px;text-align:center;">
        <img src="./icons/apple-touch-icon.png" alt="时序图标" style="width:72px;height:72px;border-radius:18px;box-shadow:0 12px 28px rgba(0,113,227,0.22);margin-bottom:14px;" />
        <h1 class="page-title" style="font-size:28px;">${esc(p.authTitle)}</h1>
        <p style="font-size:13px;line-height:1.55;color:var(--text-secondary);margin:8px auto 14px;max-width:310px;">
          ${cloudReady
            ? '云端永久记忆已开启：无论网站升级或更换任意设备，登录同一账户即可自动恢复全部学习记录。'
            : '账户数据采用本地双层永久存储，网站升级绝不丢失；更换设备时可通过换机迁移码或备份文件完整恢复。'}
        </p>

        <div style="margin-bottom:16px;">
          <button type="button" class="btn-secondary btn-sm" data-action="open-style-packs">
            当前主题：${esc(p.name)} · 切换风格 ›
          </button>
        </div>

        ${restore ? `
          <div class="card card-padded" style="text-align:left;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--green);">已识别换机迁移数据包</div>
            <div style="font-size:15px;font-weight:700;margin-top:4px;">账户：${esc(restore.user.name)} (@${esc(restore.user.account)})</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">包含 ${(restore.categories || []).length} 个大标题 · ${(restore.tasks || []).length} 项任务 · ${(restore.exams || []).length} 个倒计时</div>
            <form id="form-unlock-restore" style="margin-top:12px;">
              <div class="field" style="margin-bottom:10px;">
                <input id="input-restore-pwd" class="input" type="password" required placeholder="输入原账户密码以解锁恢复全部数据" />
              </div>
              <button type="submit" class="btn-primary btn-block">验证密码并恢复全部数据</button>
            </form>
          </div>
        ` : ''}

        ${invite && invite.sharedGroup ? `
          <div class="card card-padded" style="text-align:left;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:600;color:var(--accent);">收到学习小组邀请</div>
            <div style="font-size:15px;font-weight:700;margin-top:3px;">${esc(invite.sharedGroup.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">共同目标：${esc(invite.sharedGroup.examName)} · ${esc(invite.sharedGroup.targetDate)}</div>
          </div>
        ` : ''}

        <div class="card card-padded" style="text-align:left;">
          <div class="segmented-control" style="width:100%;display:grid;grid-template-columns:1fr 1fr;margin-bottom:16px;">
            <button type="button" class="seg-btn ${!isReg ? 'is-active' : ''}" id="auth-tab-login">登录已有账户</button>
            <button type="button" class="seg-btn ${isReg ? 'is-active' : ''}" id="auth-tab-register">注册统一账户</button>
          </div>

          <form id="form-unified-auth">
            <div class="field">
              <label class="field-label" for="input-auth-account">统一账号（手机号 / 英文账号）</label>
              <input id="input-auth-account" class="input" type="text" required maxlength="40" autocomplete="username" placeholder="例如：13800138000 或 alex" />
            </div>
            ${isReg ? `
              <div class="field">
                <label class="field-label" for="input-auth-name">显示昵称</label>
                <input id="input-auth-name" class="input" type="text" required maxlength="16" placeholder="例如：小陈" />
              </div>
            ` : ''}
            <div class="field">
              <label class="field-label" for="input-auth-pwd">${isReg ? '设置登录密码（至少 4 位）' : '输入登录密码'}</label>
              <input id="input-auth-pwd" class="input" type="password" required minlength="4" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="••••••" />
            </div>
            <button type="submit" class="btn-primary btn-block">${isReg ? '注册并记住账户' : '登录并恢复数据'}</button>
          </form>

          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-separator);display:flex;justify-content:space-between;align-items:center;font-size:12px;">
            <span style="color:var(--text-secondary);">从旧手机迁移数据？</span>
            <button type="button" style="color:var(--accent);font-weight:600;" data-action="trigger-import-backup">导入账户备份文件</button>
          </div>
        </div>

        ${existingUsers.length ? `
          <div style="margin-top:14px;text-align:left;">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:0 4px 8px;">本机已记忆的统一账户</div>
            ${existingUsers.map((u) => `
              <button class="account-row" data-quick-fill-account="${esc(u.account)}">
                <div class="account-left">
                  <span class="avatar-dot" style="width:30px;height:30px;font-size:12px;background:${u.color}">${esc(u.avatar)}</span>
                  <div style="text-align:left;">
                    <div style="font-size:14px;font-weight:600;">${esc(u.name)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">@${esc(u.account)}</div>
                  </div>
                </div>
                <span style="font-size:12px;color:var(--accent);font-weight:600;">快速登录</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function bindUnifiedAuthEvents() {
    const loginTab = document.getElementById('auth-tab-login');
    const regTab = document.getElementById('auth-tab-register');
    if (loginTab) loginTab.addEventListener('click', () => { state.authMode = 'login'; renderView(false); });
    if (regTab) regTab.addEventListener('click', () => { state.authMode = 'register'; renderView(false); });

    const unlockForm = document.getElementById('form-unlock-restore');
    if (unlockForm && state.pendingRestore) {
      unlockForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('input-restore-pwd').value;
        try {
          const res = await api('/api/account/import', {
            method: 'POST',
            body: JSON.stringify({ snapshot: state.pendingRestore, password: pwd })
          });
          state.pendingRestore = null;
          saveSession(res.user.id, res.user.account);
          await loadBootstrap(false);
          showHud(`欢迎回来，${res.user.name}！数据已完整恢复`);
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    }

    const authForm = document.getElementById('form-unified-auth');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const account = document.getElementById('input-auth-account').value.trim();
        const password = document.getElementById('input-auth-pwd').value;
        try {
          if (state.authMode === 'register') {
            const name = document.getElementById('input-auth-name').value.trim();
            const payload = { account, name, password };
            if (state.pendingInvite) {
              payload.joinCode = state.pendingInvite.code;
              payload.sharedGroup = state.pendingInvite.sharedGroup;
            }
            const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
            saveSession(res.user.id, res.user.account);
            const joined = Boolean(state.pendingInvite);
            state.pendingInvite = null;
            if (joined) { state.activeTab = 'groups'; syncTabButtons(); }
            await loadBootstrap(false);
            showHud(`统一账户 @${res.user.account} 已创建并记住`);
          } else {
            const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) });
            saveSession(res.user.id, res.user.account);
            await loadBootstrap(false);
            showHud(`欢迎回来，${res.user.name}`);
          }
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    }

    viewContainer.querySelectorAll('[data-quick-fill-account]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.authMode = 'login';
        renderView(false);
        const accInput = document.getElementById('input-auth-account');
        const pwdInput = document.getElementById('input-auth-pwd');
        if (accInput) accInput.value = btn.dataset.quickFillAccount;
        if (pwdInput) pwdInput.focus();
      });
    });
  }

  function buildTodayView() {
    const p = getPack();
    const { user, tasks, categories, exams, groups } = state.data;
    const sel = state.selectedDate;
    const pinned = exams[0];
    const dayStats = getDayStats(tasks, sel);
    const primaryGroup = groups[0];
    const realmLabel = state.stylePack === 'xianxia' ? getXianxiaRealm(user.streak) : '';

    const allReviewTasks = tasks.filter((t) => isReviewTask(t));
    const dayReviewCount = dayStats.list.filter((t) => isReviewTask(t)).length;
    const dayTodoCount = dayStats.list.filter((t) => !isTaskDoneOnDate(t, sel)).length;

    const visibleList = dayStats.list.filter((t) => {
      if (state.taskFilter === 'review') return isReviewTask(t);
      if (state.taskFilter === 'todo') return !isTaskDoneOnDate(t, sel);
      return true;
    });

    const colorMap = new Map();
    for (const c of categories) colorMap.set(c.name, c.color);

    const groupMap = new Map();
    for (const c of categories) {
      const catTasks = visibleList.filter((t) => t.category === c.name);
      if (catTasks.length) groupMap.set(c.name, catTasks);
    }
    for (const t of visibleList) {
      const key = t.category || '未分组';
      if (!groupMap.has(key)) groupMap.set(key, []);
      if (!groupMap.get(key).includes(t)) groupMap.get(key).push(t);
    }

    const groupedEntries = Array.from(groupMap.entries()).map(([catName, items]) => {
      const sorted = [...items].sort((a, b) => Number(isTaskDoneOnDate(a, sel)) - Number(isTaskDoneOnDate(b, sel)));
      return {
        name: catName,
        color: colorMap.get(catName) || 'var(--accent)',
        items: sorted,
        done: sorted.filter((t) => isTaskDoneOnDate(t, sel)).length
      };
    });

    return `
      <div class="page-header">
        <div>
          <div class="page-date">${formatDateCN(sel)}</div>
          <h1 class="page-title">${getRelativeDayTitle(sel)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${realmLabel ? `<span class="realm-badge">${realmLabel}</span>` : ''}
          ${primaryGroup ? `
            <button type="button" class="btn-secondary btn-sm" data-action="goto-groups">${esc(p.tabs.groups)} ${primaryGroup.teamPct}%</button>
          ` : ''}
        </div>
      </div>

      ${pinned ? `
        <section class="hero-countdown" data-action="goto-exams" style="cursor:pointer;">
          ${getHeroThemeMotifSVG()}
          <div class="hero-top">
            <span>${esc(pinned.tag)}</span>
            <span class="hero-target-date">${esc(pinned.targetDate)}</span>
          </div>
          <h2 class="hero-exam-name">${esc(pinned.name)}</h2>
          <div class="hero-metrics">
            <div class="hero-days-wrap">
              <span class="hero-days-num">${pinned.daysLeft}</span>
              <span class="hero-days-unit">天</span>
            </div>
            <div class="hero-progress-meta">
              <div>约 ${Math.max(1, Math.ceil(pinned.daysLeft / 7))} 周 · ${esc(p.progressMeta)}</div>
              <div class="hero-progress-val tabular">${pinned.progress}%</div>
            </div>
          </div>
          <div class="hero-bar">
            <div class="hero-bar-fill" style="width:${pinned.progress}%"></div>
          </div>
        </section>
      ` : `
        <section class="card card-padded" style="text-align:center;padding:20px 18px;">
          <div style="font-size:15px;font-weight:700;">${esc(p.countdownEmptyTitle)}</div>
          <p style="font-size:12px;color:var(--text-secondary);margin:5px 0 12px;">${esc(p.countdownEmptyDesc)}</p>
          <button type="button" class="btn-primary btn-sm" data-action="open-add-exam">${esc(p.countdownEmptyBtn)}</button>
        </section>
      `}

      ${buildTimelineSection(tasks)}

      <section class="summary-strip">
        <button type="button" class="card summary-tile" data-action="open-analytics" style="text-align:left;">
          <div>
            <div class="summary-label">${sel === todayKey() ? esc(p.tileProgressToday) : esc(p.tileProgressOther)}</div>
            <div class="summary-value tabular">${dayStats.done} / ${dayStats.total}</div>
            <div class="summary-sub" style="color:var(--accent);font-weight:500;">${state.stylePack === 'xianxia' ? `${realmLabel} · 复盘 ›` : `连续 ${user.streak} 天 · 复盘 ›`}</div>
          </div>
          <div class="ring-box">
            ${ringSVG(dayStats.pct, 48, 5, dayStats.pct === 100 && dayStats.total > 0 ? 'var(--green)' : 'var(--accent)')}
            <span class="ring-center">${dayStats.pct}%</span>
          </div>
        </button>

        <button type="button" class="card summary-tile" data-action="open-focus" style="text-align:left;">
          <div>
            <div class="summary-label">${esc(p.tileFocus)}</div>
            <div class="summary-value tabular">${user.focusMinutesToday || 0}<span style="font-size:13px;font-weight:500;margin-left:2px;">分</span></div>
            <div class="summary-sub" style="color:var(--accent);font-weight:500;">${state.focus.running ? esc(p.tileFocusRunning) : esc(p.tileFocusCta)}</div>
          </div>
          <div class="ring-box">
            ${ringSVG(Math.min(100, Math.round(((user.focusMinutesToday || 0) / 180) * 100)), 48, 5, 'var(--green)')}
            <span class="ring-center" style="font-size:10px;">${esc(p.focusRingLabel)}</span>
          </div>
        </button>
      </section>

      <div class="section-header">
        <h2 class="section-title">${formatDateCN(sel)} · ${esc(p.taskSeqLabel)}</h2>
        <div style="display:flex;align-items:center;gap:10px;">
          <button type="button" class="section-action" style="color:var(--text-secondary);" data-action="open-manage-categories">${esc(p.manageCatsBtn)}</button>
          <button type="button" class="section-action" style="color:var(--orange);" data-action="open-add-review">${esc(p.addReviewBtn)}</button>
          <button type="button" class="section-action" data-action="open-add-task">${esc(p.addTaskBtn)}</button>
        </div>
      </div>

      <div class="task-filter-bar">
        <div class="segmented-control">
          <button type="button" class="seg-btn ${state.taskFilter === 'all' ? 'is-active' : ''}" data-action="set-task-filter" data-filter="all">全部 (${dayStats.total})</button>
          <button type="button" class="seg-btn ${state.taskFilter === 'review' ? 'is-active' : ''}" data-action="set-task-filter" data-filter="review">${esc(p.reviewLabel)} (${dayReviewCount})</button>
          <button type="button" class="seg-btn ${state.taskFilter === 'todo' ? 'is-active' : ''}" data-action="set-task-filter" data-filter="todo">待完成 (${dayTodoCount})</button>
        </div>
        <button type="button" class="review-notebook-btn" data-action="open-review-notebook">
          <span>${esc(p.reviewNotebook)}</span>
          <span class="tabular">${allReviewTasks.length}</span>
        </button>
      </div>

      ${groupedEntries.length ? `
        <div class="category-groups-stack">
          ${groupedEntries.map((grp) => `
            <section class="card category-block">
              <div class="category-block-head">
                <div class="category-head-left">
                  <span class="category-color-dot" style="background:${grp.color}"></span>
                  <h3 class="category-big-title">${esc(grp.name)}</h3>
                </div>
                <div class="category-head-right">
                  <span class="category-count">${grp.done} / ${grp.items.length}</span>
                  <button type="button" class="category-quick-add" data-action="open-add-task-in-cat" data-category="${esc(grp.name)}" title="在「${esc(grp.name)}」下添加任务">+</button>
                </div>
              </div>

              <div class="ios-list">
                ${grp.items.map((t) => {
                  const done = isTaskDoneOnDate(t, sel);
                  const review = isReviewTask(t);
                  const roundInfo = review ? getReviewRoundInfo(t, sel) : null;
                  const masteryObj = review ? (MASTERY_LEVELS[t.mastery] || MASTERY_LEVELS.weak) : null;
                  return `
                    <div class="task-row ${done ? 'is-done' : ''} ${review ? 'is-review-task' : ''}" data-task-row="${t.id}">
                      <button type="button" class="task-check-btn" data-action="toggle-task" data-id="${t.id}" aria-label="${done ? '取消完成' : '标记完成'}">
                        <svg class="task-check-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M4.5 10.5l3.6 3.6 7.4-7.8"/>
                        </svg>
                      </button>
                      <button type="button" class="task-main" data-action="edit-task" data-id="${t.id}">
                        <div class="task-title">${esc(t.title)}</div>
                        ${review && t.mistakeNote ? `<div class="task-mistake-note">${esc(t.mistakeNote)}</div>` : ''}
                        <div class="task-meta">
                          ${review && roundInfo ? `<span class="review-round-tag">${esc(p.reviewRound(roundInfo.round, roundInfo.total))}</span>` : ''}
                          <span class="tabular">${t.durationMin} 分钟</span>
                          ${t.repeatDaily ? '<span>· 每日重复</span>' : ''}
                        </div>
                      </button>
                      ${masteryObj ? `
                        <button type="button" class="mastery-pill ${masteryObj.cls}" data-action="cycle-mastery" data-id="${t.id}" title="点击切换掌握状态">${masteryObj.label}</button>
                      ` : ''}
                      <button type="button" class="task-delete-btn" data-action="delete-task" data-id="${t.id}" aria-label="删除任务" title="删除">
                        ${CLOSE_ICON_SVG}
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            </section>
          `).join('')}
        </div>
      ` : `
        <section class="card empty-box">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);">
            ${state.taskFilter === 'review'
              ? `${getRelativeDayTitle(sel)}暂无${esc(p.reviewLabel)}安排`
              : (state.taskFilter === 'todo' && dayStats.total > 0
                ? `${getRelativeDayTitle(sel)}全部任务已完成`
                : `${getRelativeDayTitle(sel)}${esc(p.taskEmptyTitleSuffix)}`)}
          </div>
          <p style="font-size:12px;margin:6px 0 14px;">
            ${state.taskFilter === 'review'
              ? '记录一道错题或知识点，系统将按艾宾浩斯遗忘曲线自动排入未来 15 天时间轴提醒复习。'
              : esc(p.taskEmptyDesc)}
          </p>
          <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:8px;">
            ${state.taskFilter !== 'all' ? `<button type="button" class="btn-secondary btn-sm" data-action="set-task-filter" data-filter="all">查看全部任务</button>` : ''}
            <button type="button" class="btn-secondary btn-sm" style="color:var(--orange);" data-action="open-add-review">${esc(p.addReviewBtn)}</button>
            <button type="button" class="btn-primary btn-sm" data-action="open-add-task">${esc(p.addTaskBtn)}</button>
          </div>
        </section>
      `}
    `;
  }

  function buildGroupsView() {
    const p = getPack();
    const { groups, user } = state.data;
    const activeGroup = groups.find((g) => g.id === state.activeGroupId) || groups[0];

    return `
      <div class="page-header">
        <div>
          <div class="page-date">${esc(p.groupSub)}</div>
          <h1 class="page-title">${esc(p.groupTitle)}</h1>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary btn-sm" data-action="open-join-group">${esc(p.groupJoinBtn)}</button>
          <button class="btn-primary btn-sm" data-action="open-create-group">${esc(p.groupCreateBtn)}</button>
        </div>
      </div>

      ${groups.length ? `
        <div class="group-pills">
          ${groups.map((g) => `
            <button class="group-pill ${activeGroup && g.id === activeGroup.id ? 'is-active' : ''}" data-action="select-group" data-id="${g.id}">
              ${esc(g.name)} (${g.members.length})
            </button>
          `).join('')}
        </div>
      ` : ''}

      ${activeGroup ? `
        <section class="card group-banner">
          <div class="group-banner-top">
            <div>
              <div style="font-size:12px;font-weight:600;color:var(--accent);">${esc(activeGroup.examName)} · ${esc(activeGroup.targetDate)}</div>
              <h2 class="group-name" style="margin-top:3px;">${esc(activeGroup.name)}</h2>
              <p class="group-notice">${esc(activeGroup.notice)}</p>
            </div>
            <div class="group-days-badge">
              <div class="group-days-num tabular">${activeGroup.daysLeft}</div>
              <div class="group-days-label">剩余天</div>
            </div>
          </div>

          <div class="group-progress-row">
            <div class="group-progress-head">
              <span style="color:var(--text-secondary);font-weight:500;">${esc(p.groupProgressLabel)}</span>
              <span class="tabular" style="font-weight:700;color:var(--accent);">${activeGroup.teamPct}% (${activeGroup.doneTasks}/${activeGroup.totalTasks})</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar-fill" style="width:${activeGroup.teamPct}%"></div>
            </div>
          </div>

          <div class="group-invite-bar">
            <div class="invite-code-box">
              <span class="invite-code-label">${esc(p.groupCodeLabel)}</span>
              <span class="invite-code-val">${esc(activeGroup.inviteCode)}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn-secondary btn-sm" data-action="leave-group" data-group-id="${esc(activeGroup.id)}">退出</button>
              <button class="btn-primary btn-sm" data-action="copy-invite" data-group-id="${esc(activeGroup.id)}">复制邀请链接</button>
            </div>
          </div>
        </section>

        <div class="section-header">
          <h2 class="section-title">${esc(p.groupMemberTitle)} (${activeGroup.members.length} 人)</h2>
          <span style="font-size:12px;color:var(--text-secondary);">点击头像互动</span>
        </div>

        <section class="card">
          <div class="member-grid">
            ${activeGroup.members.map((m) => `
              <button class="member-tile" data-action="tap-member" data-group="${activeGroup.id}" data-user="${m.id}" data-name="${esc(m.name)}" data-done="${m.done}" data-total="${m.total}">
                <div class="ring-box">
                  ${ringSVG(m.pct, 52, 4, m.color || 'var(--accent)')}
                  <span class="member-avatar-inner" style="background:${m.color || 'var(--accent)'}">${esc(m.avatar)}</span>
                </div>
                <div class="member-name">${m.id === user.id ? '我' : esc(m.name)}</div>
                <div class="member-ratio tabular">${m.done}/${m.total}</div>
              </button>
            `).join('')}
          </div>
          <div class="member-hint">${esc(p.groupMemberHint)}</div>
        </section>

        <div class="section-header">
          <h2 class="section-title">${esc(p.groupFeedTitle)}</h2>
        </div>

        <form id="form-group-feed" class="card feed-composer" data-group-id="${esc(activeGroup.id)}">
          <input id="input-group-feed" class="feed-composer-input" type="text" maxlength="100" placeholder="${esc(p.groupFeedPlaceholder)}" />
          <button type="submit" class="btn-primary btn-sm">发布</button>
        </form>

        <section class="feed-list">
          ${activeGroup.feeds.length ? activeGroup.feeds.map((f) => {
            const liked = (f.likedBy || []).includes(user.id);
            return `
              <article class="card feed-item">
                <div class="feed-avatar" style="background:${f.userColor || 'var(--accent)'}">${esc(f.userAvatar)}</div>
                <div class="feed-body">
                  <div class="feed-head">
                    <span class="feed-user">${esc(f.userName)}</span>
                    <span class="feed-time">${timeAgo(f.createdAt)}</span>
                  </div>
                  <div class="feed-text">${esc(f.text)}</div>
                </div>
                <button class="like-btn ${liked ? 'is-liked' : ''}" data-action="like-feed" data-id="${f.id}">
                  <span>♥</span>
                  <span class="tabular">${(f.likedBy || []).length}</span>
                </button>
              </article>
            `;
          }).join('') : `
            <div class="card empty-box">还没有打卡记录，完成今日任务或发一条状态吧。</div>
          `}
        </section>
      ` : `
        <section class="card empty-box" style="padding:36px 20px;">
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${esc(p.groupEmptyTitle)}</div>
          <p style="font-size:13px;line-height:1.55;margin:8px 0 18px;">${esc(p.groupEmptyDesc)}</p>
          <div style="display:flex;justify-content:center;gap:10px;">
            <button class="btn-secondary" data-action="open-join-group">${esc(p.groupJoinBtn)}</button>
            <button class="btn-primary" data-action="open-create-group">${esc(p.groupEmptyCreate)}</button>
          </div>
        </section>
      `}
    `;
  }

  function bindGroupFeedComposer() {
    const form = document.getElementById('form-group-feed');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('input-group-feed');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      input.value = '';
      try {
        await api(`/api/groups/${form.dataset.groupId}/feed`, {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, text })
        });
        await loadBootstrap(true);
        showHud('动态已发布');
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function buildExamsView() {
    const p = getPack();
    const { exams } = state.data;
    return `
      <div class="page-header">
        <div>
          <div class="page-date">${esc(p.examSub)}</div>
          <h1 class="page-title">${esc(p.examTitle)}</h1>
        </div>
        <button class="btn-primary btn-sm" data-action="open-add-exam">${esc(p.examAddBtn)}</button>
      </div>

      <section>
        ${exams.length ? exams.map((e) => `
          <article class="card exam-card" data-action="edit-exam" data-id="${e.id}" style="cursor:pointer;">
            <div class="exam-left">
              <div class="exam-tag-row">
                <span class="exam-dot" style="background:${e.color || 'var(--accent)'}"></span>
                <span>${esc(e.tag)}</span>
                ${e.pinned ? '<span class="exam-pin-label">· 首页与锁屏置顶</span>' : ''}
              </div>
              <div class="exam-name">${esc(e.name)}</div>
              <div class="exam-date-sub tabular">目标日 ${esc(e.targetDate)} · 约 ${Math.max(1, Math.ceil(e.daysLeft / 7))} 周 · 进度 ${e.progress}%</div>
              <div class="progress-track" style="margin-top:10px;height:5px;">
                <div class="progress-bar-fill" style="width:${e.progress}%;background:${e.color || 'var(--accent)'}"></div>
              </div>
            </div>
            <div class="exam-right">
              <div class="exam-days-big tabular" style="color:${e.color || 'var(--accent)'}">${e.daysLeft}</div>
              <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">剩余天</div>
              <div class="exam-actions-inline">
                ${!e.pinned ? `<button style="color:var(--accent);font-weight:600;" data-action="pin-exam" data-id="${e.id}">置顶</button>` : ''}
                <button style="color:var(--text-tertiary);" data-action="delete-exam" data-id="${e.id}">删除</button>
              </div>
            </div>
          </article>
        `).join('') : `
          <div class="card empty-box">
            <div style="font-size:15px;font-weight:600;color:var(--text-primary);">还没有设定目标倒计时</div>
            <p style="font-size:12px;margin:6px 0 14px;">点击上方「+ 新目标」自由填写考试与日期，或从下方快捷模板添加。</p>
            <button class="btn-primary btn-sm" data-action="open-add-exam">+ 自定义目标日期</button>
          </div>
        `}
      </section>

      <div class="section-header">
        <h2 class="section-title">快捷添加常见考试模板</h2>
      </div>
      <section class="card card-padded">
        <div class="chip-row">
          ${EXAM_PRESETS.map((p, idx) => `
            <button class="choice-chip" data-action="quick-preset-exam" data-idx="${idx}">+ ${esc(p.name)}</button>
          `).join('')}
        </div>
      </section>
    `;
  }

  function buildDesktopView() {
    const p = getPack();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const baseUrl = window.location.origin + window.location.pathname;
    const shortcutUrl = state.mode === 'server'
      ? `${window.location.origin}/api/wallpaper.svg?userId=${encodeURIComponent(state.userId)}&theme=${state.theme}`
      : baseUrl;

    return `
      <div class="page-header">
        <div>
          <div class="page-date">iPhone 专属体验</div>
          <h1 class="page-title">${state.stylePack === 'xianxia' ? '玉简与桌面' : (state.stylePack === 'kitty' ? '桌面装扮与壁纸' : '桌面与倒计时')}</h1>
        </div>
        <button class="btn-secondary btn-sm" data-action="open-style-packs">${esc(p.name)} ▾</button>
      </div>

      <section class="card card-padded">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div>
            <div style="font-size:16px;font-weight:700;letter-spacing:-0.015em;">① 添加至 iPhone 主屏幕</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
              ${isStandalone ? '已处于独立全屏 App 模式' : '免下载 App，3 秒生成原生质感全屏桌面图标'}
            </div>
          </div>
          <img src="./icons/apple-touch-icon.png" alt="时序图标" style="width:44px;height:44px;border-radius:11px;box-shadow:0 3px 10px rgba(0,113,227,0.22);" />
        </div>

        <div class="step-list">
          <div class="step-row">
            <span class="step-num">1</span>
            <div>
              <div class="step-title">使用 iPhone 自带 Safari 打开本页</div>
              <div class="step-desc">如果从微信点开，先点右上角 ··· 选择「在默认浏览器中打开」。</div>
            </div>
          </div>
          <div class="step-row">
            <span class="step-num">2</span>
            <div>
              <div class="step-title">点击底部「分享」→「添加到主屏幕」</div>
              <div class="step-desc">桌面立即生成「时序」图标，点击后隐藏地址栏全屏运行。</div>
            </div>
          </div>
        </div>
      </section>

      <div class="section-header">
        <h2 class="section-title">② iPhone 锁屏倒计时壁纸（实时同步你的数据）</h2>
      </div>
      <section class="card card-padded">
        <div style="font-size:14px;font-weight:600;">自动避开锁屏时钟，亮屏即见你的考试倒计时与今日任务</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">
          添加目标与任务后，下方壁纸会自动更新；点击即可保存 1170×2532 高清 PNG 设为 iPhone 锁屏壁纸。
        </div>

        <div class="wallpaper-preview-frame">
          <img id="wallpaper-preview-img" alt="iPhone 锁屏倒计时壁纸实时预览" />
        </div>

        <div class="btn-row">
          <button class="btn-primary" data-action="download-wallpaper-png">保存高清锁屏 PNG</button>
          <button class="btn-secondary" data-action="copy-wallpaper-url" data-url="${esc(shortcutUrl)}">${state.mode === 'server' ? '复制快捷指令地址' : '复制本页访问链接'}</button>
        </div>
      </section>

      <div class="section-header">
        <h2 class="section-title">③ 桌面实时小组件（Scriptable 进阶版）</h2>
      </div>
      <section class="card card-padded">
        <div style="font-size:14px;font-weight:600;">在 iPhone 主屏幕展示 4×2 倒计时与任务卡片</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">
          在 App Store 免费下载 <strong>Scriptable</strong>，新建脚本粘贴下方专属代码，长按桌面添加 Scriptable 中号小组件即可在主屏直接显示倒计时。
        </div>
        <pre id="scriptable-code-preview" class="code-preview">正在生成你的专属小组件代码…</pre>
        <button class="btn-primary btn-block" style="margin-top:12px;" data-action="copy-scriptable">一键复制我的小组件脚本</button>
      </section>
    `;
  }

  // =========================================================================
  // Modals / Bottom Sheets (Analytics, Account, Categories, Add/Edit Task, Add/Edit Exam, Groups, Focus)
  // =========================================================================

  function openAnalyticsSheet() {
    if (!state.data || !state.data.user) return;
    const { user, tasks, categories } = state.data;
    const today = todayKey();
    const last7 = [];
    let weekCompleted = 0;
    let weekTotal = 0;
    for (let i = -6; i <= 0; i++) {
      const ds = shiftDateISO(today, i);
      const st = getDayStats(tasks, ds);
      weekCompleted += st.done;
      weekTotal += st.total;
      const d = parseDateISO(ds);
      last7.push({ ds, wk: WEEKDAYS_SHORT[d.getDay()], isToday: ds === today, ...st });
    }
    const weekRate = weekTotal ? Math.round((weekCompleted / weekTotal) * 100) : 0;

    // Category distribution across all tasks
    const catTotals = new Map();
    for (const t of tasks) {
      const key = t.category || '未分组';
      const cur = catTotals.get(key) || { name: key, done: 0, total: 0 };
      cur.total++;
      cur.done += (t.completedDates || []).length;
      catTotals.set(key, cur);
    }
    const colorMap = new Map(categories.map((c) => [c.name, c.color]));
    const catList = Array.from(catTotals.values()).sort((a, b) => b.done - a.done || b.total - a.total);
    const maxDone = Math.max(1, ...catList.map((c) => c.done));

    const reviewTasks = tasks.filter((t) => isReviewTask(t));
    const masteredCount = reviewTasks.filter((t) => t.mastery === 'mastered').length;
    const reviewPct = reviewTasks.length ? Math.round((masteredCount / reviewTasks.length) * 100) : 0;
    const p = getPack();

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">学习复盘与趋势</h2>
        ${sheetCloseBtn()}
      </div>

      <div class="month-kpi-strip" style="margin-bottom:14px;">
        <div class="month-kpi">
          <div class="month-kpi-val">${user.streak} 天</div>
          <div class="month-kpi-lbl">连续打卡</div>
        </div>
        <div class="month-kpi">
          <div class="month-kpi-val" style="color:var(--accent);">${weekCompleted}</div>
          <div class="month-kpi-lbl">近 7 日完成</div>
        </div>
        <div class="month-kpi">
          <div class="month-kpi-val" style="color:var(--green);">${weekRate}%</div>
          <div class="month-kpi-lbl">周平均达成</div>
        </div>
      </div>

      ${reviewTasks.length ? `
        <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:700;">${esc(p.reviewNotebook)}掌握度</span>
            <button type="button" class="section-action" style="font-size:12px;" data-action="open-review-notebook">查看全部 (${reviewTasks.length}) ›</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px;">
            <span>已掌握 ${masteredCount} / ${reviewTasks.length} 题</span>
            <span class="tabular" style="font-weight:700;color:var(--green);">${reviewPct}%</span>
          </div>
          <div class="progress-track" style="height:6px;">
            <div class="progress-bar-fill" style="width:${reviewPct}%;background:var(--green);"></div>
          </div>
        </div>
      ` : ''}

      <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px;">近 7 日任务达成趋势</div>
        <div class="health-bars">
          ${last7.map((d) => `
            <div class="health-bar-col ${d.isToday ? 'is-today' : ''}">
              <div class="health-bar-track" title="${d.ds}: ${d.done}/${d.total}">
                <div class="health-bar-fill ${d.total > 0 && d.done === d.total ? 'is-perfect' : ''}" style="height:${d.total > 0 ? Math.max(12, d.pct) : 0}%"></div>
              </div>
              <span class="health-bar-day">${d.isToday ? '今' : d.wk}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card card-padded" style="margin-bottom:16px;background:var(--bg-surface);">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">各自定义大标题累计打卡分布</div>
        ${catList.length ? catList.map((c) => `
          <div class="cat-stat-row">
            <div class="cat-stat-head">
              <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;">
                <span class="category-color-dot" style="background:${colorMap.get(c.name) || 'var(--accent)'}"></span>
                ${esc(c.name)}
              </span>
              <span class="tabular" style="color:var(--text-secondary);">累计完成 ${c.done} 次</span>
            </div>
            <div class="progress-track" style="height:6px;">
              <div class="progress-bar-fill" style="width:${Math.round((c.done / maxDone) * 100)}%;background:${colorMap.get(c.name) || 'var(--accent)'}"></div>
            </div>
          </div>
        `).join('') : `
          <div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">完成任务后将自动统计各大标题投入分布</div>
        `}
      </div>

      <button type="button" class="btn-primary btn-block" data-action="download-wallpaper-png">生成并保存今日打卡海报 PNG</button>
    `);
  }

  function openAccountSheet() {
    if (!state.data || !state.data.user) return;
    const { user, users } = state.data;
    const cloudReady = state.mode === 'server' || state.mode === 'supabase';
    const syncLabel = state.mode === 'supabase'
      ? 'Supabase 云端实时同步已开启'
      : (state.mode === 'server' ? '自有服务端云同步已开启' : '永久防丢存储已开启 · 支持换机迁移');

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">统一账户与数据记忆</h2>
        ${sheetCloseBtn()}
      </div>

      <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="avatar-dot" style="width:44px;height:44px;font-size:17px;background:${user.color}">${esc(user.avatar)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:16px;font-weight:700;">${esc(user.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">统一账号：@${esc(user.account)}</div>
          </div>
          <button type="button" id="btn-logout-account" class="btn-secondary btn-sm">退出登录</button>
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-separator);display:flex;align-items:center;justify-content:space-between;font-size:12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:${cloudReady ? 'var(--green)' : 'var(--accent)'};">
            <span style="width:7px;height:7px;border-radius:50%;background:${cloudReady ? 'var(--green)' : 'var(--accent)'};"></span>
            ${syncLabel}
          </span>
          <span style="color:var(--text-tertiary);">升级不丢数据</span>
        </div>
      </div>

      <div class="field-label" style="margin-bottom:8px;">界面主题与专属话术</div>
      <button type="button" class="account-row" data-action="open-style-packs" style="margin-bottom:14px;">
        <div class="account-left">
          <span class="theme-pack-swatch" style="width:32px;height:32px;border-radius:9px;font-size:15px;background:${getPack().swatchBg}">${getPack().swatchIcon}</span>
          <div style="text-align:left;">
            <div style="font-size:14px;font-weight:600;">当前主题：${esc(getPack().name)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">支持苹果原生 / 粉萌凯蒂 / 问鼎修仙随时无损切换</div>
          </div>
        </div>
        <span style="font-size:12px;color:var(--accent);font-weight:600;">切换 ›</span>
      </button>

      <div class="field-label" style="margin-bottom:8px;">跨设备无缝同步 / 换机数据迁移</div>
      <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
        <p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px;line-height:1.55;">
          ${cloudReady
            ? '您的统一账户已连接云端数据库，在新手机直接登录账号 @' + esc(user.account) + ' 即可自动恢复全部数据；下方也可随时导出本地加密备份。'
            : '换新手机或换浏览器时，点击下方生成「加密换机迁移链接」发给自己，在新设备点开并验证原密码即可完整恢复全部数据。'}
        </p>
        <button type="button" class="btn-primary btn-block" id="btn-copy-restore-link">复制加密换机迁移链接</button>
        <div class="btn-row" style="margin-top:10px;">
          <button type="button" class="btn-secondary" id="btn-export-backup">导出备份文件</button>
          <button type="button" class="btn-secondary" data-action="trigger-import-backup">导入恢复备份</button>
        </div>
      </div>

      ${users.length > 1 ? `
        <div class="field-label" style="margin-bottom:8px;">快速切换本机已记忆账户</div>
        <div style="margin-bottom:14px;">
          ${users.filter((u) => u.id !== user.id).map((u) => `
            <button type="button" class="account-row" data-switch-user="${u.id}" data-switch-acc="${esc(u.account)}">
              <div class="account-left">
                <span class="avatar-dot" style="width:30px;height:30px;font-size:12px;background:${u.color}">${esc(u.avatar)}</span>
                <div style="text-align:left;">
                  <div style="font-size:14px;font-weight:600;">${esc(u.name)}</div>
                  <div style="font-size:11px;color:var(--text-secondary);">@${esc(u.account)}</div>
                </div>
              </div>
              <span style="font-size:12px;color:var(--accent);font-weight:600;">切换</span>
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div style="padding-top:10px;border-top:1px solid var(--border-separator);text-align:center;">
        <button type="button" id="btn-reset-step1" style="font-size:12px;color:var(--text-tertiary);padding:6px 12px;">
          清空本机全部账户数据（慎用）
        </button>
        <div id="reset-confirm-box" class="hidden" style="margin-top:8px;">
          <button type="button" id="btn-reset-confirm" class="btn-secondary btn-block" style="color:var(--red);">
            确认彻底清空并恢复空白初始状态
          </button>
        </div>
      </div>
    `);

    document.getElementById('btn-logout-account').addEventListener('click', async () => {
      closeSheet();
      saveSession('');
      state.activeGroupId = null;
      state.authMode = 'login';
      await loadBootstrap(false);
      showHud('已退出登录，账户数据已永久保留');
    });

    document.getElementById('btn-copy-restore-link').addEventListener('click', async () => {
      const snap = buildAccountSnapshot(state.userId);
      if (!snap) return;
      const encoded = encodeB64Json(snap);
      if (encoded.length > 3600) {
        showHud('数据量较大，已自动为您导出备份文件更安全', 'var(--accent)');
        document.getElementById('btn-export-backup').click();
        return;
      }
      const base = window.location.origin + window.location.pathname;
      await copyText(`${base}?restore=${encodeURIComponent(encoded)}`, '已复制换机迁移链接，在新设备打开输密码即可恢复');
    });

    document.getElementById('btn-export-backup').addEventListener('click', () => {
      const snap = buildAccountSnapshot(state.userId);
      if (!snap) return;
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `时序账户备份-${user.account}-${todayKey()}.shixu.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showHud('账户完整备份文件已保存');
    });

    sheetContent.querySelectorAll('[data-switch-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        saveSession(btn.dataset.switchUser, btn.dataset.switchAcc);
        state.scriptableCode = '';
        closeSheet();
        await loadBootstrap(false);
        showHud(`已切换至 ${state.data.user.name}`);
      });
    });

    document.getElementById('btn-reset-step1').addEventListener('click', () => {
      document.getElementById('reset-confirm-box').classList.remove('hidden');
    });

    document.getElementById('btn-reset-confirm').addEventListener('click', async () => {
      closeSheet();
      await api('/api/reset', { method: 'POST', body: JSON.stringify({}) });
      saveSession('');
      state.activeGroupId = null;
      state.activeTab = 'today';
      state.selectedDate = todayKey();
      state.viewMonth = currentMonthKey();
      state.showMonthCalendar = false;
      syncTabButtons();
      await loadBootstrap(false);
      showHud('已恢复全新空白状态');
    });
  }

  function openManageCategoriesSheet() {
    if (!state.data || !state.data.user) return;
    const p = getPack();
    const cats = state.data.categories || [];
    let pickedColor = SYSTEM_COLORS[cats.length % SYSTEM_COLORS.length];

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${esc(p.catSheetTitle)}</h2>
        ${sheetCloseBtn()}
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
        ${esc(p.catSheetDesc)}
      </p>

      <form id="form-new-category" style="margin-bottom:16px;">
        <div class="field">
          <label class="field-label" for="input-new-cat-name">新建大标题名称</label>
          <input id="input-new-cat-name" class="input" type="text" required maxlength="18" placeholder="${esc(p.catPlaceholder)}" />
        </div>
        <div class="field">
          <label class="field-label">标记颜色</label>
          <div class="color-swatch-row" id="cat-color-swatches">
            ${SYSTEM_COLORS.map((c) => `
              <button type="button" class="color-swatch ${c === pickedColor ? 'is-selected' : ''}" data-swatch="${c}" style="background:${c}" aria-label="选择颜色"></button>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn-primary btn-block">+ 添加自定义大标题</button>
      </form>

      ${cats.length ? `
        <div style="padding-top:14px;border-top:1px solid var(--border-separator);">
          <div class="field-label" style="margin-bottom:8px;">已有大标题（可直接修改名称后点保存）</div>
          ${cats.map((c) => `
            <div class="cat-manage-row" data-cat-row="${c.id}">
              <span class="category-color-dot" style="background:${c.color}"></span>
              <input class="cat-manage-input" type="text" maxlength="18" value="${esc(c.name)}" data-cat-input="${c.id}" />
              <button type="button" class="btn-secondary btn-sm" data-save-cat="${c.id}">保存</button>
              <button type="button" class="task-delete-btn" data-del-cat="${c.id}" aria-label="删除大标题">${CLOSE_ICON_SVG}</button>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-box" style="padding:16px 8px;font-size:12px;">还没有自定义大标题，在上方输入名称即可创建。</div>
      `}
    `);

    sheetContent.querySelectorAll('[data-swatch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedColor = btn.dataset.swatch;
        sheetContent.querySelectorAll('[data-swatch]').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    document.getElementById('form-new-category').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('input-new-cat-name').value.trim();
      if (!name) return;
      try {
        await api('/api/categories', { method: 'POST', body: JSON.stringify({ userId: state.userId, name, color: pickedColor }) });
        await loadBootstrap(true);
        openManageCategoriesSheet();
        showHud(`已创建大标题「${name}」`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });

    sheetContent.querySelectorAll('[data-save-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveCat;
        const input = sheetContent.querySelector(`[data-cat-input="${id}"]`);
        const nextName = input ? input.value.trim() : '';
        if (!nextName) return;
        try {
          await api(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name: nextName }) });
          await loadBootstrap(true);
          openManageCategoriesSheet();
          showHud(`已重命名为「${nextName}」`);
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    });

    sheetContent.querySelectorAll('[data-del-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/categories/${btn.dataset.delCat}`, { method: 'DELETE' });
          await loadBootstrap(true);
          openManageCategoriesSheet();
          showHud('已移除大标题');
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    });
  }

  function openTaskEditorSheet(existingTask = null, prefillCategory = '', defaultType = 'normal') {
    const p = getPack();
    const isEdit = Boolean(existingTask);
    const cats = (state.data && state.data.categories) || [];
    const initialCat = isEdit ? (existingTask.category || '') : (prefillCategory || (cats[0] ? cats[0].name : ''));
    const initialTitle = isEdit ? existingTask.title : '';
    const initialDate = isEdit ? existingTask.date : state.selectedDate;
    const initialDur = isEdit ? (existingTask.durationMin || 45) : (defaultType === 'review' ? 25 : 45);
    let taskType = isEdit ? (isReviewTask(existingTask) ? 'review' : 'normal') : (defaultType === 'review' ? 'review' : 'normal');
    let reviewPreset = isEdit && existingTask.reviewPreset && REVIEW_PRESETS[existingTask.reviewPreset]
      ? existingTask.reviewPreset
      : 'ebbinghaus';
    let mastery = isEdit && MASTERY_LEVELS[existingTask.mastery] ? existingTask.mastery : 'weak';
    let repeatDaily = isEdit ? Boolean(existingTask.repeatDaily) : false;
    const initialNote = isEdit ? (existingTask.mistakeNote || '') : '';
    const existingDoneDates = new Set(isEdit && Array.isArray(existingTask.completedDates) ? existingTask.completedDates : []);
    let scheduleDirty = false;
    let submitting = false;

    function computeCurrentReviewDates() {
      const dateInputEl = document.getElementById('input-task-date');
      const baseDate = (dateInputEl && dateInputEl.value) || initialDate;
      if (isEdit && isReviewTask(existingTask) && !scheduleDirty && Array.isArray(existingTask.reviewDates) && existingTask.reviewDates.length) {
        return existingTask.reviewDates;
      }
      return generateReviewDates(baseDate, reviewPreset);
    }

    function renderScheduleChipsHTML(dates) {
      return dates.map((d, idx) => `
        <span class="review-date-chip ${existingDoneDates.has(d) ? 'is-done' : ''}">
          第${idx + 1}轮 ${formatShortMD(d)}${existingDoneDates.has(d) ? ' ✓' : ''}
        </span>
      `).join('');
    }

    const initialDates = taskType === 'review'
      ? (isEdit && isReviewTask(existingTask) && Array.isArray(existingTask.reviewDates) && existingTask.reviewDates.length
        ? existingTask.reviewDates
        : generateReviewDates(initialDate, reviewPreset))
      : generateReviewDates(initialDate, reviewPreset);

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${isEdit ? '编辑任务' : (taskType === 'review' ? `新建${esc(p.reviewLabel)}` : '新建学习任务')}</h2>
        ${sheetCloseBtn()}
      </div>
      <form id="form-task-editor">
        <div class="field">
          <div class="segmented-control" style="width:100%;display:grid;grid-template-columns:1fr 1fr;">
            <button type="button" class="seg-btn ${taskType === 'normal' ? 'is-active' : ''}" data-pick-type="normal">普通学习任务</button>
            <button type="button" class="seg-btn ${taskType === 'review' ? 'is-active' : ''}" data-pick-type="review">${esc(p.reviewLabel)}计划</button>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="input-task-category">任务大标题（可自由命名或点选已有）</label>
          <input id="input-task-category" class="input" type="text" required maxlength="18" placeholder="例如：专业课、高数、英语精读" value="${esc(initialCat)}" />
          ${cats.length ? `
            <div class="chip-row" id="task-cat-chips" style="margin-top:8px;">
              ${cats.map((c) => `
                <button type="button" class="choice-chip ${c.name === initialCat ? 'is-selected' : ''}" data-pick-cat="${esc(c.name)}">${esc(c.name)}</button>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <div class="field">
          <label class="field-label" id="lbl-task-title" for="input-task-title">${taskType === 'review' ? '错题 / 复习知识点名称' : '具体任务内容'}</label>
          <input id="input-task-title" class="input" type="text" required maxlength="60" placeholder="${taskType === 'review' ? '例如：高数定积分换元错题 / 民法善意取得易错点' : '例如：刷完第三章真题并整理笔记'}" value="${esc(initialTitle)}" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field">
            <label class="field-label" id="lbl-task-date" for="input-task-date">${taskType === 'review' ? '首次复习日期' : '安排日期'}</label>
            <input id="input-task-date" class="input tabular" type="date" required value="${esc(initialDate)}" />
          </div>
          <div class="field">
            <label class="field-label" for="input-task-duration">预计时长（分）</label>
            <input id="input-task-duration" class="input tabular" type="number" min="5" max="360" value="${initialDur}" />
          </div>
        </div>

        <div id="normal-repeat-section" class="field ${taskType === 'review' ? 'hidden' : ''}">
          <div class="switch-row">
            <div>
              <div style="font-size:14px;font-weight:600;">每日自动重复</div>
              <div style="font-size:12px;color:var(--text-secondary);">从该日期起每天自动出现在时间轴中</div>
            </div>
            <button type="button" id="switch-repeat" class="ios-switch ${repeatDaily ? 'is-on' : ''}" role="switch" aria-checked="${repeatDaily}"></button>
          </div>
        </div>

        <div id="review-plan-section" class="${taskType === 'review' ? '' : 'hidden'}">
          <div class="field">
            <label class="field-label">智能复习周期（自动排入时间轴与月历）</label>
            <div class="chip-row" id="review-preset-chips">
              ${Object.values(REVIEW_PRESETS).map((pr) => `
                <button type="button" class="choice-chip ${pr.id === reviewPreset ? 'is-selected' : ''}" data-pick-preset="${pr.id}">${esc(pr.short)}</button>
              `).join('')}
            </div>
            <div id="review-preset-desc" style="font-size:12px;color:var(--text-secondary);margin-top:6px;">
              ${esc((REVIEW_PRESETS[reviewPreset] || REVIEW_PRESETS.ebbinghaus).desc)}
            </div>
            <div class="review-schedule-preview" id="review-schedule-preview">
              ${renderScheduleChipsHTML(initialDates)}
            </div>
          </div>

          <div class="field">
            <label class="field-label">当前掌握程度</label>
            <div class="chip-row" id="review-mastery-chips">
              ${Object.values(MASTERY_LEVELS).map((m) => `
                <button type="button" class="choice-chip ${m.id === mastery ? 'is-selected' : ''}" data-pick-mastery="${m.id}">${m.label}</button>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="input-mistake-note">错因 / 关键解题思路（选填）</label>
            <textarea id="input-mistake-note" class="input" maxlength="120" rows="2" placeholder="记录当时为什么做错、关键公式或易混陷阱，下次复习一眼回想…">${esc(initialNote)}</textarea>
          </div>
        </div>

        <button type="submit" id="btn-save-task" class="btn-primary btn-block" style="margin-top:8px;">${isEdit ? '保存修改' : (taskType === 'review' ? '生成复习计划并排入时间轴' : '添加到任务序列')}</button>
        ${isEdit ? `
          <div class="btn-row" style="margin-top:10px;">
            <button type="button" id="btn-move-tomorrow" class="btn-secondary">${taskType === 'review' ? '明日加练一轮' : '移至明日'}</button>
            <button type="button" id="btn-focus-this-task" class="btn-secondary" style="color:var(--accent);">专注此任务</button>
          </div>
        ` : ''}
      </form>
    `);

    const catInput = document.getElementById('input-task-category');
    const titleLabel = document.getElementById('lbl-task-title');
    const titleInput = document.getElementById('input-task-title');
    const dateLabel = document.getElementById('lbl-task-date');
    const dateInput = document.getElementById('input-task-date');
    const normalSec = document.getElementById('normal-repeat-section');
    const reviewSec = document.getElementById('review-plan-section');
    const presetDescEl = document.getElementById('review-preset-desc');
    const previewEl = document.getElementById('review-schedule-preview');
    const saveBtn = document.getElementById('btn-save-task');

    function refreshReviewPreview() {
      const dates = computeCurrentReviewDates();
      previewEl.innerHTML = renderScheduleChipsHTML(dates);
      presetDescEl.textContent = (REVIEW_PRESETS[reviewPreset] || REVIEW_PRESETS.ebbinghaus).desc;
    }

    sheetContent.querySelectorAll('[data-pick-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        taskType = btn.dataset.pickType;
        sheetContent.querySelectorAll('[data-pick-type]').forEach((b) => b.classList.toggle('is-active', b === btn));
        const isRev = taskType === 'review';
        normalSec.classList.toggle('hidden', isRev);
        reviewSec.classList.toggle('hidden', !isRev);
        titleLabel.textContent = isRev ? '错题 / 复习知识点名称' : '具体任务内容';
        titleInput.placeholder = isRev ? '例如：高数定积分换元错题 / 民法善意取得易错点' : '例如：刷完第三章真题并整理笔记';
        dateLabel.textContent = isRev ? '首次复习日期' : '安排日期';
        if (!isEdit) saveBtn.textContent = isRev ? '生成复习计划并排入时间轴' : '添加到任务序列';
        if (isRev) {
          scheduleDirty = true;
          refreshReviewPreview();
        }
      });
    });

    sheetContent.querySelectorAll('[data-pick-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        reviewPreset = btn.dataset.pickPreset;
        scheduleDirty = true;
        sheetContent.querySelectorAll('[data-pick-preset]').forEach((b) => b.classList.toggle('is-selected', b === btn));
        refreshReviewPreview();
      });
    });

    sheetContent.querySelectorAll('[data-pick-mastery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mastery = btn.dataset.pickMastery;
        sheetContent.querySelectorAll('[data-pick-mastery]').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    dateInput.addEventListener('change', () => {
      if (taskType === 'review') {
        scheduleDirty = true;
        refreshReviewPreview();
      }
    });

    sheetContent.querySelectorAll('[data-pick-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        catInput.value = btn.dataset.pickCat;
        sheetContent.querySelectorAll('[data-pick-cat]').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    catInput.addEventListener('input', () => {
      const val = catInput.value.trim();
      sheetContent.querySelectorAll('[data-pick-cat]').forEach((b) => b.classList.toggle('is-selected', b.dataset.pickCat === val));
    });

    const sw = document.getElementById('switch-repeat');
    sw.addEventListener('click', () => {
      repeatDaily = !repeatDaily;
      sw.classList.toggle('is-on', repeatDaily);
      sw.setAttribute('aria-checked', String(repeatDaily));
    });

    if (isEdit) {
      document.getElementById('btn-move-tomorrow').addEventListener('click', async () => {
        blurActiveInput();
        const tom = shiftDateISO(todayKey(), 1);
        closeSheet();
        try {
          if (isReviewTask(existingTask)) {
            const nextDates = Array.from(new Set([...(existingTask.reviewDates || [existingTask.date]), tom])).sort();
            await api(`/api/tasks/${existingTask.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ reviewDates: nextDates })
            });
            await loadBootstrap(true);
            showHud('已将明日加入复习计划');
          } else {
            await api(`/api/tasks/${existingTask.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ scheduledDate: tom, repeatDaily: false })
            });
            await loadBootstrap(true);
            showHud('已移至明日计划');
          }
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });

      document.getElementById('btn-focus-this-task').addEventListener('click', () => {
        blurActiveInput();
        state.focus.label = `${existingTask.category} · ${existingTask.title}`;
        if (!state.focus.running) {
          state.focus.presetMin = Math.min(60, Math.max(15, existingTask.durationMin || 25));
          state.focus.remainingSec = state.focus.presetMin * 60;
        }
        openFocusSheet();
      });
    }

    document.getElementById('form-task-editor').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      blurActiveInput();
      const category = catInput.value.trim() || '未分组';
      const title = titleInput.value.trim();
      const date = dateInput.value || state.selectedDate;
      const durationMin = Number(document.getElementById('input-task-duration').value) || 30;
      const mistakeNote = (document.getElementById('input-mistake-note').value || '').trim();
      if (!title) return;
      submitting = true;
      const reviewDates = taskType === 'review' ? computeCurrentReviewDates() : [];

      closeSheet();
      try {
        if (isEdit) {
          await api(`/api/tasks/${existingTask.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              category,
              title,
              scheduledDate: date,
              durationMin,
              repeatDaily: taskType === 'review' ? false : repeatDaily,
              taskType,
              reviewPreset: taskType === 'review' ? reviewPreset : '',
              reviewDates,
              mistakeNote: taskType === 'review' ? mistakeNote : '',
              mastery: taskType === 'review' ? mastery : ''
            })
          });
          await loadBootstrap(true);
          showHud(taskType === 'review' ? `复习计划已更新（共 ${reviewDates.length} 轮）` : '任务已更新');
        } else {
          await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({
              userId: state.userId,
              category,
              title,
              date,
              durationMin,
              repeatDaily: taskType === 'review' ? false : repeatDaily,
              taskType,
              reviewPreset: taskType === 'review' ? reviewPreset : '',
              reviewDates,
              mistakeNote: taskType === 'review' ? mistakeNote : '',
              mastery: taskType === 'review' ? mastery : ''
            })
          });
          state.selectedDate = date;
          state.viewMonth = currentMonthKey(date);
          await loadBootstrap(true);
          showHud(taskType === 'review'
            ? `已生成 ${reviewDates.length} 轮复习计划并自动排入时间轴`
            : `已添加到「${category}」`);
        }
      } catch (err) {
        showHud(err.message, 'var(--red)');
      } finally {
        submitting = false;
      }
    });
  }

  function openReviewNotebookSheet(filterMastery = 'all') {
    if (!state.data || !state.data.user) return;
    const p = getPack();
    const today = todayKey();
    const allReviews = (state.data.tasks || []).filter((t) => isReviewTask(t));
    const filtered = filterMastery === 'all'
      ? allReviews
      : allReviews.filter((t) => (t.mastery || 'weak') === filterMastery);
    const weakCount = allReviews.filter((t) => (t.mastery || 'weak') === 'weak').length;
    const revCount = allReviews.filter((t) => t.mastery === 'reviewing').length;
    const masCount = allReviews.filter((t) => t.mastery === 'mastered').length;

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${esc(p.reviewNotebook)}</h2>
        ${sheetCloseBtn()}
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px;line-height:1.5;">
        集中管理所有错题与复习计划，系统按遗忘曲线自动排入时间轴，随时点击状态徽章更新掌握进度。
      </p>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;">
        <div class="segmented-control" style="overflow-x:auto;">
          <button type="button" class="seg-btn ${filterMastery === 'all' ? 'is-active' : ''}" data-nb-filter="all">全部 (${allReviews.length})</button>
          <button type="button" class="seg-btn ${filterMastery === 'weak' ? 'is-active' : ''}" data-nb-filter="weak">未掌握 (${weakCount})</button>
          <button type="button" class="seg-btn ${filterMastery === 'reviewing' ? 'is-active' : ''}" data-nb-filter="reviewing">待巩固 (${revCount})</button>
          <button type="button" class="seg-btn ${filterMastery === 'mastered' ? 'is-active' : ''}" data-nb-filter="mastered">已掌握 (${masCount})</button>
        </div>
      </div>

      ${filtered.length ? filtered.map((t) => {
        const m = MASTERY_LEVELS[t.mastery] || MASTERY_LEVELS.weak;
        const dates = Array.isArray(t.reviewDates) && t.reviewDates.length ? t.reviewDates : [t.date];
        const doneSet = new Set(t.completedDates || []);
        const doneRounds = dates.filter((d) => doneSet.has(d)).length;
        const nextDate = dates.find((d) => d >= today && !doneSet.has(d)) || dates[dates.length - 1];
        const inToday = dates.includes(today);
        return `
          <div class="notebook-card">
            <div class="notebook-card-top">
              <div style="min-width:0;flex:1;">
                <div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:2px;">${esc(t.category)}</div>
                <div style="font-size:15px;font-weight:600;line-height:1.35;">${esc(t.title)}</div>
                ${t.mistakeNote ? `<div class="task-mistake-note">${esc(t.mistakeNote)}</div>` : ''}
              </div>
              <button type="button" class="mastery-pill ${m.cls}" data-nb-cycle="${t.id}">${m.label}</button>
            </div>
            <div class="review-schedule-preview">
              ${dates.map((d, i) => `
                <span class="review-date-chip ${doneSet.has(d) ? 'is-done' : ''}">R${i + 1} ${formatShortMD(d)}${doneSet.has(d) ? '✓' : ''}</span>
              `).join('')}
            </div>
            <div class="notebook-card-actions">
              <span style="font-size:11px;color:var(--text-secondary);" class="tabular">已完成 ${doneRounds}/${dates.length} 轮 · 下次 ${formatShortMD(nextDate)}</span>
              <div style="display:flex;align-items:center;gap:8px;">
                ${!inToday ? `<button type="button" class="btn-secondary btn-sm" style="padding:5px 10px;font-size:12px;color:var(--orange);" data-nb-today="${t.id}">今日加练</button>` : ''}
                <button type="button" class="btn-secondary btn-sm" style="padding:5px 10px;font-size:12px;" data-nb-edit="${t.id}">编辑</button>
              </div>
            </div>
          </div>
        `;
      }).join('') : `
        <div class="empty-box" style="padding:24px 12px;">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${allReviews.length ? '当前筛选下暂无错题' : `还没有录入${esc(p.reviewLabel)}`}</div>
          <p style="font-size:12px;margin:6px 0 14px;">录入一道错题或薄弱知识点，系统会自动按艾宾浩斯曲线排入未来时间轴。</p>
        </div>
      `}

      <button type="button" class="btn-primary btn-block" id="btn-nb-add-review" style="margin-top:8px;">${esc(p.addReviewBtn)}计划</button>
    `);

    sheetContent.querySelectorAll('[data-nb-filter]').forEach((btn) => {
      btn.addEventListener('click', () => openReviewNotebookSheet(btn.dataset.nbFilter));
    });

    sheetContent.querySelectorAll('[data-nb-cycle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const t = state.data.tasks.find((x) => x.id === btn.dataset.nbCycle);
        if (!t) return;
        const cur = MASTERY_LEVELS[t.mastery] || MASTERY_LEVELS.weak;
        const next = MASTERY_LEVELS[cur.next];
        try {
          await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ mastery: next.id }) });
          await loadBootstrap(true);
          openReviewNotebookSheet(filterMastery);
          showHud(`已标记为「${next.label}」`);
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    });

    sheetContent.querySelectorAll('[data-nb-today]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const t = state.data.tasks.find((x) => x.id === btn.dataset.nbToday);
        if (!t) return;
        const nextDates = Array.from(new Set([...(t.reviewDates || [t.date]), today])).sort();
        try {
          await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ reviewDates: nextDates }) });
          await loadBootstrap(true);
          openReviewNotebookSheet(filterMastery);
          showHud('已加入今日复习队列');
        } catch (err) { showHud(err.message, 'var(--red)'); }
      });
    });

    sheetContent.querySelectorAll('[data-nb-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = state.data.tasks.find((x) => x.id === btn.dataset.nbEdit);
        if (t) openTaskEditorSheet(t);
      });
    });

    document.getElementById('btn-nb-add-review').addEventListener('click', () => {
      openTaskEditorSheet(null, '', 'review');
    });
  }

  function openExamEditorSheet(existingExam = null) {
    const isEdit = Boolean(existingExam);
    let pickedColor = isEdit ? (existingExam.color || '#0071E3') : '#0071E3';
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${isEdit ? '编辑目标倒计时' : '设定考试 / 目标倒计时'}</h2>
        ${sheetCloseBtn()}
      </div>
      <form id="form-exam-editor">
        <div class="field">
          <label class="field-label" for="input-exam-name">考试或目标名称</label>
          <input id="input-exam-name" class="input" type="text" required maxlength="30" placeholder="例如：2027 全国考研初试" value="${esc(isEdit ? existingExam.name : '')}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-date">目标日期</label>
          <input id="input-exam-date" class="input tabular" type="date" required value="${esc(isEdit ? existingExam.targetDate : addDaysStr(60))}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-tag">阶段标签</label>
          <input id="input-exam-tag" class="input" type="text" maxlength="12" value="${esc(isEdit ? existingExam.tag : '核心目标')}" />
        </div>
        <div class="field">
          <label class="field-label">主题标识色</label>
          <div class="color-swatch-row">
            ${SYSTEM_COLORS.map((c) => `
              <button type="button" class="color-swatch ${c === pickedColor ? 'is-selected' : ''}" data-exam-swatch="${c}" style="background:${c}" aria-label="选择颜色"></button>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn-primary btn-block">${isEdit ? '保存更改' : '保存并置顶显示'}</button>
      </form>
    `);

    sheetContent.querySelectorAll('[data-exam-swatch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pickedColor = btn.dataset.examSwatch;
        sheetContent.querySelectorAll('[data-exam-swatch]').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    document.getElementById('form-exam-editor').addEventListener('submit', async (e) => {
      e.preventDefault();
      blurActiveInput();
      const name = document.getElementById('input-exam-name').value.trim();
      const targetDate = document.getElementById('input-exam-date').value;
      const tag = document.getElementById('input-exam-tag').value.trim() || '核心目标';
      if (!name || !targetDate) return;
      closeSheet();
      try {
        if (isEdit) {
          await api(`/api/exams/${existingExam.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name, targetDate, tag, color: pickedColor })
          });
          await loadBootstrap(true);
          showHud('目标倒计时已更新');
        } else {
          await api('/api/exams', {
            method: 'POST',
            body: JSON.stringify({ userId: state.userId, name, targetDate, tag, color: pickedColor, pinned: true })
          });
          await loadBootstrap(true);
          showHud('目标倒计时已置顶');
        }
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function openCreateGroupSheet() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">创建学习小组</h2>
        ${sheetCloseBtn()}
      </div>
      <form id="form-create-group">
        <div class="field">
          <label class="field-label" for="input-group-name">小组名称</label>
          <input id="input-group-name" class="input" type="text" required maxlength="24" placeholder="例如：考研每日打卡小组" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-exam">共同备考目标</label>
          <input id="input-group-exam" class="input" type="text" required maxlength="24" placeholder="例如：2027 考研初试" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-date">共同目标日期</label>
          <input id="input-group-date" class="input tabular" type="date" required value="${addDaysStr(80)}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-notice">小组公告</label>
          <input id="input-group-notice" class="input" type="text" maxlength="60" value="每天按计划完成打卡，互相监督。" />
        </div>
        <button type="submit" class="btn-primary btn-block">立即创建并生成邀请码</button>
      </form>
    `);

    document.getElementById('form-create-group').addEventListener('submit', async (e) => {
      e.preventDefault();
      blurActiveInput();
      const name = document.getElementById('input-group-name').value.trim();
      const examName = document.getElementById('input-group-exam').value.trim();
      const targetDate = document.getElementById('input-group-date').value;
      const notice = document.getElementById('input-group-notice').value.trim();
      if (!name) return;
      closeSheet();
      try {
        const res = await api('/api/groups', { method: 'POST', body: JSON.stringify({ userId: state.userId, name, examName, targetDate, notice }) });
        state.activeGroupId = res.group.id;
        await loadBootstrap(true);
        showHud(`小组已创建，邀请码 ${res.group.inviteCode}`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function openJoinGroupSheet(prefillCode = '', sharedGroup = null) {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">加入学习小组</h2>
        ${sheetCloseBtn()}
      </div>
      <form id="form-join-group">
        ${sharedGroup ? `
          <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
            <div style="font-size:12px;color:var(--accent);font-weight:600;">收到学习小组邀请</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;">${esc(sharedGroup.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">共同目标：${esc(sharedGroup.examName)} · ${esc(sharedGroup.targetDate)}</div>
          </div>
        ` : ''}
        <div class="field">
          <label class="field-label" for="input-join-code">输入 6 位小组邀请码</label>
          <input id="input-join-code" class="input tabular" style="text-transform:uppercase;letter-spacing:0.12em;font-weight:700;" type="text" required maxlength="8" placeholder="输入 6 位邀请码" value="${esc(prefillCode)}" />
        </div>
        <button type="submit" class="btn-primary btn-block">立即加入小组</button>
      </form>
    `);

    document.getElementById('form-join-group').addEventListener('submit', async (e) => {
      e.preventDefault();
      blurActiveInput();
      const inviteCode = document.getElementById('input-join-code').value.trim().toUpperCase();
      if (!inviteCode) return;
      closeSheet();
      try {
        const res = await api('/api/groups/join', { method: 'POST', body: JSON.stringify({ userId: state.userId, inviteCode, sharedGroup }) });
        state.activeGroupId = res.group.id;
        state.activeTab = 'groups';
        syncTabButtons();
        await loadBootstrap(true);
        showHud(`已加入「${res.group.name}」`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  // =========================================================================
  // Wall-Clock Accurate Focus Timer (Survives iOS Safari Background Sleep!)
  // =========================================================================

  function getFocusRemainingSec() {
    const f = state.focus;
    if (!f.running || !f.endAt) return f.remainingSec;
    return Math.max(0, Math.ceil((f.endAt - Date.now()) / 1000));
  }

  function updateFocusDomInPlace() {
    const f = state.focus;
    const rem = getFocusRemainingSec();
    const totalSec = Math.max(1, f.presetMin * 60);
    const pct = Math.min(100, Math.max(0, ((totalSec - rem) / totalSec) * 100));

    const clock = document.getElementById('focus-sheet-clock');
    if (clock) clock.textContent = formatTimer(rem);
    const liveBar = document.getElementById('live-focus-bar-clock');
    if (liveBar) liveBar.textContent = formatTimer(rem);
    const ringEl = document.getElementById('focus-ring-fill');
    if (ringEl) {
      const c = Number(ringEl.dataset.circumference || 0);
      if (c > 0) ringEl.setAttribute('stroke-dashoffset', (c * (1 - pct / 100)).toFixed(2));
    }
    const toggleBtn = document.getElementById('focus-toggle-btn');
    if (toggleBtn) toggleBtn.textContent = f.running ? '暂停专注' : '开始专注';
  }

  function openFocusSheet() {
    if (!state.data || !state.data.user) return;
    const p = getPack();
    const f = state.focus;
    const rem = getFocusRemainingSec();
    const totalSec = Math.max(1, f.presetMin * 60);
    const pct = Math.round(((totalSec - rem) / totalSec) * 100);
    const todayTodos = getDayStats(state.data.tasks, todayKey()).list.filter((t) => !isTaskDoneOnDate(t, todayKey()));

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${esc(p.focusSheetTitle)}</h2>
        ${sheetCloseBtn()}
      </div>
      <div class="focus-dial-wrap">
        <div class="ring-box" style="margin:6px 0 14px;">
          ${ringSVG(pct, 196, 9, 'var(--accent)', 'focus-ring-fill')}
          <div class="ring-center" style="flex-direction:column;gap:4px;padding:0 18px;text-align:center;">
            <span id="focus-sheet-clock" class="focus-time-big">${formatTimer(rem)}</span>
            <span id="focus-sheet-label" style="font-size:12px;color:var(--text-secondary);font-weight:500;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.label)}</span>
          </div>
        </div>
        <div class="chip-row" style="justify-content:center;margin-bottom:14px;">
          ${[25, 45, 60].map((m) => `
            <button type="button" class="choice-chip ${f.presetMin === m ? 'is-selected' : ''}" data-focus-preset="${m}">${m} 分钟</button>
          `).join('')}
        </div>
        ${todayTodos.length ? `
          <div style="width:100%;margin-bottom:14px;">
            <div class="field-label" style="text-align:center;">关联今日待办任务（可选）</div>
            <div class="chip-row" style="justify-content:center;">
              ${todayTodos.slice(0, 3).map((t) => {
                const lbl = `${t.category} · ${t.title}`;
                return `<button type="button" class="choice-chip ${f.label === lbl ? 'is-selected' : ''}" data-focus-task="${esc(lbl)}" style="max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.title)}</button>`;
              }).join('')}
            </div>
          </div>
        ` : ''}
        <div class="btn-row" style="width:100%;">
          <button id="focus-toggle-btn" class="btn-primary">${f.running ? '暂停专注' : '开始专注'}</button>
          <button id="focus-finish-btn" class="btn-secondary">结算记录时长</button>
        </div>
      </div>
    `);

    sheetContent.querySelectorAll('[data-focus-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const min = Number(btn.dataset.focusPreset);
        stopFocusInterval();
        f.presetMin = min;
        f.remainingSec = min * 60;
        sheetContent.querySelectorAll('[data-focus-preset]').forEach((b) => b.classList.toggle('is-selected', b === btn));
        updateFocusDomInPlace();
      });
    });

    sheetContent.querySelectorAll('[data-focus-task]').forEach((btn) => {
      btn.addEventListener('click', () => {
        f.label = btn.dataset.focusTask;
        const lblEl = document.getElementById('focus-sheet-label');
        if (lblEl) lblEl.textContent = f.label;
        sheetContent.querySelectorAll('[data-focus-task]').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    document.getElementById('focus-toggle-btn').addEventListener('click', () => {
      if (f.running) stopFocusInterval();
      else startFocusInterval();
      updateFocusDomInPlace();
      renderView(false);
    });

    document.getElementById('focus-finish-btn').addEventListener('click', async () => {
      const remNow = getFocusRemainingSec();
      const elapsedMin = Math.max(1, Math.round((f.presetMin * 60 - remNow) / 60) || f.presetMin);
      stopFocusInterval();
      f.remainingSec = f.presetMin * 60;
      closeSheet();
      try {
        await api('/api/focus/complete', { method: 'POST', body: JSON.stringify({ userId: state.userId, minutes: elapsedMin, label: f.label }) });
        await loadBootstrap(true);
        showHud(`已记录 ${elapsedMin} 分钟专注时长`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function startFocusInterval() {
    const f = state.focus;
    if (f.running) return;
    f.running = true;
    f.endAt = Date.now() + f.remainingSec * 1000;
    f.timerId = setInterval(async () => {
      const rem = getFocusRemainingSec();
      f.remainingSec = rem;
      updateFocusDomInPlace();
      if (rem <= 0) {
        stopFocusInterval();
        const mins = f.presetMin;
        f.remainingSec = mins * 60;
        await api('/api/focus/complete', { method: 'POST', body: JSON.stringify({ userId: state.userId, minutes: mins, label: f.label }) }).catch(() => {});
        await loadBootstrap(true);
        showHud(`专注 ${mins} 分钟完成，状态极佳`);
      }
    }, 500);
  }

  function stopFocusInterval() {
    const f = state.focus;
    if (f.running) f.remainingSec = getFocusRemainingSec();
    f.running = false;
    f.endAt = null;
    if (f.timerId) { clearInterval(f.timerId); f.timerId = null; }
  }

  // Re-sync focus timer immediately when returning from iOS background
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.focus.running) updateFocusDomInPlace();
  });

  // =========================================================================
  // Fast Preview + Crisp 1170x2532 HD PNG Lock Screen Wallpaper Generator
  // =========================================================================

  function renderLockscreenCanvasDataUrl(previewMode = false) {
    if (!state.data || !state.data.user) return '';
    const canvas = document.getElementById('wallpaper-canvas');
    const scale = previewMode ? 0.5 : 1;
    const W = Math.round(1170 * scale);
    const H = Math.round(2532 * scale);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(scale, scale);

    const p = getPack();
    const styleId = state.stylePack;
    const isDark = state.theme === 'dark';
    const today = todayKey();
    const pinned = state.data.exams[0] || { name: p.countdownEmptyTitle, tag: p.name, daysLeft: 0, progress: 0, targetDate: today };
    const todayStats = getDayStats(state.data.tasks, today);
    const tasks = todayStats.list.slice(0, 3);
    const grp = state.data.groups[0];

    const palettes = {
      apple: isDark
        ? { bg0: '#070C18', bg1: '#000000', glow: 'rgba(10,132,255,0.22)', card: 'rgba(28,28,30,0.88)', border: 'rgba(255,255,255,0.12)', accent: '#0A84FF', fg: '#F5F5F7', muted: '#98989D', sep: 'rgba(255,255,255,0.10)' }
        : { bg0: '#E8F0FC', bg1: '#F5F5F7', glow: 'rgba(0,113,227,0.14)', card: 'rgba(255,255,255,0.88)', border: 'rgba(0,0,0,0.06)', accent: '#0071E3', fg: '#1D1D1F', muted: '#6E6E73', sep: 'rgba(0,0,0,0.07)' },
      kitty: isDark
        ? { bg0: '#27131D', bg1: '#140B10', glow: 'rgba(255,111,165,0.24)', card: 'rgba(38,22,30,0.90)', border: 'rgba(255,155,193,0.22)', accent: '#FF6FA5', fg: '#FFF2F6', muted: '#D4A5B8', sep: 'rgba(255,155,193,0.14)' }
        : { bg0: '#FFD9E7', bg1: '#FFF5F8', glow: 'rgba(232,62,125,0.16)', card: 'rgba(255,255,255,0.92)', border: 'rgba(232,62,125,0.16)', accent: '#E83E7D', fg: '#3B1E2B', muted: '#8E5B70', sep: 'rgba(232,62,125,0.12)' },
      xianxia: isDark
        ? { bg0: '#16241F', bg1: '#0C100F', glow: 'rgba(217,172,96,0.20)', card: 'rgba(21,29,26,0.92)', border: 'rgba(217,172,96,0.34)', accent: '#D9AC60', fg: '#F3EEE1', muted: '#A3A89E', sep: 'rgba(217,172,96,0.18)' }
        : { bg0: '#EAE2CF', bg1: '#F6F2E9', glow: 'rgba(184,115,36,0.14)', card: 'rgba(253,251,247,0.94)', border: 'rgba(184,115,36,0.28)', accent: '#B87324', fg: '#1F2421', muted: '#646B64', sep: 'rgba(31,36,33,0.10)' }
    };
    const pal = palettes[styleId] || palettes.apple;

    const bgGrad = ctx.createLinearGradient(0, 0, 1170, 2532);
    bgGrad.addColorStop(0, pal.bg0);
    bgGrad.addColorStop(1, pal.bg1);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1170, 2532);

    const rad = ctx.createRadialGradient(320, 960, 40, 320, 960, 680);
    rad.addColorStop(0, pal.glow);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 1170, 2532);

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    const cardRadius = styleId === 'xianxia' ? 40 : (styleId === 'kitty' ? 76 : 68);
    roundRect(96, 1030, 978, 900, cardRadius);
    ctx.fillStyle = pal.card;
    ctx.fill();
    ctx.lineWidth = styleId === 'xianxia' ? 3 : 2;
    ctx.strokeStyle = pal.border;
    ctx.stroke();

    if (styleId === 'xianxia') {
      roundRect(114, 1048, 942, 864, 28);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isDark ? 'rgba(217,172,96,0.22)' : 'rgba(184,115,36,0.20)';
      ctx.stroke();

      // Subtle antique lotus seal in top-right of card
      ctx.save();
      ctx.translate(950, 1148);
      ctx.strokeStyle = isDark ? 'rgba(217,172,96,0.42)' : 'rgba(184,115,36,0.34)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.accent;
      ctx.font = '700 28px "Songti SC", "STSong", serif';
      ctx.textAlign = 'center';
      ctx.fillText('道', 0, 10);
      ctx.restore();
    } else if (styleId === 'kitty') {
      // Crisp vector ribbon bow motif in top-right of card
      ctx.save();
      ctx.translate(932, 1146);
      ctx.fillStyle = isDark ? 'rgba(255,111,165,0.28)' : 'rgba(232,62,125,0.16)';
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-18, -32, -62, -34, -64, 0);
      ctx.bezierCurveTo(-62, 34, -18, 32, 0, 0);
      ctx.bezierCurveTo(18, -32, 62, -34, 64, 0);
      ctx.bezierCurveTo(62, 34, 18, 32, 0, 0);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.restore();
    }

    const accent = pal.accent;
    const fg = pal.fg;
    const muted = pal.muted;
    const sep = pal.sep;
    const fontFamily = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';
    const headingFamily = styleId === 'xianxia'
      ? '"Songti SC", "STSong", "Noto Serif SC", Georgia, serif'
      : fontFamily;

    ctx.fillStyle = accent;
    ctx.font = `600 32px ${fontFamily}`;
    ctx.fillText(`${pinned.tag} · ${pinned.targetDate}`, 156, 1125);

    ctx.fillStyle = fg;
    ctx.font = `700 48px ${headingFamily}`;
    ctx.fillText(pinned.name.length > 16 ? `${pinned.name.slice(0, 16)}…` : pinned.name, 156, 1196);

    ctx.font = `700 144px ${fontFamily}`;
    const daysText = String(pinned.daysLeft);
    ctx.fillText(daysText, 156, 1352);
    const daysWidth = ctx.measureText(daysText).width;
    ctx.fillStyle = muted;
    ctx.font = `500 44px ${headingFamily}`;
    ctx.fillText(styleId === 'xianxia' ? '日' : '天', 156 + daysWidth + 14, 1348);

    roundRect(156, 1392, 858, 12, 6);
    ctx.fillStyle = sep;
    ctx.fill();
    if (pinned.progress > 0) {
      roundRect(156, 1392, Math.max(40, Math.round(858 * (pinned.progress / 100))), 12, 6);
      ctx.fillStyle = accent;
      ctx.fill();
    }

    if (tasks.length) {
      tasks.forEach((t, idx) => {
        const y = 1500 + idx * 104;
        const done = isTaskDoneOnDate(t, today);
        ctx.beginPath();
        ctx.arc(176, y - 12, 16, 0, Math.PI * 2);
        if (done) { ctx.fillStyle = accent; ctx.fill(); }
        else { ctx.strokeStyle = muted; ctx.lineWidth = 3.5; ctx.stroke(); }
        ctx.fillStyle = done ? muted : fg;
        ctx.font = `500 35px ${fontFamily}`;
        const fullLabel = `${t.category} · ${t.title}`;
        ctx.fillText(fullLabel.length > 18 ? `${fullLabel.slice(0, 18)}…` : fullLabel, 218, y);
      });
    } else {
      ctx.fillStyle = muted;
      ctx.font = `500 34px ${fontFamily}`;
      ctx.fillText(p.wallpaperFallback, 156, 1550);
    }

    ctx.fillStyle = sep;
    ctx.fillRect(156, 1812, 858, 2);

    ctx.fillStyle = muted;
    ctx.font = `500 31px ${fontFamily}`;
    const footerLeft = grp
      ? `${grp.name} · 今日 ${grp.teamPct}%`
      : (styleId === 'xianxia'
        ? `${state.data.user.name} · ${getXianxiaRealm(state.data.user.streak)} · 连续 ${state.data.user.streak} 日`
        : `${state.data.user.name} · 连续 ${state.data.user.streak} 天`);
    ctx.fillText(footerLeft, 156, 1878);

    ctx.fillStyle = accent;
    ctx.font = `600 31px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${p.tileProgressToday} ${todayStats.done}/${todayStats.total}`, 1014, 1878);
    ctx.textAlign = 'left';
    ctx.restore();

    return canvas.toDataURL('image/png');
  }

  function downloadLockscreenPNG() {
    const pinned = (state.data && state.data.exams[0]) || { daysLeft: 0 };
    const url = renderLockscreenCanvasDataUrl(false);
    if (!url) return;
    const link = document.createElement('a');
    link.download = `时序倒计时壁纸-${pinned.daysLeft}天.png`;
    link.href = url;
    link.click();
    showHud('1170×2532 高清壁纸已保存');
  }

  importBackupInput.addEventListener('change', async () => {
    const file = importBackupInput.files && importBackupInput.files[0];
    importBackupInput.value = '';
    if (!file) return;
    try {
      const txt = await file.text();
      const snap = JSON.parse(txt);
      if (!snap || !snap.user || !snap.user.account) throw new Error('备份文件格式不正确');
      const res = await api('/api/account/import', { method: 'POST', body: JSON.stringify({ snapshot: snap }) });
      closeSheet();
      saveSession(res.user.id, res.user.account);
      await loadBootstrap(false);
      showHud(`已成功恢复统一账户 @${res.user.account} 的全部数据`);
    } catch (err) {
      showHud(err.message || '导入失败，请检查备份文件', 'var(--red)');
    }
  });

  // =========================================================================
  // Navigation & Event Delegation
  // =========================================================================

  function syncTabButtons() {
    document.querySelectorAll('.tab-item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === state.activeTab);
    });
  }

  document.querySelectorAll('.tab-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.data || !state.data.user) { showHud('请先登录或注册统一账户', 'var(--accent)'); return; }
      const next = btn.dataset.tab;
      if (next === state.activeTab) { mainScroll.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      state.activeTab = next;
      syncTabButtons();
      mainScroll.scrollTop = 0;
      topNav.classList.remove('is-scrolled');
      renderView(true);
    });
  });

  mainScroll.addEventListener('scroll', () => {
    topNav.classList.toggle('is-scrolled', mainScroll.scrollTop > 32);
  }, { passive: true });

  document.getElementById('nav-user-btn').addEventListener('click', openAccountSheet);
  const navStyleBtn = document.getElementById('nav-style-btn');
  if (navStyleBtn) navStyleBtn.addEventListener('click', openStylePackSheet);
  document.getElementById('nav-focus-btn').addEventListener('click', openFocusSheet);
  document.getElementById('nav-theme-btn').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    if (state.activeTab === 'desktop' && state.data && state.data.user) renderView(false);
  });

  fabAdd.addEventListener('click', () => {
    if (!state.data || !state.data.user) return;
    if (state.activeTab === 'exams') openExamEditorSheet(null);
    else openTaskEditorSheet(null, '', state.taskFilter === 'review' ? 'review' : 'normal');
  });

  let syncDebounceTimer = null;
  function scheduleQuietSync(delayMs = 260) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => loadBootstrap(true), delayMs);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'close-sheet') { e.preventDefault(); e.stopPropagation(); return closeSheet(); }
    if (action === 'open-style-packs') return openStylePackSheet();
    if (action === 'open-add-task') return openTaskEditorSheet(null, '', 'normal');
    if (action === 'open-add-review') return openTaskEditorSheet(null, '', 'review');
    if (action === 'open-review-notebook') return openReviewNotebookSheet('all');
    if (action === 'open-add-task-in-cat') return openTaskEditorSheet(null, btn.dataset.category || '', state.taskFilter === 'review' ? 'review' : 'normal');
    if (action === 'open-manage-categories') return openManageCategoriesSheet();
    if (action === 'open-add-exam') return openExamEditorSheet(null);
    if (action === 'open-create-group') return openCreateGroupSheet();
    if (action === 'open-join-group') return openJoinGroupSheet();
    if (action === 'open-focus') return openFocusSheet();
    if (action === 'open-analytics') return openAnalyticsSheet();
    if (action === 'trigger-import-backup') { importBackupInput.click(); return; }

    if (action === 'set-task-filter') {
      const next = btn.dataset.filter || 'all';
      if (state.taskFilter !== next) {
        state.taskFilter = next;
        renderView(false);
      }
      return;
    }

    if (action === 'cycle-mastery') {
      e.stopPropagation();
      const id = btn.dataset.id;
      const task = state.data.tasks.find((x) => x.id === id);
      if (!task) return;
      const cur = MASTERY_LEVELS[task.mastery] || MASTERY_LEVELS.weak;
      const next = MASTERY_LEVELS[cur.next];
      task.mastery = next.id;
      btn.className = `mastery-pill ${next.cls}`;
      btn.textContent = next.label;
      showHud(`掌握度已更新为「${next.label}」`, next.id === 'mastered' ? 'var(--green)' : (next.id === 'reviewing' ? 'var(--orange)' : 'var(--red)'));
      try {
        await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ mastery: next.id }) });
        scheduleQuietSync(260);
      } catch (err) {
        showHud(err.message, 'var(--red)');
        await loadBootstrap(true);
      }
      return;
    }

    if (action === 'edit-task') {
      const t = state.data.tasks.find((x) => x.id === btn.dataset.id);
      if (t) openTaskEditorSheet(t);
      return;
    }

    if (action === 'edit-exam') {
      // Ignore clicks on inner inline action buttons (pin/delete)
      if (e.target.closest('[data-action="pin-exam"], [data-action="delete-exam"]')) return;
      const ex = state.data.exams.find((x) => x.id === btn.dataset.id);
      if (ex) openExamEditorSheet(ex);
      return;
    }

    if (action === 'pick-date') {
      const ds = btn.dataset.date;
      if (ds) { state.selectedDate = ds; state.viewMonth = currentMonthKey(ds); renderView(false); }
      return;
    }

    if (action === 'toggle-month-cal') {
      state.showMonthCalendar = !state.showMonthCalendar;
      if (state.showMonthCalendar) state.viewMonth = currentMonthKey(state.selectedDate);
      renderView(false);
      return;
    }

    if (action === 'shift-month') {
      state.viewMonth = shiftMonthKey(state.viewMonth, Number(btn.dataset.delta) || 0);
      renderView(false);
      return;
    }

    if (action === 'goto-groups') {
      state.activeTab = 'groups'; syncTabButtons(); mainScroll.scrollTop = 0; renderView(true); return;
    }

    if (action === 'goto-exams') {
      state.activeTab = 'exams'; syncTabButtons(); mainScroll.scrollTop = 0; renderView(true); return;
    }

    if (action === 'select-group') {
      state.activeGroupId = btn.dataset.id; renderView(false); return;
    }

    if (action === 'toggle-task') {
      e.stopPropagation();
      const id = btn.dataset.id;
      const task = state.data.tasks.find((t) => t.id === id);
      if (!task) return;
      const dateStr = state.selectedDate;
      const nextDone = !isTaskDoneOnDate(task, dateStr);

      // Optimistically animate the exact row without tearing down DOM mid-spring!
      const rowEl = document.querySelector(`[data-task-row="${id}"]`);
      if (rowEl) rowEl.classList.toggle('is-done', nextDone);

      if (!Array.isArray(task.completedDates)) task.completedDates = [];
      if (nextDone && !task.completedDates.includes(dateStr)) task.completedDates.push(dateStr);
      if (!nextDone) task.completedDates = task.completedDates.filter((d) => d !== dateStr);

      const st = getDayStats(state.data.tasks, dateStr);
      const p = getPack();
      if (nextDone) {
        if (st.total > 0 && st.done === st.total) showHud(state.stylePack === 'apple' ? `${getRelativeDayTitle(dateStr)}${p.hudAllDone}` : p.hudAllDone, 'var(--green)');
        else showHud(dateStr === todayKey() ? p.hudCheckin : `已标记 ${formatDateCN(dateStr)} 完成`);
      }

      try {
        await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: nextDone, date: dateStr }) });
        scheduleQuietSync(280);
      } catch (err) {
        showHud(err.message, 'var(--red)');
        await loadBootstrap(true);
      }
      return;
    }

    if (action === 'delete-task') {
      e.preventDefault();
      e.stopPropagation();
      const targetTask = state.data.tasks.find((t) => t.id === btn.dataset.id);
      const snapshotCopy = targetTask ? JSON.parse(JSON.stringify(targetTask)) : null;
      try {
        await api(`/api/tasks/${btn.dataset.id}`, { method: 'DELETE' });
        await loadBootstrap(true);
        if (snapshotCopy) {
          showHud('已删除任务', 'var(--text-tertiary)', {
            label: '撤销',
            onClick: async () => {
              await api('/api/tasks/restore', { method: 'POST', body: JSON.stringify({ task: snapshotCopy }) });
              await loadBootstrap(true);
              showHud('已撤销删除');
            }
          });
        }
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'pin-exam') {
      e.stopPropagation();
      try {
        await api(`/api/exams/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) });
        await loadBootstrap(true);
        showHud('已置顶至首页与锁屏倒计时');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'delete-exam') {
      e.stopPropagation();
      try {
        await api(`/api/exams/${btn.dataset.id}`, { method: 'DELETE' });
        await loadBootstrap(true);
        showHud('已移除目标');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'quick-preset-exam') {
      const preset = EXAM_PRESETS[Number(btn.dataset.idx)];
      if (!preset) return;
      try {
        await api('/api/exams', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, name: preset.name, tag: preset.tag, targetDate: addDaysStr(preset.days), color: preset.color, pinned: true })
        });
        await loadBootstrap(true);
        showHud(`已添加并置顶「${preset.name}」`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'copy-invite') {
      const grp = state.data.groups.find((g) => g.id === btn.dataset.groupId);
      if (!grp) return;
      const base = window.location.origin + window.location.pathname;
      const encoded = encodeB64Json({ name: grp.name, inviteCode: grp.inviteCode, examName: grp.examName, targetDate: grp.targetDate, notice: grp.notice });
      const inviteUrl = `${base}?join=${encodeURIComponent(grp.inviteCode)}${encoded ? `&g=${encodeURIComponent(encoded)}` : ''}`;
      await copyText(`我在「时序」创建了学习小组【${grp.name}】，点击链接一起倒计时打卡（邀请码 ${grp.inviteCode}）：${inviteUrl}`, '已复制微信邀请链接');
      return;
    }

    if (action === 'leave-group') {
      try {
        await api(`/api/groups/${btn.dataset.groupId}/leave`, { method: 'POST', body: JSON.stringify({ userId: state.userId }) });
        state.activeGroupId = null;
        await loadBootstrap(true);
        showHud('已退出该学习小组');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'tap-member') {
      const targetUserId = btn.dataset.user;
      if (targetUserId === state.userId) { showHud('这是你自己的今日学习进度'); return; }
      const done = Number(btn.dataset.done);
      const total = Number(btn.dataset.total);
      const kind = total > 0 && done >= total ? 'cheer' : 'nudge';
      try {
        await api(`/api/groups/${btn.dataset.group}/nudge`, {
          method: 'POST',
          body: JSON.stringify({ fromUserId: state.userId, toUserId: targetUserId, kind })
        });
        await loadBootstrap(true);
        const p = getPack();
        showHud(kind === 'cheer' ? p.cheerHud(btn.dataset.name) : p.nudgeHud(btn.dataset.name), 'var(--accent)');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'like-feed') {
      try {
        await api(`/api/feeds/${btn.dataset.id}/like`, { method: 'POST', body: JSON.stringify({ userId: state.userId }) });
        await loadBootstrap(true);
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'download-wallpaper-png') return downloadLockscreenPNG();
    if (action === 'copy-wallpaper-url') return copyText(btn.dataset.url, '已复制链接');
    if (action === 'copy-scriptable') {
      await loadScriptableSnippet();
      return copyText(state.scriptableCode, '已复制 Scriptable 小组件代码');
    }
  });

  function setupRealtime() {
    if (state.mode === 'server' && window.EventSource) {
      const es = new EventSource('./api/events');
      es.addEventListener('sync', () => loadBootstrap(true));
      es.addEventListener('toast', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.fromUserId !== state.userId && msg.text) showHud(msg.text, 'var(--accent)');
        } catch {}
      });
      es.onerror = () => { es.close(); setTimeout(setupRealtime, 5000); };
    } else if (bc) {
      bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'sync') {
          loadBootstrap(true);
          if (ev.data.toastMsg && ev.data.fromUserId !== state.userId) showHud(ev.data.toastMsg, 'var(--accent)');
        }
      };
    }
  }

  function checkWeChatBrowser() {
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      const overlay = document.getElementById('wechat-guide');
      overlay.classList.remove('hidden');
      document.getElementById('wechat-dismiss').addEventListener('click', () => overlay.classList.add('hidden'));
    }
  }

  function parseUrlActions() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    const sharedParam = params.get('g');
    const restoreParam = params.get('restore');
    if (restoreParam) {
      const snap = decodeB64Json(restoreParam);
      if (snap && snap.user && snap.user.account) {
        state.pendingRestore = snap;
        saveSession('');
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (joinCode) {
      state.pendingInvite = { code: joinCode.toUpperCase(), sharedGroup: sharedParam ? decodeB64Json(sharedParam) : null };
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // Global stability guards (prevent silent freezes or unhandled rejections)
  window.addEventListener('unhandledrejection', (ev) => {
    console.warn('[Recovered Rejection]', ev.reason);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              showHud('新版本已就绪，数据安全保留', 'var(--accent)', {
                label: '立即刷新',
                onClick: () => window.location.reload()
              });
            }
          });
        });
      }).catch(() => {});
    });
  }

  applyStylePack(state.stylePack);
  applyTheme(state.theme);
  checkWeChatBrowser();
  parseUrlActions();

  initPermanentStorage().then(() => loadBootstrap(false)).then(() => {
    setupRealtime();
    if (state.data && state.data.user && state.pendingInvite) {
      const inv = state.pendingInvite;
      state.pendingInvite = null;
      setTimeout(() => openJoinGroupSheet(inv.code, inv.sharedGroup), 350);
    }
  });
})();
