(() => {
  'use strict';

  const STORE_KEY = 'shixu_local_store_v1';
  const AVATAR_COLORS = ['#0071E3', '#34C759', '#FF9500', '#FF3B30', '#0A84FF', '#30B0C7'];
  const SUBJECT_PRESETS = ['数学', '英语', '政治', '专业课', '词汇', '复盘', '日常'];
  const EXAM_PRESETS = [
    { name: '2027 全国考研初试', tag: '一志愿冲刺', days: 86, color: '#0071E3' },
    { name: '国家公务员笔试', tag: '行测 + 申论', days: 52, color: '#FF9500' },
    { name: '雅思 7.5 冲刺考', tag: '听说读写', days: 34, color: '#34C759' },
    { name: 'CPA 专业阶段考试', tag: '注册会计师', days: 128, color: '#0071E3' },
    { name: '国家统一法考客观题', tag: '法考冲刺', days: 95, color: '#FF3B30' },
    { name: '全国普通高考', tag: '本科冲刺', days: 196, color: '#30B0C7' }
  ];

  const TAB_TITLES = {
    today: '今日学习',
    groups: '学习小组',
    exams: '目标倒计时',
    desktop: 'iOS 桌面与组件'
  };

  const state = {
    mode: 'auto', // 'server' | 'local'
    userId: localStorage.getItem('shixu_user_id') || 'u_chen',
    theme: localStorage.getItem('shixu_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    activeTab: 'today',
    activeGroupId: null,
    data: null,
    scriptableCode: '',
    focus: {
      presetMin: 25,
      remainingSec: 25 * 60,
      running: false,
      label: '深度专注自习',
      timerId: null
    }
  };

  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('shixu_realtime') : null;

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

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDaysStr(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysUntil(dateStr) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(target.getTime())) return 0;
    return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000));
  }

  function calcProgress(startDate, targetDate) {
    const start = new Date(`${startDate}T00:00:00`).getTime();
    const end = new Date(`${targetDate}T00:00:00`).getTime();
    const now = new Date().setHours(0, 0, 0, 0);
    if (!start || !end || end <= start) return 100;
    return Math.min(100, Math.max(4, Math.round(((now - start) / (end - start)) * 100)));
  }

  function formatDateCN() {
    const now = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
    return `${now.getMonth() + 1}月${now.getDate()}日 ${week}`;
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
    hudTimer = setTimeout(() => {
      hudPill.classList.remove('is-visible');
    }, 2400);
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
  // Zero-Cost Static Local Engine (Automatic fallback for GitHub Pages)
  // =========================================================================

  function createLocalSeed() {
    const today = todayKey();
    const now = Date.now();
    return {
      lastRolloverDate: today,
      users: [
        { id: 'u_chen', name: '陈同学', avatar: '陈', color: '#0071E3', streak: 21, focusMinutesToday: 85, createdAt: now - 86400000 * 21 },
        { id: 'u_lin', name: '林晚', avatar: '林', color: '#34C759', streak: 29, focusMinutesToday: 135, createdAt: now - 86400000 * 29 },
        { id: 'u_zhou', name: '周屿', avatar: '周', color: '#FF9500', streak: 16, focusMinutesToday: 60, createdAt: now - 86400000 * 16 },
        { id: 'u_shen', name: '沈南', avatar: '沈', color: '#30B0C7', streak: 9, focusMinutesToday: 40, createdAt: now - 86400000 * 9 }
      ],
      exams: [
        { id: 'ex_1', userId: 'u_chen', name: '2027 全国考研初试', tag: '一志愿冲刺', startDate: addDaysStr(-114), targetDate: addDaysStr(86), color: '#0071E3', pinned: true },
        { id: 'ex_2', userId: 'u_chen', name: '雅思 7.5 阶段模考', tag: '英语提分', startDate: addDaysStr(-46), targetDate: addDaysStr(34), color: '#34C759', pinned: false },
        { id: 'ex_3', userId: 'u_chen', name: '专业课一轮精读结课', tag: '阶段里程碑', startDate: addDaysStr(-30), targetDate: addDaysStr(18), color: '#FF9500', pinned: false },
        { id: 'ex_4', userId: 'u_lin', name: '2027 全国考研初试', tag: '一志愿冲刺', startDate: addDaysStr(-114), targetDate: addDaysStr(86), color: '#0071E3', pinned: true },
        { id: 'ex_5', userId: 'u_zhou', name: '2027 全国考研初试', tag: '一志愿冲刺', startDate: addDaysStr(-114), targetDate: addDaysStr(86), color: '#0071E3', pinned: true },
        { id: 'ex_6', userId: 'u_shen', name: '2027 全国考研初试', tag: '一志愿冲刺', startDate: addDaysStr(-114), targetDate: addDaysStr(86), color: '#0071E3', pinned: true }
      ],
      tasks: [
        { id: 't_1', userId: 'u_chen', title: '高数真题 2023 套卷精刷与错题归因', subject: '数学', durationMin: 90, repeatDaily: true, done: true, date: today, completedAt: now - 7200000 },
        { id: 't_2', userId: 'u_chen', title: '英语一阅读 2 篇 + 长难句精翻', subject: '英语', durationMin: 45, repeatDaily: true, done: true, date: today, completedAt: now - 3600000 },
        { id: 't_3', userId: 'u_chen', title: '政治马原高频选择题 50 道', subject: '政治', durationMin: 35, repeatDaily: true, done: false, date: today, completedAt: null },
        { id: 't_4', userId: 'u_chen', title: '专业课核心简答题默写整理', subject: '专业课', durationMin: 60, repeatDaily: false, done: false, date: today, completedAt: null },

        { id: 't_5', userId: 'u_lin', title: '高数二刷错题本整理', subject: '数学', durationMin: 75, repeatDaily: true, done: true, date: today, completedAt: now - 5400000 },
        { id: 't_6', userId: 'u_lin', title: '英语高频词汇 120 词复习', subject: '英语', durationMin: 30, repeatDaily: true, done: true, date: today, completedAt: now - 4200000 },
        { id: 't_7', userId: 'u_lin', title: '政治史纲时间轴背诵', subject: '政治', durationMin: 40, repeatDaily: true, done: true, date: today, completedAt: now - 1800000 },
        { id: 't_8', userId: 'u_lin', title: '专业课真题论述框架梳理', subject: '专业课', durationMin: 60, repeatDaily: true, done: true, date: today, completedAt: now - 600000 },

        { id: 't_9', userId: 'u_zhou', title: '肖秀荣 1000 题马原单选', subject: '政治', durationMin: 45, repeatDaily: true, done: true, date: today, completedAt: now - 3200000 },
        { id: 't_10', userId: 'u_zhou', title: '英语阅读精读 2 篇', subject: '英语', durationMin: 50, repeatDaily: true, done: true, date: today, completedAt: now - 2000000 },
        { id: 't_11', userId: 'u_zhou', title: '线代特征值专题训练', subject: '数学', durationMin: 60, repeatDaily: true, done: true, date: today, completedAt: now - 1200000 },
        { id: 't_12', userId: 'u_zhou', title: '专业课第二章笔记复盘', subject: '专业课', durationMin: 50, repeatDaily: false, done: false, date: today, completedAt: null },

        { id: 't_13', userId: 'u_shen', title: '晨起背诵英语核心词 60 个', subject: '英语', durationMin: 30, repeatDaily: true, done: true, date: today, completedAt: now - 5000000 },
        { id: 't_14', userId: 'u_shen', title: '高数中值定理讲义复习', subject: '数学', durationMin: 60, repeatDaily: true, done: false, date: today, completedAt: null },
        { id: 't_15', userId: 'u_shen', title: '专业课真题案例分析', subject: '专业课', durationMin: 55, repeatDaily: true, done: false, date: today, completedAt: null },
        { id: 't_16', userId: 'u_shen', title: '英语大作文模板默写', subject: '英语', durationMin: 35, repeatDaily: true, done: false, date: today, completedAt: null }
      ],
      groups: [
        {
          id: 'g_kaoyan',
          name: '2027 考研上岸冲刺组',
          inviteCode: 'KY2027',
          examName: '2027 全国考研初试',
          targetDate: addDaysStr(86),
          notice: '每晚 22:30 前完成今日清单打卡，互相监督不摆烂。',
          ownerId: 'u_chen',
          memberIds: ['u_chen', 'u_lin', 'u_zhou', 'u_shen'],
          createdAt: now - 86400000 * 14
        }
      ],
      feeds: [
        { id: 'f_1', groupId: 'g_kaoyan', userId: 'u_lin', type: 'checkin', text: '完成了今日全部 4 项学习任务，达成率 100%', createdAt: now - 600000, likedBy: ['u_chen', 'u_zhou', 'u_shen'] },
        { id: 'f_2', groupId: 'g_kaoyan', userId: 'u_zhou', type: 'checkin', text: '打卡「线代特征值专题训练」· 60 分钟', createdAt: now - 1200000, likedBy: ['u_lin', 'u_chen'] },
        { id: 'f_3', groupId: 'g_kaoyan', userId: 'u_chen', type: 'checkin', text: '打卡「英语一阅读 2 篇 + 长难句精翻」· 45 分钟', createdAt: now - 3600000, likedBy: ['u_lin'] }
      ]
    };
  }

  function getLocalStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
    if (!s || !Array.isArray(s.users)) {
      s = createLocalSeed();
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    }
    const today = todayKey();
    if (s.lastRolloverDate !== today) {
      s.tasks = s.tasks.filter((t) => t.repeatDaily || t.date === today);
      for (const t of s.tasks) {
        if (t.repeatDaily && t.date !== today) {
          t.done = false;
          t.date = today;
          t.completedAt = null;
        }
      }
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

  function buildLocalBootstrap(userId) {
    const s = getLocalStore();
    const user = s.users.find((u) => u.id === userId) || s.users[0];
    const today = todayKey();
    const tasks = s.tasks
      .filter((t) => t.userId === user.id && t.date === today)
      .sort((a, b) => Number(a.done) - Number(b.done));
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
            const list = s.tasks.filter((t) => t.userId === u.id && t.date === today);
            const done = list.filter((t) => t.done).length;
            const total = list.length;
            return { ...u, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
          });
        const totalTasks = members.reduce((a, m) => a + m.total, 0);
        const doneTasks = members.reduce((a, m) => a + m.done, 0);
        const feeds = s.feeds
          .filter((f) => f.groupId === g.id)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30)
          .map((f) => {
            const u = s.users.find((x) => x.id === f.userId) || { name: '同学', avatar: '学', color: '#0071E3' };
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
      tasks,
      exams,
      groups
    };
  }

  function localApi(path, method = 'GET', body = {}) {
    const s = getLocalStore();
    const today = todayKey();

    if (method === 'POST' && path === '/api/users') {
      const name = String(body.name || '').trim().slice(0, 16);
      if (!name) throw new Error('请输入昵称');
      const user = {
        id: genId('u'),
        name,
        avatar: name.slice(0, 1),
        color: AVATAR_COLORS[s.users.length % AVATAR_COLORS.length],
        streak: 1,
        focusMinutesToday: 0,
        createdAt: Date.now()
      };
      s.users.push(user);
      s.exams.push({
        id: genId('ex'),
        userId: user.id,
        name: '2027 全国考研初试',
        tag: '核心目标',
        startDate: today,
        targetDate: addDaysStr(86),
        color: '#0071E3',
        pinned: true
      });
      s.tasks.push(
        { id: genId('t'), userId: user.id, title: '制定今日核心学习任务清单', subject: '规划', durationMin: 15, repeatDaily: true, done: false, date: today, completedAt: null },
        { id: genId('t'), userId: user.id, title: '完成第一轮 45 分钟深度专注学习', subject: '专注', durationMin: 45, repeatDaily: true, done: false, date: today, completedAt: null }
      );
      if (body.joinCode) {
        const grp = s.groups.find((g) => g.inviteCode === String(body.joinCode).trim().toUpperCase());
        if (grp && !grp.memberIds.includes(user.id)) {
          grp.memberIds.push(user.id);
          s.feeds.push({ id: genId('f'), groupId: grp.id, userId: user.id, type: 'join', text: `加入了学习小组，一起冲刺「${grp.examName}」`, createdAt: Date.now(), likedBy: [] });
        }
      }
      saveLocalStore(s);
      return { user };
    }

    if (method === 'POST' && path === '/api/tasks') {
      const title = String(body.title || '').trim().slice(0, 60);
      if (!title) throw new Error('请输入任务名称');
      const task = {
        id: genId('t'),
        userId: body.userId || state.userId,
        title,
        subject: String(body.subject || '日常').trim().slice(0, 12),
        durationMin: Math.min(360, Math.max(5, Number(body.durationMin) || 30)),
        repeatDaily: Boolean(body.repeatDaily),
        done: false,
        date: today,
        completedAt: null
      };
      s.tasks.unshift(task);
      saveLocalStore(s);
      return { task };
    }

    const tMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (tMatch && method === 'PATCH') {
      const task = s.tasks.find((t) => t.id === tMatch[1]);
      if (!task) throw new Error('任务不存在');
      const prev = task.done;
      if (typeof body.done === 'boolean') {
        task.done = body.done;
        task.completedAt = body.done ? Date.now() : null;
      }
      let toastMsg = null;
      if (!prev && task.done) {
        const myList = s.tasks.filter((t) => t.userId === task.userId && t.date === today);
        const doneCnt = myList.filter((t) => t.done).length;
        const u = s.users.find((x) => x.id === task.userId);
        for (const g of s.groups.filter((gr) => gr.memberIds.includes(task.userId))) {
          const text = doneCnt === myList.length
            ? `完成了今日全部 ${myList.length} 项学习任务，达成率 100%`
            : `打卡「${task.title}」· ${task.durationMin} 分钟`;
          s.feeds.push({ id: genId('f'), groupId: g.id, userId: task.userId, type: 'checkin', text, createdAt: Date.now(), likedBy: [] });
        }
        toastMsg = `${u ? u.name : '组员'} 刚刚完成打卡：${task.title.slice(0, 14)}`;
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

    if (method === 'POST' && path === '/api/exams') {
      const uid = body.userId || state.userId;
      if (body.pinned !== false) {
        for (const e of s.exams) if (e.userId === uid) e.pinned = false;
      }
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

    if (method === 'POST' && path === '/api/focus/complete') {
      const u = s.users.find((x) => x.id === (body.userId || state.userId));
      if (u) {
        const mins = Math.min(240, Math.max(1, Number(body.minutes) || 25));
        u.focusMinutesToday = (u.focusMinutesToday || 0) + mins;
        for (const g of s.groups.filter((gr) => gr.memberIds.includes(u.id))) {
          s.feeds.push({ id: genId('f'), groupId: g.id, userId: u.id, type: 'focus', text: `完成了 ${mins} 分钟沉浸专注「${body.label || '深度专注自习'}」`, createdAt: Date.now(), likedBy: [] });
        }
      }
      saveLocalStore(s);
      return { ok: true };
    }

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
        notice: String(body.notice || '每天按计划完成打卡，稳步冲刺上岸。').trim().slice(0, 60),
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
        s.feeds.push({ id: genId('f'), groupId: grp.id, userId: uid, type: 'join', text: `通过微信邀请链接加入了「${grp.name}」`, createdAt: Date.now(), likedBy: [] });
        saveLocalStore(s);
        return { group: grp };
      }
      if (!grp) throw new Error('未找到该邀请码对应的学习小组（演示码：KY2027）');
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
      const text = kind === 'cheer'
        ? `给 ${toUser.name} 送上了鼓励，状态拉满`
        : `拍了拍 ${toUser.name}：距离考试又近一天，快去打卡`;
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
    const pinned = (state.data && state.data.exams[0]) || { name: '2027 全国考研初试', targetDate: addDaysStr(86) };
    const tasks = (state.data && state.data.tasks.slice(0, 3)) || [];
    const appUrl = window.location.origin + window.location.pathname;
    const tasksJson = JSON.stringify(tasks.map((t) => ({ title: t.title, done: t.done })));
    return `// 时序 StudyOS · iOS 桌面实时倒计时小组件 (Scriptable 零成本独立版)
// 1. App Store 免费安装 Scriptable  2. 新建脚本粘贴此代码  3. 桌面长按添加 Scriptable 中号小组件
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
const hd = right.addText("今日学习重点"); hd.font = Font.semiboldSystemFont(12); hd.textColor = fg;
right.addSpacer(6);
for (const item of TASKS) {
  const tr = right.addStack(); tr.centerAlignContent();
  const mk = tr.addText(item.done ? "● " : "○ "); mk.font = Font.systemFont(11); mk.textColor = item.done ? accent : muted;
  const tx = tr.addText(item.title); tx.font = Font.mediumSystemFont(12); tx.textColor = item.done ? muted : fg; tx.lineLimit = 1;
  right.addSpacer(4);
}
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();`;
  }

  // Unified API dispatcher (Server Mode vs Zero-Cost Local Mode)
  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (state.mode === 'local') {
      return localApi(path, method, body);
    }
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

  // Theme management
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

  // Bottom Sheet management
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

  // Data Loading (auto-detects live Node backend vs GitHub Pages static mode)
  async function loadBootstrap(silent = false) {
    if (state.mode === 'auto') {
      try {
        const res = await fetch(`./api/bootstrap?userId=${encodeURIComponent(state.userId)}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json();
          if (data && data.user) {
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
      const data = buildLocalBootstrap(state.userId);
      applyBootstrapData(data, !silent);
    }
  }

  function applyBootstrapData(data, animate) {
    state.data = data;
    state.userId = data.user.id;
    localStorage.setItem('shixu_user_id', state.userId);
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
    if (!state.data) return;
    const u = state.data.user;
    navAvatar.textContent = u.avatar;
    navAvatar.style.background = u.color || 'var(--accent)';
    navUsername.textContent = u.name;
    compactTitle.textContent = TAB_TITLES[state.activeTab] || '时序';
    fabAdd.classList.toggle('is-hidden', !(state.activeTab === 'today' || state.activeTab === 'exams'));
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

  function buildTodayView() {
    const { user, tasks, exams, groups } = state.data;
    const pinned = exams[0];
    const doneCount = tasks.filter((t) => t.done).length;
    const totalCount = tasks.length;
    const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
    const primaryGroup = groups[0];

    return `
      <div class="page-header">
        <div>
          <div class="page-date">${formatDateCN()}</div>
          <h1 class="page-title">今日学习</h1>
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
        <section class="card card-padded" style="text-align:center;">
          <div style="font-size:15px;font-weight:600;">尚未设定考试倒计时</div>
          <p style="font-size:13px;color:var(--text-secondary);margin:6px 0 14px;">添加一个考试或目标日期，每天醒目提醒进度。</p>
          <button class="btn-primary btn-sm" data-action="open-add-exam">设定目标倒计时</button>
        </section>
      `}

      <section class="summary-strip">
        <div class="card summary-tile">
          <div>
            <div class="summary-label">今日任务</div>
            <div class="summary-value tabular">${doneCount} / ${totalCount}</div>
            <div class="summary-sub">连续打卡 ${user.streak} 天</div>
          </div>
          <div class="ring-box">
            ${ringSVG(pct, 48, 5, 'var(--accent)')}
            <span class="ring-center">${pct}%</span>
          </div>
        </div>

        <button class="card summary-tile" data-action="open-focus" style="text-align:left;">
          <div>
            <div class="summary-label">今日专注</div>
            <div class="summary-value tabular">${user.focusMinutesToday || 0}<span style="font-size:13px;font-weight:500;margin-left:2px;">分</span></div>
            <div class="summary-sub" style="color:var(--accent);font-weight:500;">点击开启计时 ›</div>
          </div>
          <div class="ring-box">
            ${ringSVG(Math.min(100, Math.round(((user.focusMinutesToday || 0) / 180) * 100)), 48, 5, 'var(--green)')}
            <span class="ring-center" style="font-size:10px;">专注</span>
          </div>
        </button>
      </section>

      <div class="section-header">
        <h2 class="section-title">今日任务清单</h2>
        <button class="section-action" data-action="open-add-task">+ 添加任务</button>
      </div>

      <section class="card ios-list">
        ${tasks.length ? tasks.map((t) => `
          <div class="task-row ${t.done ? 'is-done' : ''}">
            <button class="task-check-btn" data-action="toggle-task" data-id="${t.id}" aria-label="${t.done ? '取消完成' : '标记完成'}">
              <svg class="task-check-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.5 10.5l3.6 3.6 7.4-7.8"/>
              </svg>
            </button>
            <button class="task-main" data-action="toggle-task" data-id="${t.id}">
              <div class="task-title">${esc(t.title)}</div>
              <div class="task-meta">
                <span class="meta-tag">${esc(t.subject)}</span>
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
        `).join('') : `
          <div class="empty-box">
            <div>今天还没有安排学习任务</div>
            <button class="btn-primary btn-sm" style="margin-top:12px;" data-action="open-add-task">制定第一项任务</button>
          </div>
        `}
      </section>
    `;
  }

  function buildGroupsView() {
    const { groups, user } = state.data;
    const activeGroup = groups.find((g) => g.id === state.activeGroupId) || groups[0];

    return `
      <div class="page-header">
        <div>
          <div class="page-date">多人共学 · 实时同步</div>
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
                <div class="member-ratio tabular">${m.done}/${m.total} · ${m.streak}天</div>
              </button>
            `).join('')}
          </div>
          <div class="member-hint">未完成时点击头像可「拍一拍催学」，已完成可「点赞鼓励」</div>
        </section>

        <div class="section-header">
          <h2 class="section-title">小组实时打卡动态</h2>
          <span style="font-size:12px;color:var(--green);font-weight:600;">实时在线</span>
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
            <div class="card empty-box">还没有打卡动态，去「今日」勾选一项任务试试吧。</div>
          `}
        </section>
      ` : `
        <section class="card empty-box">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);">你还没有加入任何学习小组</div>
          <p style="margin:8px 0 16px;">创建一个小组生成邀请链接发给研友/同学，或输入邀请码立即加入。</p>
          <div style="display:flex;justify-content:center;gap:10px;">
            <button class="btn-secondary" data-action="open-join-group">输入邀请码</button>
            <button class="btn-primary" data-action="open-create-group">创建学习小组</button>
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
                ${exams.length > 1 ? `<button style="color:var(--text-tertiary);" data-action="delete-exam" data-id="${e.id}">删除</button>` : ''}
              </div>
            </div>
          </article>
        `).join('') : `
          <div class="card empty-box">暂无目标倒计时，点击右上角添加一个考试日期。</div>
        `}
      </section>

      <div class="section-header">
        <h2 class="section-title">一键添加热门考试预设</h2>
      </div>
      <section class="card card-padded">
        <div class="chip-row">
          ${EXAM_PRESETS.map((p, idx) => `
            <button class="choice-chip" data-action="quick-preset-exam" data-idx="${idx}">
              + ${esc(p.name)} (${p.days}天)
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
              ${isStandalone ? '已处于独立全屏 App 模式，体验最佳' : '免下载 App，3 秒生成原生质感全屏桌面图标'}
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
        <h2 class="section-title">② iPhone 锁屏倒计时壁纸（免装 App 首选）</h2>
      </div>
      <section class="card card-padded">
        <div style="font-size:14px;font-weight:600;">自动避开锁屏时钟，亮屏即见考试倒计时与今日任务</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">
          可直接保存 1170×2532 高清 PNG 设为 iPhone 锁屏壁纸，每次更新任务或切换暗夜模式都可随时重新导出。
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
        <div style="font-size:14px;font-weight:600;">在 iPhone 主屏幕展示真实 4×2 倒计时与任务卡片</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;line-height:1.5;">
          在 App Store 免费下载 <strong>Scriptable</strong>，新建脚本粘贴下方专属代码，长按桌面添加 Scriptable 中号小组件即可在主屏直接显示倒计时，点一下直达网页打卡。
        </div>
        <pre id="scriptable-code-preview" class="code-preview">正在生成你的专属小组件代码…</pre>
        <button class="btn-primary btn-block" style="margin-top:12px;" data-action="copy-scriptable">一键复制我的小组件脚本</button>
      </section>
    `;
  }

  // =========================================================================
  // Modals / Bottom Sheets
  // =========================================================================

  function openAddTaskSheet() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">新建学习任务</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <form id="form-add-task">
        <div class="field">
          <label class="field-label" for="input-task-title">任务内容</label>
          <input id="input-task-title" class="input" type="text" required maxlength="60" placeholder="例如：背诵 50 个考研高频词并复盘" autofocus />
        </div>
        <div class="field">
          <label class="field-label">学科 / 分类</label>
          <div class="chip-row" id="task-subject-chips">
            ${SUBJECT_PRESETS.map((s, i) => `
              <button type="button" class="choice-chip ${i === 0 ? 'is-selected' : ''}" data-subject="${s}">${s}</button>
            `).join('')}
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="input-task-duration">预计专注时长（分钟）</label>
          <input id="input-task-duration" class="input tabular" type="number" min="5" max="360" value="45" />
        </div>
        <div class="field">
          <div class="switch-row">
            <div>
              <div style="font-size:14px;font-weight:600;">每日自动重复</div>
              <div style="font-size:12px;color:var(--text-secondary);">次日自动重置为待办，适合背词/刷题习惯</div>
            </div>
            <button type="button" id="switch-repeat" class="ios-switch is-on" role="switch" aria-checked="true"></button>
          </div>
        </div>
        <button type="submit" class="btn-primary btn-block" style="margin-top:8px;">添加到今日清单</button>
      </form>
    `);

    let selectedSubject = SUBJECT_PRESETS[0];
    let repeatDaily = true;

    sheetContent.querySelectorAll('#task-subject-chips .choice-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSubject = btn.dataset.subject;
        sheetContent.querySelectorAll('#task-subject-chips .choice-chip').forEach((b) => b.classList.toggle('is-selected', b === btn));
      });
    });

    const sw = document.getElementById('switch-repeat');
    sw.addEventListener('click', () => {
      repeatDaily = !repeatDaily;
      sw.classList.toggle('is-on', repeatDaily);
      sw.setAttribute('aria-checked', String(repeatDaily));
    });

    document.getElementById('form-add-task').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('input-task-title').value.trim();
      const durationMin = Number(document.getElementById('input-task-duration').value) || 30;
      if (!title) return;
      closeSheet();
      try {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ userId: state.userId, title, subject: selectedSubject, durationMin, repeatDaily })
        });
        await loadBootstrap(true);
        showHud('已添加到今日清单');
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
          <input id="input-exam-name" class="input" type="text" required maxlength="30" placeholder="例如：2027 全国考研初试" />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-date">目标日期</label>
          <input id="input-exam-date" class="input tabular" type="date" required value="${addDaysStr(60)}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-exam-tag">阶段标签</label>
          <input id="input-exam-tag" class="input" type="text" maxlength="12" value="核心冲刺" />
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
          <input id="input-group-name" class="input" type="text" required maxlength="24" placeholder="例如：法考每日打卡搭子组" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-exam">共同备考目标</label>
          <input id="input-group-exam" class="input" type="text" required maxlength="24" placeholder="例如：2027 法考客观题" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-date">共同目标日期</label>
          <input id="input-group-date" class="input tabular" type="date" required value="${addDaysStr(80)}" />
        </div>
        <div class="field">
          <label class="field-label" for="input-group-notice">小组公约 / 公告</label>
          <input id="input-group-notice" class="input" type="text" maxlength="60" value="每晚 22:30 前完成今日清单打卡，互相监督。" />
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
            <div style="font-size:12px;color:var(--accent);font-weight:600;">收到微信学习小组邀请</div>
            <div style="font-size:16px;font-weight:700;margin-top:4px;">${esc(sharedGroup.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">共同目标：${esc(sharedGroup.examName)} · ${esc(sharedGroup.targetDate)}</div>
          </div>
        ` : ''}
        <div class="field">
          <label class="field-label" for="input-join-code">输入 6 位小组邀请码</label>
          <input id="input-join-code" class="input tabular" style="text-transform:uppercase;letter-spacing:0.12em;font-weight:700;" type="text" required maxlength="8" placeholder="例如 KY2027" value="${esc(prefillCode)}" />
        </div>
        <p style="font-size:12px;color:var(--text-secondary);margin:-4px 0 16px;">演示小组邀请码：<strong style="color:var(--text-primary);">KY2027</strong></p>
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
    if (!state.data) return;
    const { users, user } = state.data;
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">学习账号 · 多人体验切换</h2>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <p style="font-size:12px;color:var(--text-secondary);margin:0 0 14px;line-height:1.5;">
        你可以创建自己的专属账号，或在已有成员之间快速切换，直观体验多人小组打卡与实时同步效果。
      </p>
      <div>
        ${users.map((u) => `
          <button class="account-row" data-switch-user="${u.id}">
            <div class="account-left">
              <span class="avatar-dot" style="width:32px;height:32px;font-size:13px;background:${u.color}">${esc(u.avatar)}</span>
              <div style="text-align:left;">
                <div style="font-size:14px;font-weight:600;">${esc(u.name)}</div>
                <div style="font-size:11px;color:var(--text-secondary);">连续打卡 ${u.streak} 天</div>
              </div>
            </div>
            ${u.id === user.id ? '<span class="account-check">当前账号</span>' : '<span style="font-size:12px;color:var(--text-tertiary);">切换</span>'}
          </button>
        `).join('')}
      </div>

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-separator);">
        <form id="form-new-user">
          <div class="field">
            <label class="field-label" for="input-new-username">创建全新学习账号（自动加入默认演示小组）</label>
            <div style="display:flex;gap:8px;">
              <input id="input-new-username" class="input" type="text" required maxlength="16" placeholder="输入你的昵称，如：李明" />
              <button type="submit" class="btn-primary" style="flex-shrink:0;">创建</button>
            </div>
          </div>
        </form>
      </div>
    `);

    sheetContent.querySelectorAll('[data-switch-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.userId = btn.dataset.switchUser;
        state.scriptableCode = '';
        localStorage.setItem('shixu_user_id', state.userId);
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
        const res = await api('/api/users', {
          method: 'POST',
          body: JSON.stringify({ name, joinCode: 'KY2027' })
        });
        state.userId = res.user.id;
        state.scriptableCode = '';
        localStorage.setItem('shixu_user_id', state.userId);
        await loadBootstrap(false);
        showHud(`欢迎加入，${res.user.name}`);
      } catch (err) {
        showHud(err.message, 'var(--red)');
      }
    });
  }

  function openFocusSheet() {
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
          <button id="focus-finish-btn" class="btn-secondary">提前结算打卡</button>
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
        showHud(`已记录 ${elapsedMin} 分钟专注并同步小组`);
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
        showHud(`专注 ${mins} 分钟完成，已同步到小组`);
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
  // Crisp 1170x2532 iPhone Lock Screen PNG Generator (Works 100% Client-Side)
  // =========================================================================

  function renderLockscreenCanvasDataUrl() {
    if (!state.data) return '';
    const canvas = document.getElementById('wallpaper-canvas');
    const ctx = canvas.getContext('2d');
    const W = 1170;
    const H = 2532;
    const isDark = state.theme === 'dark';
    const pinned = state.data.exams[0] || { name: '设定你的目标', tag: '核心目标', daysLeft: 0, progress: 0, targetDate: '' };
    const tasks = state.data.tasks.slice(0, 3);
    const done = state.data.tasks.filter((t) => t.done).length;
    const total = state.data.tasks.length;
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
    roundRect(156, 1392, Math.max(40, Math.round(858 * (pinned.progress / 100))), 12, 6);
    ctx.fillStyle = accent;
    ctx.fill();

    tasks.forEach((t, idx) => {
      const y = 1500 + idx * 104;
      ctx.beginPath();
      ctx.arc(176, y - 12, 16, 0, Math.PI * 2);
      if (t.done) {
        ctx.fillStyle = accent;
        ctx.fill();
      } else {
        ctx.strokeStyle = muted;
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
      ctx.fillStyle = t.done ? muted : fg;
      ctx.font = `500 35px ${fontFamily}`;
      const label = t.title.length > 18 ? `${t.title.slice(0, 18)}…` : t.title;
      ctx.fillText(label, 218, y);
    });

    ctx.fillStyle = sep;
    ctx.fillRect(156, 1812, 858, 2);

    ctx.fillStyle = muted;
    ctx.font = `500 31px ${fontFamily}`;
    ctx.fillText(grp ? `${grp.name} · 今日 ${grp.teamPct}%` : `连续坚持 ${state.data.user.streak} 天`, 156, 1878);

    ctx.fillStyle = accent;
    ctx.font = `600 31px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`今日 ${done}/${total}`, 1014, 1878);
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
    if (state.activeTab === 'desktop') renderView(false);
  });

  fabAdd.addEventListener('click', () => {
    if (state.activeTab === 'exams') openAddExamSheet();
    else openAddTaskSheet();
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'close-sheet') return closeSheet();
    if (action === 'open-add-task') return openAddTaskSheet();
    if (action === 'open-add-exam') return openAddExamSheet();
    if (action === 'open-create-group') return openCreateGroupSheet();
    if (action === 'open-join-group') return openJoinGroupSheet();
    if (action === 'open-focus') return openFocusSheet();

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
      task.done = !task.done;
      renderView(false);
      try {
        await api(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: task.done })
        });
        await loadBootstrap(true);
        if (task.done) showHud('打卡成功，已同步至学习小组');
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
        showHud(kind === 'cheer' ? `已鼓励 ${btn.dataset.name}` : `已拍一拍提醒 ${btn.dataset.name} 去打卡`, 'var(--accent)');
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

  // Real-time Sync (SSE in Server Mode, BroadcastChannel in Static Mode)
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
      document.getElementById('wechat-dismiss').addEventListener('click', () => {
        overlay.classList.add('hidden');
      });
    }
  }

  function checkInviteLink() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    const sharedParam = params.get('g');
    if (joinCode) {
      const sharedGroup = sharedParam ? decodeShareGroup(sharedParam) : null;
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => openJoinGroupSheet(joinCode.toUpperCase(), sharedGroup), 450);
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  applyTheme(state.theme);
  checkWeChatBrowser();
  loadBootstrap(false).then(() => {
    setupRealtime();
    checkInviteLink();
  });
})();
