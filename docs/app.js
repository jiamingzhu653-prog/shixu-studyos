(() => {
  'use strict';

  // PERMANENT NEVER-CHANGING STORAGE KEYS (Guaranteed zero data loss across all future website updates)
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

  function todayKey() { return formatDateISO(new Date()); }
  function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseDateISO(str) {
    const [y, m, d] = String(str || '').split('-').map(Number);
    return new Date(y || 2026, (m || 1) - 1, d || 1);
  }
  function shiftDateISO(baseStr, deltaDays) {
    const d = parseDateISO(baseStr);
    d.setDate(d.getDate() + deltaDays);
    return formatDateISO(d);
  }
  function addDaysStr(days) { return shiftDateISO(todayKey(), days); }
  function currentMonthKey(dateStr = todayKey()) { return dateStr.slice(0, 7); }
  function shiftMonthKey(ym, deltaMonths) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + deltaMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function normalizeAccount(acc) {
    return String(acc || '').trim().toLowerCase().slice(0, 40);
  }

  // SHA-256 Password Hashing (works over HTTPS / localhost via SubtleCrypto + pure JS fallback)
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

  const state = {
    mode: 'auto', // 'server' | 'supabase' | 'local'
    userId: '',
    authMode: 'login', // 'login' | 'register'
    theme: localStorage.getItem('shixu_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    activeTab: 'today',
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
  const sheetBackdrop = document.getElementById('sheet-backdrop');
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
    const now = parseDateISO(todayKey());
    const target = parseDateISO(dateStr);
    if (Number.isNaN(target.getTime())) return 0;
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
    const today = todayKey();
    if (dateStr === today) return '今日学习';
    if (dateStr === shiftDateISO(today, -1)) return '昨日复盘';
    if (dateStr === shiftDateISO(today, 1)) return '明日计划';
    const d = parseDateISO(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日任务`;
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  }

  function formatTimer(sec) {
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  function genId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
  function genInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function isTaskOnDate(task, dateStr) {
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

  function encodeB64Json(obj) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch { return ''; }
  }
  function decodeB64Json(str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch { return null; }
  }

  function ringSVG(pct, size, strokeWidth, color) {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${strokeWidth}" />
        <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${strokeWidth}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />
      </svg>
    `;
  }

  let hudTimer = null;
  function showHud(text, dotColor = 'var(--green)') {
    hudText.textContent = text;
    hudDot.style.background = dotColor;
    hudPill.classList.add('is-visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hudPill.classList.remove('is-visible'), 2500);
  }

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
  // Resilient IndexedDB Mirror + Permanent Local Vault (Never loses data on updates)
  // =========================================================================

  function openVaultDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
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
    } catch {
      return null;
    }
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
      lastRolloverDate: raw.lastRolloverDate || todayKey(),
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
      if (!Array.isArray(t.completedDates)) t.completedDates = t.done ? [t.date || todayKey()] : [];
    }
    return s;
  }

  async function initPermanentStorage() {
    // 1. Restore local vault from permanent key -> IndexedDB mirror -> legacy keys (non-destructive)
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PERMANENT_VAULT_KEY) || 'null'); } catch {}

    if (!raw) {
      const fromIdb = await idbGet('vault');
      if (fromIdb) raw = fromIdb;
    }

    if (!raw) {
      for (const legacyKey of LEGACY_VAULT_KEYS) {
        try {
          const legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
          if (legacy && Array.isArray(legacy.users) && legacy.users.length > 0) {
            raw = legacy;
            break;
          }
        } catch {}
      }
    }

    const migrated = migrateStore(raw);
    localStorage.setItem(PERMANENT_VAULT_KEY, JSON.stringify(migrated));
    idbSet('vault', migrated);

    // 2. Restore remembered login session (localStorage -> IndexedDB -> legacy session key)
    let session = null;
    try { session = JSON.parse(localStorage.getItem(PERMANENT_SESSION_KEY) || 'null'); } catch {}
    if (!session) session = await idbGet('session');
    if (session && session.userId) {
      state.userId = session.userId;
    } else {
      const legacyUid = localStorage.getItem('shixu_raw_user_id');
      if (legacyUid && migrated.users.some((u) => u.id === legacyUid)) {
        state.userId = legacyUid;
        saveSession(legacyUid);
      }
    }
  }

  function saveSession(userId, account = '') {
    state.userId = userId || '';
    if (userId) {
      const sess = { userId, account: normalizeAccount(account), savedAt: Date.now() };
      localStorage.setItem(PERMANENT_SESSION_KEY, JSON.stringify(sess));
      idbSet('session', sess);
    } else {
      localStorage.removeItem(PERMANENT_SESSION_KEY);
      idbSet('session', null);
    }
  }

  function getLocalStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(PERMANENT_VAULT_KEY) || 'null'); } catch {}
    s = migrateStore(s);
    const today = todayKey();
    if (s.lastRolloverDate !== today) {
      for (const u of s.users) u.focusMinutesToday = 0;
      s.lastRolloverDate = today;
      localStorage.setItem(PERMANENT_VAULT_KEY, JSON.stringify(s));
      idbSet('vault', s);
    }
    return s;
  }

  function saveLocalStore(s, toastMsg) {
    localStorage.setItem(PERMANENT_VAULT_KEY, JSON.stringify(s));
    idbSet('vault', s);
    if (bc) bc.postMessage({ type: 'sync', toastMsg, fromUserId: state.userId });
    if (state.mode === 'supabase' && state.userId) {
      pushAccountToSupabase(s, state.userId).catch(() => {});
    }
  }

  // =========================================================================
  // Zero-Cost Supabase Cloud Sync Adapter (Activates automatically when configured)
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
    const row = {
      account: user.account,
      user_id: user.id,
      name: user.name,
      avatar: user.avatar,
      color: user.color,
      password_hash: user.passwordHash || '',
      streak: user.streak || 0,
      focus_minutes_today: user.focusMinutesToday || 0,
      last_rollover_date: s.lastRolloverDate || todayKey(),
      payload: {
        categories: s.categories.filter((c) => c.userId === user.id),
        exams: s.exams.filter((e) => e.userId === user.id),
        tasks: s.tasks.filter((t) => t.userId === user.id)
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

  async function pullAccountFromSupabase(account, passwordHash) {
    const rows = await sbFetch(`shixu_accounts?account=eq.${encodeURIComponent(normalizeAccount(account))}&select=*`);
    if (!rows || !rows.length) return null;
    const row = rows[0];
    if (passwordHash && row.password_hash && row.password_hash !== passwordHash) {
      throw new Error('密码不正确，请重试');
    }
    const s = getLocalStore();
    let user = s.users.find((u) => u.account === row.account);
    const hydratedUser = {
      id: row.user_id,
      account: row.account,
      name: row.name,
      avatar: row.avatar,
      color: row.color,
      passwordHash: row.password_hash,
      streak: row.streak || 0,
      focusMinutesToday: row.last_rollover_date === todayKey() ? (row.focus_minutes_today || 0) : 0,
      createdAt: user ? user.createdAt : Date.now()
    };
    if (user) Object.assign(user, hydratedUser);
    else s.users.push(hydratedUser);

    const p = row.payload || {};
    s.categories = s.categories.filter((c) => c.userId !== hydratedUser.id).concat(p.categories || []);
    s.exams = s.exams.filter((e) => e.userId !== hydratedUser.id).concat(p.exams || []);
    s.tasks = s.tasks.filter((t) => t.userId !== hydratedUser.id).concat(p.tasks || []);
    localStorage.setItem(PERMANENT_VAULT_KEY, JSON.stringify(s));
    idbSet('vault', s);
    state.lastSyncedAt = Date.now();
    return hydratedUser;
  }

  // =========================================================================
  // Local Data Operations (Parity with Server Mode)
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
    const safeUsers = s.users.map((u) => ({ id: u.id, account: u.account, name: u.name, avatar: u.avatar, color: u.color, streak: u.streak }));
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
        const members = g.memberIds
          .map((uid) => s.users.find((u) => u.id === uid))
          .filter(Boolean)
          .map((u) => {
            const st = getDayStats(s.tasks.filter((t) => t.userId === u.id), today);
            return { id: u.id, account: u.account, name: u.name, avatar: u.avatar, color: u.color, streak: u.streak, done: st.done, total: st.total, pct: st.pct };
          });
        const totalTasks = members.reduce((a, m) => a + m.total, 0);
        const doneTasks = members.reduce((a, m) => a + m.done, 0);
        const feeds = s.feeds
          .filter((f) => f.groupId === g.id)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30)
          .map((f) => {
            const u = s.users.find((x) => x.id === f.userId) || { name: '成员', avatar: '学', color: '#0071E3' };
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
      user.streak = Math.max(user.streak || 0, snap.user.streak || 0);
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
        const mergedDates = new Set([...(existing.completedDates || []), ...(t.completedDates || [])]);
        existing.completedDates = Array.from(mergedDates);
      }
    }
    for (const g of snap.groups || []) {
      let grp = s.groups.find((x) => x.inviteCode === g.inviteCode);
      if (!grp) {
        grp = {
          id: genId('g'),
          name: g.name,
          inviteCode: g.inviteCode || genInviteCode(),
          examName: g.examName || '共同目标',
          targetDate: g.targetDate || addDaysStr(60),
          notice: g.notice || '每天按计划完成打卡。',
          ownerId: user.id,
          memberIds: [user.id],
          createdAt: Date.now()
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
      if (account.length < 2) throw new Error('请输入至少 2 位统一账号（手机号或英文账号）');
      if (!name) throw new Error('请输入显示昵称');
      if (password.length < 4) throw new Error('请设置至少 4 位密码');

      if (state.mode === 'supabase') {
        const existingRemote = await sbFetch(`shixu_accounts?account=eq.${encodeURIComponent(account)}&select=account`).catch(() => []);
        if (existingRemote && existingRemote.length) throw new Error('该云端账号已注册，请直接切至「登录账户」');
      }
      if (s.users.some((u) => u.account === account)) throw new Error('该统一账号已存在，请直接切至「登录账户」');

      const passwordHash = await hashPassword(account, password);
      const user = {
        id: genId('u'),
        account,
        name,
        avatar: name.slice(0, 1),
        color: SYSTEM_COLORS[s.users.length % SYSTEM_COLORS.length],
        passwordHash,
        streak: 0,
        focusMinutesToday: 0,
        createdAt: Date.now()
      };
      s.users.push(user);

      if (body.joinCode) {
        const code = String(body.joinCode).trim().toUpperCase();
        let grp = s.groups.find((g) => g.inviteCode === code);
        if (!grp && body.sharedGroup && body.sharedGroup.name) {
          grp = {
            id: genId('g'),
            name: body.sharedGroup.name,
            inviteCode: code,
            examName: body.sharedGroup.examName || '共同目标',
            targetDate: body.sharedGroup.targetDate || addDaysStr(60),
            notice: body.sharedGroup.notice || '每天按计划完成打卡。',
            ownerId: user.id,
            memberIds: [user.id],
            createdAt: Date.now()
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
            : '当前设备未找到该账号；若从其他手机换机而来，请点击下方「导入换机备份 / 迁移码」'
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
      const user = mergeSnapshotIntoLocal(snap);
      return { user };
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

    // Tasks CRUD
    if (method === 'POST' && path === '/api/tasks') {
      const uid = body.userId || state.userId;
      const title = String(body.title || '').trim().slice(0, 60);
      if (!title) throw new Error('请输入任务名称');
      const categoryName = String(body.category || body.subject || '未分组').trim().slice(0, 18) || '未分组';
      if (categoryName !== '未分组') ensureLocalCategory(s, uid, categoryName, body.categoryColor);

      const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : today;
      const task = {
        id: genId('t'),
        userId: uid,
        title,
        category: categoryName,
        subject: categoryName,
        durationMin: Math.min(360, Math.max(5, Number(body.durationMin) || 30)),
        repeatDaily: Boolean(body.repeatDaily),
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
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : today;
      if (!Array.isArray(task.completedDates)) task.completedDates = [];
      const prev = task.completedDates.includes(targetDate);
      if (typeof body.done === 'boolean') {
        if (body.done && !prev) task.completedDates.push(targetDate);
        if (!body.done && prev) task.completedDates = task.completedDates.filter((d) => d !== targetDate);
      }

      let toastMsg = null;
      if (!prev && body.done === true && targetDate === today) {
        const u = s.users.find((x) => x.id === task.userId);
        if (u && u.streak === 0) u.streak = 1;
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
      if (idx !== -1) s.tasks.splice(idx, 1);
      saveLocalStore(s);
      return { ok: true };
    }

    // Exams
    if (method === 'POST' && path === '/api/exams') {
      const uid = body.userId || state.userId;
      if (body.pinned !== false) for (const e of s.exams) if (e.userId === uid) e.pinned = false;
      const exam = {
        id: genId('ex'),
        userId: uid,
        name: String(body.name || '').trim().slice(0, 30),
        tag: String(body.tag || '核心目标').trim().slice(0, 12),
        startDate: today,
        targetDate: body.targetDate,
        color: body.color || '#0071E3',
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
        if (u.streak === 0) u.streak = 1;
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
        id: genId('g'),
        name: String(body.name || '').trim().slice(0, 24),
        inviteCode,
        examName: String(body.examName || '共同备考目标').trim().slice(0, 24),
        targetDate: body.targetDate || addDaysStr(60),
        notice: String(body.notice || '每天按计划完成打卡，互相监督。').trim().slice(0, 60),
        ownerId,
        memberIds: [ownerId],
        createdAt: Date.now()
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
      if (!grp && body.sharedGroup && body.sharedGroup.name) {
        grp = {
          id: genId('g'),
          name: body.sharedGroup.name,
          inviteCode: code || genInviteCode(),
          examName: body.sharedGroup.examName || '共同备考目标',
          targetDate: body.sharedGroup.targetDate || addDaysStr(60),
          notice: body.sharedGroup.notice || '每天按计划完成打卡。',
          ownerId: uid,
          memberIds: [uid],
          createdAt: Date.now()
        };
        s.groups.push(grp);
        s.feeds.push({ id: genId('f'), groupId: grp.id, userId: uid, type: 'join', text: `通过邀请链接加入了「${grp.name}」`, createdAt: Date.now(), likedBy: [] });
        saveLocalStore(s);
        return { group: grp };
      }
      if (!grp) throw new Error('未找到该邀请码对应的学习小组，请先创建小组或确认邀请码');
      if (!grp.memberIds.includes(uid)) {
        grp.memberIds.push(uid);
        s.feeds.push({ id: genId('f'), groupId: grp.id, userId: uid, type: 'join', text: `加入小组，共同冲刺「${grp.examName}」`, createdAt: Date.now(), likedBy: [] });
      }
      saveLocalStore(s);
      return { group: grp };
    }

    const nMatch = path.match(/^\/api\/groups\/([^/]+)\/nudge$/);
    if (nMatch && method === 'POST') {
      const fromUser = s.users.find((u) => u.id === body.fromUserId);
      const toUser = s.users.find((u) => u.id === body.toUserId);
      if (!fromUser || !toUser) throw new Error('成员不存在');
      const kind = body.kind === 'cheer' ? 'cheer' : 'nudge';
      const text = kind === 'cheer' ? `给 ${toUser.name} 送上了鼓励` : `拍了拍 ${toUser.name}：该学习打卡啦`;
      s.feeds.push({ id: genId('f'), groupId: nMatch[1], userId: fromUser.id, type: kind, text, createdAt: Date.now(), likedBy: [] });
      saveLocalStore(s, `${fromUser.name} ${kind === 'cheer' ? '鼓励了' : '拍了拍'} ${toUser.name}`);
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

  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem('shixu_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    const metaTheme = document.getElementById('meta-theme-color');
    const metaStatus = document.getElementById('meta-status-bar');
    if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#000000' : '#F5F5F7');
    if (metaStatus) metaStatus.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
    document.getElementById('theme-icon-sun').classList.toggle('hidden', theme === 'dark');
    document.getElementById('theme-icon-moon').classList.toggle('hidden', theme !== 'dark');
  }

  function openSheet(html) {
    sheetContent.innerHTML = html;
    sheetBackdrop.classList.remove('hidden');
    sheetBackdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => sheetBackdrop.classList.add('is-open'));
  }

  function closeSheet() {
    sheetBackdrop.classList.remove('is-open');
    sheetBackdrop.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!sheetBackdrop.classList.contains('is-open')) sheetBackdrop.classList.add('hidden');
    }, 320);
  }

  sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetBackdrop) closeSheet();
  });

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
      // If Supabase configured and we have a remembered account, silently pull latest cloud snapshot
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
    if (data.user) {
      saveSession(data.user.id, data.user.account);
    }
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
    compactTitle.textContent = u
      ? (state.activeTab === 'today' ? getRelativeDayTitle(state.selectedDate) : (TAB_TITLES[state.activeTab] || '时序'))
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
  // Views
  // =========================================================================

  function renderView(animate = true) {
    if (!state.data) return;
    syncHeader();

    if (animate) {
      viewContainer.style.animation = 'none';
      void viewContainer.offsetWidth;
      viewContainer.style.animation = '';
    }

    if (!state.data.user) {
      // Default to register if no users exist locally yet, otherwise login
      if (state.data.users.length === 0 && state.authMode === 'login' && !state.pendingRestore) {
        state.authMode = 'register';
      }
      viewContainer.innerHTML = buildUnifiedAuthView();
      bindUnifiedAuthEvents();
      return;
    }

    if (state.activeTab === 'today') {
      viewContainer.innerHTML = buildTodayView();
    } else if (state.activeTab === 'groups') {
      viewContainer.innerHTML = buildGroupsView();
    } else if (state.activeTab === 'exams') {
      viewContainer.innerHTML = buildExamsView();
    } else if (state.activeTab === 'desktop') {
      viewContainer.innerHTML = buildDesktopView();
      const previewImg = document.getElementById('wallpaper-preview-img');
      if (previewImg) previewImg.src = renderLockscreenCanvasDataUrl();
      loadScriptableSnippet().then(() => {
        const codeEl = document.getElementById('scriptable-code-preview');
        if (codeEl) codeEl.textContent = state.scriptableCode;
      });
    }
  }

  function buildUnifiedAuthView() {
    const isReg = state.authMode === 'register';
    const invite = state.pendingInvite;
    const restore = state.pendingRestore;
    const cloudReady = state.mode === 'server' || state.mode === 'supabase';
    const existingUsers = (state.data && state.data.users) || [];

    return `
      <div style="padding:18px 4px 12px;text-align:center;">
        <img src="./icons/apple-touch-icon.png" alt="时序图标" style="width:72px;height:72px;border-radius:18px;box-shadow:0 12px 28px rgba(0,113,227,0.26);margin-bottom:14px;" />
        <h1 class="page-title" style="font-size:28px;">时序 · 统一学习账户</h1>
        <p style="font-size:13px;line-height:1.55;color:var(--text-secondary);margin:8px auto 18px;max-width:310px;">
          ${cloudReady
            ? '云端永久记忆已开启：无论网站升级或更换任意设备，登录同一账户即可自动恢复全部学习记录。'
            : '账户数据采用本地双层永久存储，网站升级绝不丢失；更换设备时可通过换机迁移码或备份文件完整恢复。'}
        </p>

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
          showHud(`欢迎回来，${res.user.name}！数据已 100% 恢复`);
        } catch (err) {
          showHud(err.message, 'var(--red)');
        }
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
        } catch (err) {
          showHud(err.message, 'var(--red)');
        }
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
    const { user, tasks, categories, exams, groups } = state.data;
    const sel = state.selectedDate;
    const pinned = exams[0];
    const dayStats = getDayStats(tasks, sel);
    const primaryGroup = groups[0];

    const colorMap = new Map();
    for (const c of categories) colorMap.set(c.name, c.color);

    const groupMap = new Map();
    for (const c of categories) {
      const catTasks = dayStats.list.filter((t) => t.category === c.name);
      if (catTasks.length) groupMap.set(c.name, catTasks);
    }
    for (const t of dayStats.list) {
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
        ${primaryGroup ? `
          <button class="btn-secondary btn-sm" data-action="goto-groups">小组 ${primaryGroup.teamPct}%</button>
        ` : ''}
      </div>

      ${pinned ? `
        <section class="hero-countdown" data-action="goto-exams" style="cursor:pointer;">
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
              <div>备考进度</div>
              <div class="hero-progress-val tabular">${pinned.progress}%</div>
            </div>
          </div>
          <div class="hero-bar">
            <div class="hero-bar-fill" style="width:${pinned.progress}%"></div>
          </div>
        </section>
      ` : `
        <section class="card card-padded" style="text-align:center;padding:20px 18px;">
          <div style="font-size:15px;font-weight:700;">尚未设定考试或目标倒计时</div>
          <p style="font-size:12px;color:var(--text-secondary);margin:5px 0 12px;">设定考试或目标日期，首页与锁屏自动倒数。</p>
          <button class="btn-primary btn-sm" data-action="open-add-exam">+ 设定目标倒计时</button>
        </section>
      `}

      ${buildTimelineSection(tasks)}

      <section class="summary-strip">
        <div class="card summary-tile">
          <div>
            <div class="summary-label">${sel === todayKey() ? '今日进度' : '当日进度'}</div>
            <div class="summary-value tabular">${dayStats.done} / ${dayStats.total}</div>
            <div class="summary-sub">已坚持 ${user.streak} 天</div>
          </div>
          <div class="ring-box">
            ${ringSVG(dayStats.pct, 48, 5, dayStats.pct === 100 && dayStats.total > 0 ? 'var(--green)' : 'var(--accent)')}
            <span class="ring-center">${dayStats.pct}%</span>
          </div>
        </div>

        <button class="card summary-tile" data-action="open-focus" style="text-align:left;">
          <div>
            <div class="summary-label">今日专注</div>
            <div class="summary-value tabular">${user.focusMinutesToday || 0}<span style="font-size:13px;font-weight:500;margin-left:2px;">分</span></div>
            <div class="summary-sub" style="color:var(--accent);font-weight:500;">开启专注计时 ›</div>
          </div>
          <div class="ring-box">
            ${ringSVG(Math.min(100, Math.round(((user.focusMinutesToday || 0) / 180) * 100)), 48, 5, 'var(--green)')}
            <span class="ring-center" style="font-size:10px;">专注</span>
          </div>
        </button>
      </section>

      <div class="section-header">
        <h2 class="section-title">${formatDateCN(sel)} · 任务序列</h2>
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="section-action" style="color:var(--text-secondary);" data-action="open-manage-categories">管理大标题</button>
          <button class="section-action" data-action="open-add-task">+ 添加任务</button>
        </div>
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
                  <button class="category-quick-add" data-action="open-add-task-in-cat" data-category="${esc(grp.name)}" title="在「${esc(grp.name)}」下添加任务">+</button>
                </div>
              </div>

              <div class="ios-list">
                ${grp.items.map((t) => {
                  const done = isTaskDoneOnDate(t, sel);
                  return `
                    <div class="task-row ${done ? 'is-done' : ''}">
                      <button class="task-check-btn" data-action="toggle-task" data-id="${t.id}" aria-label="${done ? '取消完成' : '标记完成'}">
                        <svg class="task-check-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M4.5 10.5l3.6 3.6 7.4-7.8"/>
                        </svg>
                      </button>
                      <button class="task-main" data-action="toggle-task" data-id="${t.id}">
                        <div class="task-title">${esc(t.title)}</div>
                        <div class="task-meta">
                          <span class="tabular">${t.durationMin} 分钟</span>
                          ${t.repeatDaily ? '<span>· 每日重复</span>' : ''}
                        </div>
                      </button>
                      <button class="task-delete-btn" data-action="delete-task" data-id="${t.id}" aria-label="删除任务" title="删除">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
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
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);">${getRelativeDayTitle(sel)}暂无安排</div>
          <p style="font-size:12px;margin:6px 0 14px;">你可以先自定义任务大标题（如专业课、数学、英语），再添加当日或每日重复任务。</p>
          <div style="display:flex;justify-content:center;gap:8px;">
            <button class="btn-secondary btn-sm" data-action="open-manage-categories">自定义大标题</button>
            <button class="btn-primary btn-sm" data-action="open-add-task">+ 添加任务</button>
          </div>
        </section>
      `}
    `;
  }

  function buildGroupsView() {
    const { groups, user } = state.data;
    const activeGroup = groups.find((g) => g.id === state.activeGroupId) || groups[0];

    return `
      <div class="page-header">
        <div>
          <div class="page-date">多人共学 · 互相监督</div>
          <h1 class="page-title">学习小组</h1>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-secondary btn-sm" data-action="open-join-group">邀请码加入</button>
          <button class="btn-primary btn-sm" data-action="open-create-group">+ 建组</button>
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
              <span style="color:var(--text-secondary);font-weight:500;">今日小组总达成率</span>
              <span class="tabular" style="font-weight:700;color:var(--accent);">${activeGroup.teamPct}% (${activeGroup.doneTasks}/${activeGroup.totalTasks})</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar-fill" style="width:${activeGroup.teamPct}%"></div>
            </div>
          </div>

          <div class="group-invite-bar">
            <div class="invite-code-box">
              <span class="invite-code-label">小组邀请码</span>
              <span class="invite-code-val">${esc(activeGroup.inviteCode)}</span>
            </div>
            <button class="btn-primary btn-sm" data-action="copy-invite" data-group-id="${esc(activeGroup.id)}">
              复制微信邀请链接
            </button>
          </div>
        </section>

        <div class="section-header">
          <h2 class="section-title">组员今日进度 (${activeGroup.members.length} 人)</h2>
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
          <div class="member-hint">点击成员头像可互相「拍一拍催学」或「点赞鼓励」</div>
        </section>

        <div class="section-header">
          <h2 class="section-title">小组打卡动态</h2>
        </div>

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
            <div class="card empty-box">还没有打卡记录，完成今日任务后会实时出现在这里。</div>
          `}
        </section>
      ` : `
        <section class="card empty-box" style="padding:36px 20px;">
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">尚未创建或加入学习小组</div>
          <p style="font-size:13px;line-height:1.55;margin:8px 0 18px;">
            创建一个学习小组设定共同考试倒计时，生成专属邀请码与链接邀请同伴一起每日打卡监督。
          </p>
          <div style="display:flex;justify-content:center;gap:10px;">
            <button class="btn-secondary" data-action="open-join-group">输入邀请码</button>
            <button class="btn-primary" data-action="open-create-group">创建第一个小组</button>
          </div>
        </section>
      `}
    `;
  }

  function buildExamsView() {
    const { exams } = state.data;
    return `
      <div class="page-header">
        <div>
          <div class="page-date">距离目标 · 精准追踪</div>
          <h1 class="page-title">目标倒计时</h1>
        </div>
        <button class="btn-primary btn-sm" data-action="open-add-exam">+ 新目标</button>
      </div>

      <section>
        ${exams.length ? exams.map((e) => `
          <article class="card exam-card">
            <div class="exam-left">
              <div class="exam-tag-row">
                <span class="exam-dot" style="background:${e.color || 'var(--accent)'}"></span>
                <span>${esc(e.tag)}</span>
                ${e.pinned ? '<span class="exam-pin-label">· 首页与锁屏置顶</span>' : ''}
              </div>
              <div class="exam-name">${esc(e.name)}</div>
              <div class="exam-date-sub tabular">目标日 ${esc(e.targetDate)} · 进度 ${e.progress}%</div>
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
            <button class="choice-chip" data-action="quick-preset-exam" data-idx="${idx}">
              + ${esc(p.name)}
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  function buildDesktopView() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const baseUrl = window.location.origin + window.location.pathname;
    const shortcutUrl = state.mode === 'server'
      ? `${window.location.origin}/api/wallpaper.svg?userId=${encodeURIComponent(state.userId)}&theme=${state.theme}`
      : baseUrl;

    return `
      <div class="page-header">
        <div>
          <div class="page-date">iPhone 专属体验</div>
          <h1 class="page-title">桌面与倒计时</h1>
        </div>
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
  // Modals / Bottom Sheets (Account Memory, Categories, Tasks, Exams, Groups)
  // =========================================================================

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
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>

      <!-- Current Account Status Card -->
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

      <!-- Cross-Device Sync & Backup Section -->
      <div class="field-label" style="margin-bottom:8px;">跨设备无缝同步 / 换机数据迁移</div>
      <div class="card card-padded" style="margin-bottom:14px;background:var(--bg-surface);">
        <p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px;line-height:1.55;">
          ${cloudReady
            ? '您的统一账户已连接云端数据库，在新手机直接登录账号 @' + esc(user.account) + ' 即可自动恢复全部数据；下方也可随时导出本地加密备份。'
            : '换新手机或换浏览器时，点击下方生成「加密换机迁移链接」发给自己，在新设备点开并验证原密码即可 100% 恢复全部大标题、时间轴与倒计时。'}
        </p>
        <button type="button" class="btn-primary btn-block" id="btn-copy-restore-link">复制加密换机迁移链接</button>
        <div class="btn-row" style="margin-top:10px;">
          <button type="button" class="btn-secondary" id="btn-export-backup">导出备份文件</button>
          <button type="button" class="btn-secondary" data-action="trigger-import-backup">导入恢复备份</button>
        </div>
      </div>

      <!-- Switch Other Local Accounts -->
      ${users.length > 1 ? `
        <div class="field-label" style="margin-bottom:8px;">快速切换本机已记忆账户</div>
        <div style="margin-bottom:14px;">
          ${users.filter((u) => u.id !== user.id).map((u) => `
            <button class="account-row" data-switch-user="${u.id}" data-switch-acc="${esc(u.account)}">
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
      const base = window.location.origin + window.location.pathname;
      const url = `${base}?restore=${encodeURIComponent(encoded)}`;
      await copyText(url, '已复制换机迁移链接，在新设备打开输入密码即可恢复');
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
    const cats = state.data.categories || [];
    let pickedColor = SYSTEM_COLORS[cats.length % SYSTEM_COLORS.length];

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">自定义任务大标题</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
        自由命名你的学习模块大标题（如：专业课、数据结构、民法总论、雅思精听），任务将自动归类到对应大标题下。
      </p>

      <form id="form-new-category" style="margin-bottom:16px;">
        <div class="field">
          <label class="field-label" for="input-new-cat-name">新建大标题名称</label>
          <input id="input-new-cat-name" class="input" type="text" required maxlength="18" placeholder="例如：专业课 · 计算机组成原理" autofocus />
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
              <button type="button" class="task-delete-btn" data-del-cat="${c.id}" aria-label="删除大标题">×</button>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-box" style="padding:16px 8px;font-size:12px;">
          还没有自定义大标题，在上方输入名称即可创建。
        </div>
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

  function openAddTaskSheet(prefillCategory = '') {
    const cats = (state.data && state.data.categories) || [];
    const initialCat = prefillCategory || (cats[0] ? cats[0].name : '');

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">新建学习任务</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <form id="form-add-task">
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
          <label class="field-label" for="input-task-title">具体任务内容</label>
          <input id="input-task-title" class="input" type="text" required maxlength="60" placeholder="例如：刷完第三章真题并整理错题" autofocus />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="field">
            <label class="field-label" for="input-task-date">安排日期</label>
            <input id="input-task-date" class="input tabular" type="date" required value="${state.selectedDate}" />
          </div>
          <div class="field">
            <label class="field-label" for="input-task-duration">预计时长（分）</label>
            <input id="input-task-duration" class="input tabular" type="number" min="5" max="360" value="45" />
          </div>
        </div>

        <div class="field">
          <div class="switch-row">
            <div>
              <div style="font-size:14px;font-weight:600;">每日自动重复</div>
              <div style="font-size:12px;color:var(--text-secondary);">从该日期起每天自动出现在时间轴中</div>
            </div>
            <button type="button" id="switch-repeat" class="ios-switch" role="switch" aria-checked="false"></button>
          </div>
        </div>
        <button type="submit" class="btn-primary btn-block" style="margin-top:8px;">添加到任务序列</button>
      </form>
    `);

    let repeatDaily = false;
    const catInput = document.getElementById('input-task-category');

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

    document.getElementById('form-add-task').addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = catInput.value.trim() || '未分组';
      const title = document.getElementById('input-task-title').value.trim();
      const date = document.getElementById('input-task-date').value || state.selectedDate;
      const durationMin = Number(document.getElementById('input-task-duration').value) || 30;
      if (!title) return;
      closeSheet();
      try {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, category, title, date, durationMin, repeatDaily })
        });
        state.selectedDate = date;
        state.viewMonth = currentMonthKey(date);
        await loadBootstrap(true);
        showHud(`已添加到「${category}」`);
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function openAddExamSheet() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">设定考试 / 目标倒计时</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <form id="form-add-exam">
        <div class="field">
          <label class="field-label" for="input-exam-name">考试或目标名称</label>
          <input id="input-exam-name" class="input" type="text" required maxlength="30" placeholder="例如：2027 全国考研初试" autofocus />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-date">目标日期</label>
          <input id="input-exam-date" class="input tabular" type="date" required value="${addDaysStr(60)}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-tag">阶段标签</label>
          <input id="input-exam-tag" class="input" type="text" maxlength="12" value="核心目标" />
        </div>
        <button type="submit" class="btn-primary btn-block">保存并置顶显示</button>
      </form>
    `);

    document.getElementById('form-add-exam').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('input-exam-name').value.trim();
      const targetDate = document.getElementById('input-exam-date').value;
      const tag = document.getElementById('input-exam-tag').value.trim() || '核心目标';
      if (!name || !targetDate) return;
      closeSheet();
      try {
        await api('/api/exams', { method: 'POST', body: JSON.stringify({ userId: state.userId, name, targetDate, tag, pinned: true }) });
        await loadBootstrap(true);
        showHud('目标倒计时已置顶');
      } catch (err) { showHud(err.message, 'var(--red)'); }
    });
  }

  function openCreateGroupSheet() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">创建学习小组</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <form id="form-create-group">
        <div class="field">
          <label class="field-label" for="input-group-name">小组名称</label>
          <input id="input-group-name" class="input" type="text" required maxlength="24" placeholder="例如：考研每日打卡小组" autofocus />
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
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
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
          <input id="input-join-code" class="input tabular" style="text-transform:uppercase;letter-spacing:0.12em;font-weight:700;" type="text" required maxlength="8" placeholder="输入 6 位邀请码" value="${esc(prefillCode)}" autofocus />
        </div>
        <button type="submit" class="btn-primary btn-block">立即加入小组</button>
      </form>
    `);

    document.getElementById('form-join-group').addEventListener('submit', async (e) => {
      e.preventDefault();
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

  function openFocusSheet() {
    if (!state.data || !state.data.user) return;
    const f = state.focus;
    const totalSec = f.presetMin * 60;
    const pct = Math.round(((totalSec - f.remainingSec) / totalSec) * 100);

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">沉浸专注计时</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <div class="focus-dial-wrap">
        <div class="ring-box" style="margin:6px 0 14px;">
          ${ringSVG(pct, 196, 9, 'var(--accent)')}
          <div class="ring-center" style="flex-direction:column;gap:4px;">
            <span id="focus-sheet-clock" class="focus-time-big">${formatTimer(f.remainingSec)}</span>
            <span style="font-size:12px;color:var(--text-secondary);font-weight:500;">${esc(f.label)}</span>
          </div>
        </div>
        <div class="chip-row" style="justify-content:center;margin-bottom:18px;">
          ${[25, 45, 60].map((m) => `
            <button type="button" class="choice-chip ${f.presetMin === m ? 'is-selected' : ''}" data-focus-preset="${m}">${m} 分钟</button>
          `).join('')}
        </div>
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
        openFocusSheet();
      });
    });

    document.getElementById('focus-toggle-btn').addEventListener('click', () => {
      if (f.running) stopFocusInterval();
      else startFocusInterval();
      openFocusSheet();
    });

    document.getElementById('focus-finish-btn').addEventListener('click', async () => {
      const elapsedMin = Math.max(1, Math.round((f.presetMin * 60 - f.remainingSec) / 60) || f.presetMin);
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
    if (state.focus.running) return;
    state.focus.running = true;
    state.focus.timerId = setInterval(async () => {
      if (state.focus.remainingSec > 0) {
        state.focus.remainingSec--;
        const clock = document.getElementById('focus-sheet-clock');
        if (clock) clock.textContent = formatTimer(state.focus.remainingSec);
      } else {
        stopFocusInterval();
        const mins = state.focus.presetMin;
        state.focus.remainingSec = mins * 60;
        await api('/api/focus/complete', { method: 'POST', body: JSON.stringify({ userId: state.userId, minutes: mins, label: state.focus.label }) }).catch(() => {});
        await loadBootstrap(true);
        showHud(`专注 ${mins} 分钟完成`);
      }
    }, 1000);
  }

  function stopFocusInterval() {
    state.focus.running = false;
    if (state.focus.timerId) { clearInterval(state.focus.timerId); state.focus.timerId = null; }
  }

  // =========================================================================
  // 1170x2532 iPhone Lock Screen PNG Generator
  // =========================================================================

  function renderLockscreenCanvasDataUrl() {
    if (!state.data || !state.data.user) return '';
    const canvas = document.getElementById('wallpaper-canvas');
    const ctx = canvas.getContext('2d');
    const W = 1170;
    const H = 2532;
    const isDark = state.theme === 'dark';
    const today = todayKey();
    const pinned = state.data.exams[0] || { name: '尚未设定目标倒计时', tag: '时序', daysLeft: 0, progress: 0, targetDate: today };
    const todayStats = getDayStats(state.data.tasks, today);
    const tasks = todayStats.list.slice(0, 3);
    const grp = state.data.groups[0];

    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    if (isDark) { bgGrad.addColorStop(0, '#070C18'); bgGrad.addColorStop(1, '#000000'); }
    else { bgGrad.addColorStop(0, '#E8F0FC'); bgGrad.addColorStop(1, '#F5F5F7'); }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const accent = isDark ? '#0A84FF' : '#0071E3';
    const rad = ctx.createRadialGradient(320, 960, 40, 320, 960, 680);
    rad.addColorStop(0, isDark ? 'rgba(10,132,255,0.22)' : 'rgba(0,113,227,0.14)');
    rad.addColorStop(1, 'rgba(0,113,227,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W, H);

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    roundRect(96, 1030, 978, 900, 68);
    ctx.fillStyle = isDark ? 'rgba(28,28,30,0.88)' : 'rgba(255,255,255,0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
    ctx.stroke();

    const fg = isDark ? '#F5F5F7' : '#1D1D1F';
    const muted = isDark ? '#98989D' : '#6E6E73';
    const sep = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)';
    const fontFamily = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';

    ctx.fillStyle = accent;
    ctx.font = `600 32px ${fontFamily}`;
    ctx.fillText(`${pinned.tag} · ${pinned.targetDate}`, 156, 1125);

    ctx.fillStyle = fg;
    ctx.font = `700 48px ${fontFamily}`;
    ctx.fillText(pinned.name, 156, 1192);

    ctx.font = `700 144px ${fontFamily}`;
    const daysText = String(pinned.daysLeft);
    ctx.fillText(daysText, 156, 1352);
    const daysWidth = ctx.measureText(daysText).width;
    ctx.fillStyle = muted;
    ctx.font = `500 44px ${fontFamily}`;
    ctx.fillText('天', 156 + daysWidth + 14, 1348);

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
      ctx.fillText('前往「今日」添加你的学习任务清单', 156, 1550);
    }

    ctx.fillStyle = sep;
    ctx.fillRect(156, 1812, 858, 2);

    ctx.fillStyle = muted;
    ctx.font = `500 31px ${fontFamily}`;
    ctx.fillText(grp ? `${grp.name} · 今日 ${grp.teamPct}%` : `${state.data.user.name} · 时序`, 156, 1878);

    ctx.fillStyle = accent;
    ctx.font = `600 31px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`今日 ${todayStats.done}/${todayStats.total}`, 1014, 1878);
    ctx.textAlign = 'left';

    return canvas.toDataURL('image/png');
  }

  function downloadLockscreenPNG() {
    const pinned = (state.data && state.data.exams[0]) || { daysLeft: 0 };
    const url = renderLockscreenCanvasDataUrl();
    if (!url) return;
    const link = document.createElement('a');
    link.download = `时序倒计时壁纸-${pinned.daysLeft}天.png`;
    link.href = url;
    link.click();
    showHud('高清锁屏倒计时壁纸已保存');
  }

  // Backup file import handler
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
      if (!state.data || !state.data.user) {
        showHud('请先登录或注册统一账户', 'var(--accent)');
        return;
      }
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
  document.getElementById('nav-focus-btn').addEventListener('click', openFocusSheet);
  document.getElementById('nav-theme-btn').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    if (state.activeTab === 'desktop' && state.data && state.data.user) renderView(false);
  });

  fabAdd.addEventListener('click', () => {
    if (!state.data || !state.data.user) return;
    if (state.activeTab === 'exams') openAddExamSheet();
    else openAddTaskSheet();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'close-sheet') return closeSheet();
    if (action === 'open-add-task') return openAddTaskSheet();
    if (action === 'open-add-task-in-cat') return openAddTaskSheet(btn.dataset.category || '');
    if (action === 'open-manage-categories') return openManageCategoriesSheet();
    if (action === 'open-add-exam') return openAddExamSheet();
    if (action === 'open-create-group') return openCreateGroupSheet();
    if (action === 'open-join-group') return openJoinGroupSheet();
    if (action === 'open-focus') return openFocusSheet();
    if (action === 'trigger-import-backup') { importBackupInput.click(); return; }

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
      const id = btn.dataset.id;
      const task = state.data.tasks.find((t) => t.id === id);
      if (!task) return;
      const dateStr = state.selectedDate;
      const nextDone = !isTaskDoneOnDate(task, dateStr);
      if (!Array.isArray(task.completedDates)) task.completedDates = [];
      if (nextDone) task.completedDates.push(dateStr);
      else task.completedDates = task.completedDates.filter((d) => d !== dateStr);
      renderView(false);
      try {
        await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: nextDone, date: dateStr }) });
        await loadBootstrap(true);
        if (nextDone) showHud(dateStr === todayKey() ? '今日打卡完成' : `已标记 ${formatDateCN(dateStr)} 完成`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
        await loadBootstrap(true);
      }
      return;
    }

    if (action === 'delete-task') {
      try {
        await api(`/api/tasks/${btn.dataset.id}`, { method: 'DELETE' });
        await loadBootstrap(true);
        showHud('已删除任务', 'var(--text-tertiary)');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'pin-exam') {
      try {
        await api(`/api/exams/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) });
        await loadBootstrap(true);
        showHud('已置顶至首页与锁屏倒计时');
      } catch (err) { showHud(err.message, 'var(--red)'); }
      return;
    }

    if (action === 'delete-exam') {
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
        showHud(kind === 'cheer' ? `已鼓励 ${btn.dataset.name}` : `已拍一拍提醒 ${btn.dataset.name}`, 'var(--accent)');
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

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
