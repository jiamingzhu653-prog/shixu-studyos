(() => {
  'use strict';

  const STORE_KEY = 'shixu_raw_store_v3';
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

  function todayKey() {
    const now = new Date();
    return formatDateISO(now);
  }

  function formatDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseDateISO(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function shiftDateISO(baseStr, deltaDays) {
    const d = parseDateISO(baseStr);
    d.setDate(d.getDate() + deltaDays);
    return formatDateISO(d);
  }

  function addDaysStr(days) {
    return shiftDateISO(todayKey(), days);
  }

  function currentMonthKey(dateStr = todayKey()) {
    return dateStr.slice(0, 7); // YYYY-MM
  }

  function shiftMonthKey(ym, deltaMonths) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + deltaMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  const state = {
    mode: 'auto', // 'server' | 'local'
    userId: localStorage.getItem('shixu_raw_user_id') || '',
    theme: localStorage.getItem('shixu_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    activeTab: 'today',
    selectedDate: todayKey(),
    viewMonth: currentMonthKey(),
    showMonthCalendar: false,
    activeGroupId: null,
    pendingInvite: null,
    data: null,
    scriptableCode: '',
    focus: {
      presetMin: 25,
      remainingSec: 25 * 60,
      running: false,
      label: '专注学习',
      timerId: null
    }
  };

  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('shixu_raw_realtime_v3') : null;

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

  // Utilities
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
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function genId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

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

  function encodeShareGroup(g) {
    try {
      const json = JSON.stringify({
        name: g.name,
        inviteCode: g.inviteCode,
        examName: g.examName,
        targetDate: g.targetDate,
        notice: g.notice
      });
      return btoa(unescape(encodeURIComponent(json)));
    } catch {
      return '';
    }
  }

  function decodeShareGroup(str) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(str))));
    } catch {
      return null;
    }
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
    hudTimer = setTimeout(() => hudPill.classList.remove('is-visible'), 2400);
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
  // Pure Raw Clean Local Engine (Zero pre-filled fake data)
  // =========================================================================

  function createEmptyLocalStore() {
    return {
      lastRolloverDate: todayKey(),
      users: [],
      categories: [],
      exams: [],
      tasks: [],
      groups: [],
      feeds: []
    };
  }

  function getLocalStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
    if (!s || !Array.isArray(s.users)) {
      s = createEmptyLocalStore();
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    }
    if (!Array.isArray(s.categories)) s.categories = [];
    const today = todayKey();
    if (s.lastRolloverDate !== today) {
      for (const u of s.users) u.focusMinutesToday = 0;
      s.lastRolloverDate = today;
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    }
    return s;
  }

  function saveLocalStore(s, toastMsg) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    if (bc) bc.postMessage({ type: 'sync', toastMsg, fromUserId: state.userId });
  }

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
    const user = s.users.find((u) => u.id === userId) || s.users[0] || null;
    const today = todayKey();
    if (!user) {
      return { today, user: null, users: [], categories: [], tasks: [], exams: [], groups: [] };
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
            return { ...u, done: st.done, total: st.total, pct: st.pct };
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

    return {
      today,
      user,
      users: s.users.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color, streak: u.streak })),
      categories,
      tasks,
      exams,
      groups
    };
  }

  function localApi(path, method = 'GET', body = {}) {
    const s = getLocalStore();
    const today = todayKey();

    if (method === 'POST' && path === '/api/reset') {
      saveLocalStore(createEmptyLocalStore());
      return { ok: true };
    }

    if (method === 'POST' && path === '/api/users') {
      const name = String(body.name || '').trim().slice(0, 16);
      if (!name) throw new Error('请输入昵称');
      const user = {
        id: genId('u'),
        name,
        avatar: name.slice(0, 1),
        color: SYSTEM_COLORS[s.users.length % SYSTEM_COLORS.length],
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

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (state.mode === 'local') return localApi(path, method, body);
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
      state.mode = 'local';
    }

    if (state.mode === 'server') {
      try {
        const data = await api(`/api/bootstrap?userId=${encodeURIComponent(state.userId)}`);
        applyBootstrapData(data, !silent);
      } catch (err) {
        if (!silent) showHud(err.message || '连接服务失败', 'var(--red)');
      }
    } else {
      applyBootstrapData(buildLocalBootstrap(state.userId), !silent);
    }
  }

  function applyBootstrapData(data, animate) {
    state.data = data;
    if (data.user) {
      state.userId = data.user.id;
      localStorage.setItem('shixu_raw_user_id', state.userId);
    } else {
      state.userId = '';
      localStorage.removeItem('shixu_raw_user_id');
    }
    if (!state.activeGroupId || !data.groups.some((g) => g.id === state.activeGroupId)) {
      state.activeGroupId = data.groups[0] ? data.groups[0].id : null;
    }
    syncHeader();
    renderView(animate);
  }

  async function loadScriptableSnippet() {
    if (state.mode === 'server') {
      try {
        const res = await fetch(`./api/widget/scriptable?userId=${encodeURIComponent(state.userId)}`);
        if (res.ok) {
          state.scriptableCode = await res.text();
          return;
        }
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
      navUsername.textContent = '开始使用';
    }
    compactTitle.textContent = u
      ? (state.activeTab === 'today' ? getRelativeDayTitle(state.selectedDate) : (TAB_TITLES[state.activeTab] || '时序'))
      : '时序';
    const showFab = Boolean(u) && (state.activeTab === 'today' || state.activeTab === 'exams');
    fabAdd.classList.toggle('is-hidden', !showFab);
  }

  // =========================================================================
  // Timeline & Monthly Progress Calendar Builder
  // =========================================================================

  function buildTimelineSection(tasks) {
    const today = todayKey();
    const yesterday = shiftDateISO(today, -1);
    const tomorrow = shiftDateISO(today, 1);
    const sel = state.selectedDate;

    // 7-day strip centered around selected date (-3..+3)
    const railDates = [];
    for (let i = -3; i <= 3; i++) railDates.push(shiftDateISO(sel, i));

    let monthHtml = '';
    if (state.showMonthCalendar) {
      const [y, m] = state.viewMonth.split('-').map(Number);
      const firstDay = new Date(y, m - 1, 1);
      const daysInMonth = new Date(y, m, 0).getDate();
      // Monday-first offset (0=Mon .. 6=Sun)
      const startOffset = (firstDay.getDay() + 6) % 7;

      let monthDoneCount = 0;
      let monthPerfectDays = 0;
      let monthScheduledDays = 0;
      let monthPctSum = 0;

      const cells = [];
      for (let pad = 0; pad < startOffset; pad++) {
        cells.push('<div></div>');
      }
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
      viewContainer.innerHTML = buildWelcomeOnboardingView();
      const form = document.getElementById('form-welcome-start');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = document.getElementById('input-welcome-name').value.trim();
          if (!name) return;
          try {
            const payload = { name };
            if (state.pendingInvite) {
              payload.joinCode = state.pendingInvite.code;
              payload.sharedGroup = state.pendingInvite.sharedGroup;
            }
            const res = await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
            state.userId = res.user.id;
            localStorage.setItem('shixu_raw_user_id', state.userId);
            const joined = Boolean(state.pendingInvite);
            state.pendingInvite = null;
            if (joined) {
              state.activeTab = 'groups';
              syncTabButtons();
            }
            await loadBootstrap(false);
            showHud(`欢迎，${res.user.name}`);
          } catch (err) {
            showHud(err.message, 'var(--red)');
          }
        });
      }
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

  function buildWelcomeOnboardingView() {
    const invite = state.pendingInvite;
    return `
      <div style="padding:26px 4px 12px;text-align:center;">
        <img src="./icons/apple-touch-icon.png" alt="时序图标" style="width:76px;height:76px;border-radius:18px;box-shadow:0 12px 28px rgba(0,113,227,0.26);margin-bottom:18px;" />
        <h1 class="page-title" style="font-size:30px;">欢迎使用「时序」</h1>
        <p style="font-size:14px;line-height:1.6;color:var(--text-secondary);margin:10px auto 24px;max-width:300px;">
          自定义任务大标题、按日与按月追踪学习时间轴、设定考试倒计时并组建学习小组。
        </p>

        ${invite && invite.sharedGroup ? `
          <div class="card card-padded" style="text-align:left;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:600;color:var(--accent);">收到学习小组邀请</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;">${esc(invite.sharedGroup.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">共同目标：${esc(invite.sharedGroup.examName)} · ${esc(invite.sharedGroup.targetDate)}</div>
          </div>
        ` : ''}

        <div class="card card-padded" style="text-align:left;">
          <form id="form-welcome-start">
            <div class="field">
              <label class="field-label" for="input-welcome-name">输入你的昵称，立即开始</label>
              <input id="input-welcome-name" class="input" type="text" required maxlength="16" placeholder="例如：小陈 / Alex" autofocus />
            </div>
            <button type="submit" class="btn-primary btn-block">${invite ? '创建昵称并加入小组' : '进入我的学习台'}</button>
          </form>
        </div>

        <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
          <div class="card" style="padding:12px 8px;">
            <div style="font-size:13px;font-weight:600;">自定义大标题</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">按科目自由命名</div>
          </div>
          <div class="card" style="padding:12px 8px;">
            <div style="font-size:13px;font-weight:600;">月度时间轴</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">昨今明与月进程</div>
          </div>
          <div class="card" style="padding:12px 8px;">
            <div style="font-size:13px;font-weight:600;">学习小组</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">多人打卡互督</div>
          </div>
        </div>
      </div>
    `;
  }

  function buildTodayView() {
    const { user, tasks, categories, exams, groups } = state.data;
    const sel = state.selectedDate;
    const pinned = exams[0];
    const dayStats = getDayStats(tasks, sel);
    const primaryGroup = groups[0];

    // Group selected date's tasks under Custom Big Titles (categories)
    const colorMap = new Map();
    for (const c of categories) colorMap.set(c.name, c.color);

    const groupMap = new Map();
    // Preserve custom category order for categories that have tasks on this day
    for (const c of categories) {
      const catTasks = dayStats.list.filter((t) => t.category === c.name);
      if (catTasks.length) groupMap.set(c.name, catTasks);
    }
    // Include any tasks whose category isn't in categories list (e.g. '未分组')
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

      <!-- Task Sequence Timeline: Yesterday / Today / Tomorrow + Full Month Calendar -->
      ${buildTimelineSection(tasks)}

      <!-- Day Completion & Focus Strip -->
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

      <!-- Custom Category Big-Title Section Header -->
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
          <div class="member-hint">点击左上角头像可新建其他成员账号输入邀请码加入，测试多人互相催学</div>
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
  // Modals / Bottom Sheets (Including Custom Big-Title Management!)
  // =========================================================================

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
        await api('/api/categories', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, name, color: pickedColor })
        });
        await loadBootstrap(true);
        openManageCategoriesSheet();
        showHud(`已创建大标题「${name}」`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
    });

    sheetContent.querySelectorAll('[data-save-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.saveCat;
        const input = sheetContent.querySelector(`[data-cat-input="${id}"]`);
        const nextName = input ? input.value.trim() : '';
        if (!nextName) return;
        try {
          await api(`/api/categories/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: nextName })
          });
          await loadBootstrap(true);
          openManageCategoriesSheet();
          showHud(`已重命名为「${nextName}」`);
        } catch (err) {
          showHud(err.message, 'var(--red)');
        }
      });
    });

    sheetContent.querySelectorAll('[data-del-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delCat;
        try {
          await api(`/api/categories/${id}`, { method: 'DELETE' });
          await loadBootstrap(true);
          openManageCategoriesSheet();
          showHud('已移除大标题');
        } catch (err) {
          showHud(err.message, 'var(--red)');
        }
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
                <button type="button" class="choice-chip ${c.name === initialCat ? 'is-selected' : ''}" data-pick-cat="${esc(c.name)}">
                  ${esc(c.name)}
                </button>
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
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
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
        await api('/api/exams', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, name, targetDate, tag, pinned: true })
        });
        await loadBootstrap(true);
        showHud('目标倒计时已置顶');
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
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
        const res = await api('/api/groups', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, name, examName, targetDate, notice })
        });
        state.activeGroupId = res.group.id;
        await loadBootstrap(true);
        showHud(`小组已创建，邀请码 ${res.group.inviteCode}`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
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
        const res = await api('/api/groups/join', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, inviteCode, sharedGroup })
        });
        state.activeGroupId = res.group.id;
        state.activeTab = 'groups';
        syncTabButtons();
        await loadBootstrap(true);
        showHud(`已加入「${res.group.name}」`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
    });
  }

  function openAccountSheet() {
    if (!state.data || !state.data.user) return;
    const { users, user } = state.data;
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">账号管理与重置</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
        可新建多个成员账号并切换，亲自测试“创建小组 → 输入邀请码加入 → 多人互相打卡与催学”完整流程。
      </p>
      <div>
        ${users.map((u) => `
          <button class="account-row" data-switch-user="${u.id}">
            <div class="account-left">
              <span class="avatar-dot" style="width:32px;height:32px;font-size:13px;background:${u.color}">${esc(u.avatar)}</span>
              <div style="text-align:left;">
                <div style="font-size:14px;font-weight:600;">${esc(u.name)}</div>
                <div style="font-size:11px;color:var(--text-secondary);">已坚持 ${u.streak} 天</div>
              </div>
            </div>
            ${u.id === user.id ? '<span class="account-check">当前账号</span>' : '<span style="font-size:12px;color:var(--text-tertiary);">切换</span>'}
          </button>
        `).join('')}
      </div>

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-separator);">
        <form id="form-new-user">
          <div class="field">
            <label class="field-label" for="input-new-username">新增一个空白成员账号</label>
            <div style="display:flex;gap:8px;">
              <input id="input-new-username" class="input" type="text" required maxlength="16" placeholder="输入新成员昵称" />
              <button type="submit" class="btn-primary" style="flex-shrink:0;">新建</button>
            </div>
          </div>
        </form>
      </div>

      <div style="margin-top:12px;padding-top:14px;border-top:1px solid var(--border-separator);">
        <button id="btn-reset-all" class="btn-secondary btn-block" style="color:var(--red);">
          清空全部数据 · 恢复全新初始状态
        </button>
      </div>
    `);

    sheetContent.querySelectorAll('[data-switch-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.userId = btn.dataset.switchUser;
        state.scriptableCode = '';
        localStorage.setItem('shixu_raw_user_id', state.userId);
        closeSheet();
        await loadBootstrap(false);
        showHud(`已切换为 ${state.data.user.name}`);
      });
    });

    document.getElementById('form-new-user').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('input-new-username').value.trim();
      if (!name) return;
      closeSheet();
      try {
        const res = await api('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
        state.userId = res.user.id;
        state.scriptableCode = '';
        localStorage.setItem('shixu_raw_user_id', state.userId);
        await loadBootstrap(false);
        showHud(`已创建并切换为 ${res.user.name}`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
    });

    document.getElementById('btn-reset-all').addEventListener('click', async () => {
      closeSheet();
      try {
        await api('/api/reset', { method: 'POST', body: JSON.stringify({}) });
        state.userId = '';
        state.activeGroupId = null;
        state.activeTab = 'today';
        state.selectedDate = todayKey();
        state.viewMonth = currentMonthKey();
        state.showMonthCalendar = false;
        syncTabButtons();
        localStorage.removeItem('shixu_raw_user_id');
        await loadBootstrap(false);
        showHud('已恢复为全新初始空白状态');
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
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
        await api('/api/focus/complete', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, minutes: elapsedMin, label: f.label })
        });
        await loadBootstrap(true);
        showHud(`已记录 ${elapsedMin} 分钟专注时长`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
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
        await api('/api/focus/complete', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, minutes: mins, label: state.focus.label })
        }).catch(() => {});
        await loadBootstrap(true);
        showHud(`专注 ${mins} 分钟完成`);
      }
    }, 1000);
  }

  function stopFocusInterval() {
    state.focus.running = false;
    if (state.focus.timerId) {
      clearInterval(state.focus.timerId);
      state.focus.timerId = null;
    }
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
    if (isDark) {
      bgGrad.addColorStop(0, '#070C18');
      bgGrad.addColorStop(1, '#000000');
    } else {
      bgGrad.addColorStop(0, '#E8F0FC');
      bgGrad.addColorStop(1, '#F5F5F7');
    }
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
        if (done) {
          ctx.fillStyle = accent;
          ctx.fill();
        } else {
          ctx.strokeStyle = muted;
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
        ctx.fillStyle = done ? muted : fg;
        ctx.font = `500 35px ${fontFamily}`;
        const fullLabel = `${t.category} · ${t.title}`;
        const label = fullLabel.length > 18 ? `${fullLabel.slice(0, 18)}…` : fullLabel;
        ctx.fillText(label, 218, y);
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
        showHud('请先输入昵称开始使用', 'var(--accent)');
        return;
      }
      const next = btn.dataset.tab;
      if (next === state.activeTab) {
        mainScroll.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
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

    if (action === 'pick-date') {
      const ds = btn.dataset.date;
      if (ds) {
        state.selectedDate = ds;
        state.viewMonth = currentMonthKey(ds);
        renderView(false);
      }
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
      state.activeTab = 'groups';
      syncTabButtons();
      mainScroll.scrollTop = 0;
      renderView(true);
      return;
    }

    if (action === 'goto-exams') {
      state.activeTab = 'exams';
      syncTabButtons();
      mainScroll.scrollTop = 0;
      renderView(true);
      return;
    }

    if (action === 'select-group') {
      state.activeGroupId = btn.dataset.id;
      renderView(false);
      return;
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
        await api(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: nextDone, date: dateStr })
        });
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
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'pin-exam') {
      try {
        await api(`/api/exams/${btn.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned: true })
        });
        await loadBootstrap(true);
        showHud('已置顶至首页与锁屏倒计时');
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'delete-exam') {
      try {
        await api(`/api/exams/${btn.dataset.id}`, { method: 'DELETE' });
        await loadBootstrap(true);
        showHud('已移除目标');
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'quick-preset-exam') {
      const preset = EXAM_PRESETS[Number(btn.dataset.idx)];
      if (!preset) return;
      try {
        await api('/api/exams', {
          method: 'POST',
          body: JSON.stringify({
            userId: state.userId,
            name: preset.name,
            tag: preset.tag,
            targetDate: addDaysStr(preset.days),
            color: preset.color,
            pinned: true
          })
        });
        await loadBootstrap(true);
        showHud(`已添加并置顶「${preset.name}」`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'copy-invite') {
      const grp = state.data.groups.find((g) => g.id === btn.dataset.groupId);
      if (!grp) return;
      const base = window.location.origin + window.location.pathname;
      const encoded = encodeShareGroup(grp);
      const inviteUrl = `${base}?join=${encodeURIComponent(grp.inviteCode)}${encoded ? `&g=${encodeURIComponent(encoded)}` : ''}`;
      await copyText(`我在「时序」创建了学习小组【${grp.name}】，点击链接一起倒计时打卡（邀请码 ${grp.inviteCode}）：${inviteUrl}`, '已复制微信邀请链接');
      return;
    }

    if (action === 'tap-member') {
      const targetUserId = btn.dataset.user;
      if (targetUserId === state.userId) {
        showHud('这是你自己的今日学习进度');
        return;
      }
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
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'like-feed') {
      try {
        await api(`/api/feeds/${btn.dataset.id}/like`, {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId })
        });
        await loadBootstrap(true);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
      return;
    }

    if (action === 'download-wallpaper-png') {
      downloadLockscreenPNG();
      return;
    }

    if (action === 'copy-wallpaper-url') {
      await copyText(btn.dataset.url, '已复制链接');
      return;
    }

    if (action === 'copy-scriptable') {
      await loadScriptableSnippet();
      await copyText(state.scriptableCode, '已复制 Scriptable 小组件代码');
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
      es.onerror = () => {
        es.close();
        setTimeout(setupRealtime, 5000);
      };
    } else if (bc) {
      bc.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'sync') {
          loadBootstrap(true);
          if (ev.data.toastMsg && ev.data.fromUserId !== state.userId) {
            showHud(ev.data.toastMsg, 'var(--accent)');
          }
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

  function parseInviteLink() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    const sharedParam = params.get('g');
    if (joinCode) {
      const sharedGroup = sharedParam ? decodeShareGroup(sharedParam) : null;
      window.history.replaceState({}, '', window.location.pathname);
      state.pendingInvite = { code: joinCode.toUpperCase(), sharedGroup };
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  applyTheme(state.theme);
  checkWeChatBrowser();
  parseInviteLink();
  loadBootstrap(false).then(() => {
    setupRealtime();
    if (state.data && state.data.user && state.pendingInvite) {
      const inv = state.pendingInvite;
      state.pendingInvite = null;
      setTimeout(() => openJoinGroupSheet(inv.code, inv.sharedGroup), 350);
    }
  });
})();
