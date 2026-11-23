const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

const SYSTEM_COLORS = ['#0071E3', '#34C759', '#FF9500', '#FF3B30', '#30B0C7', '#5856D6'];

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysISO(days) {
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

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isTaskOnDate(task, dateStr) {
  if (!task.repeatDaily) return task.date === dateStr;
  return dateStr >= task.date;
}

function isTaskDoneOnDate(task, dateStr) {
  return Array.isArray(task.completedDates) ? task.completedDates.includes(dateStr) : Boolean(task.done && task.date === dateStr);
}

// Pure raw clean initial store — zero pre-filled demo data
function createEmptyStore() {
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

let store = null;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    store = createEmptyStore();
    saveStore();
    return;
  }
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    if (!Array.isArray(store.categories)) store.categories = [];
  } catch {
    store = createEmptyStore();
    saveStore();
  }
  rolloverIfNeeded();
}

function saveStore() {
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, STORE_PATH);
}

function rolloverIfNeeded() {
  const today = todayKey();
  if (store.lastRolloverDate === today) return;
  for (const u of store.users) u.focusMinutesToday = 0;
  store.lastRolloverDate = today;
  saveStore();
}

const sseClients = new Set();

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(message); } catch { sseClients.delete(res); }
  }
}

setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': ping\n\n'); } catch { sseClients.delete(res); }
  }
}, 25000);

function getUserTaskSummary(userId, dateStr = todayKey()) {
  const list = store.tasks.filter((t) => t.userId === userId && isTaskOnDate(t, dateStr));
  const done = list.filter((t) => isTaskDoneOnDate(t, dateStr)).length;
  const total = list.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct, list };
}

function ensureCategoryForUser(userId, name, color) {
  const cleanName = String(name || '').trim().slice(0, 18);
  if (!cleanName) return null;
  let existing = store.categories.find((c) => c.userId === userId && c.name === cleanName);
  if (!existing) {
    const userCats = store.categories.filter((c) => c.userId === userId);
    existing = {
      id: genId('cat'),
      userId,
      name: cleanName,
      color: color || SYSTEM_COLORS[userCats.length % SYSTEM_COLORS.length]
    };
    store.categories.push(existing);
  }
  return existing;
}

function buildGroupDTO(group) {
  const today = todayKey();
  const members = group.memberIds
    .map((uid) => store.users.find((u) => u.id === uid))
    .filter(Boolean)
    .map((u) => {
      const s = getUserTaskSummary(u.id, today);
      return {
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        color: u.color,
        streak: u.streak,
        focusMinutesToday: u.focusMinutesToday || 0,
        done: s.done,
        total: s.total,
        pct: s.pct
      };
    });

  const totalTasks = members.reduce((acc, m) => acc + m.total, 0);
  const doneTasks = members.reduce((acc, m) => acc + m.done, 0);
  const teamPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  const feeds = store.feeds
    .filter((f) => f.groupId === group.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30)
    .map((f) => {
      const u = store.users.find((x) => x.id === f.userId) || { name: '成员', avatar: '学', color: '#0071E3' };
      return { ...f, userName: u.name, userAvatar: u.avatar, userColor: u.color };
    });

  return {
    ...group,
    daysLeft: daysUntil(group.targetDate),
    members,
    totalTasks,
    doneTasks,
    teamPct,
    feeds
  };
}

function buildBootstrap(userId) {
  rolloverIfNeeded();
  const user = store.users.find((u) => u.id === userId) || store.users[0] || null;
  const today = todayKey();

  if (!user) {
    return { today, user: null, users: [], categories: [], tasks: [], exams: [], groups: [] };
  }

  const categories = store.categories.filter((c) => c.userId === user.id);
  const tasks = store.tasks
    .filter((t) => t.userId === user.id)
    .map((t) => ({
      ...t,
      category: t.category || t.subject || '未分组',
      completedDates: Array.isArray(t.completedDates) ? t.completedDates : (t.done ? [t.date] : []),
      done: isTaskDoneOnDate(t, today)
    }));

  const exams = store.exams
    .filter((e) => e.userId === user.id)
    .map((e) => ({ ...e, daysLeft: daysUntil(e.targetDate), progress: calcProgress(e.startDate, e.targetDate) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.daysLeft - b.daysLeft);

  const groups = store.groups
    .filter((g) => g.memberIds.includes(user.id))
    .map(buildGroupDTO);

  return {
    today,
    user,
    users: store.users.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color, streak: u.streak })),
    categories,
    tasks,
    exams,
    groups
  };
}

function buildWidgetPayload(userId) {
  const data = buildBootstrap(userId);
  const today = data.today;
  const todayTasks = data.tasks.filter((t) => isTaskOnDate(t, today));
  const pinnedExam = data.exams[0] || { name: '尚未设定目标', daysLeft: 0, progress: 0, targetDate: today, tag: '倒计时' };
  const done = todayTasks.filter((t) => isTaskDoneOnDate(t, today)).length;
  const total = todayTasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const primaryGroup = data.groups[0] || null;
  return {
    updatedAt: new Date().toISOString(),
    user: data.user ? { id: data.user.id, name: data.user.name, streak: data.user.streak } : { id: '', name: '未登录', streak: 0 },
    countdown: {
      name: pinnedExam.name,
      tag: pinnedExam.tag,
      targetDate: pinnedExam.targetDate,
      daysLeft: pinnedExam.daysLeft,
      progress: pinnedExam.progress
    },
    today: {
      done,
      total,
      pct,
      focusMinutes: data.user ? (data.user.focusMinutesToday || 0) : 0,
      tasks: todayTasks.slice(0, 4).map((t) => ({ title: t.title, category: t.category, done: isTaskDoneOnDate(t, today) }))
    },
    group: primaryGroup
      ? {
          name: primaryGroup.name,
          memberCount: primaryGroup.members.length,
          teamPct: primaryGroup.teamPct,
          doneTasks: primaryGroup.doneTasks,
          totalTasks: primaryGroup.totalTasks
        }
      : null
  };
}

function buildWallpaperSVG(userId, theme) {
  const p = buildWidgetPayload(userId);
  const isDark = theme === 'dark';
  const bg1 = isDark ? '#080C18' : '#EBF2FC';
  const bg2 = isDark ? '#000000' : '#F5F5F7';
  const cardBg = isDark ? 'rgba(28,28,30,0.82)' : 'rgba(255,255,255,0.82)';
  const stroke = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const fg = isDark ? '#F5F5F7' : '#1D1D1F';
  const muted = isDark ? '#98989D' : '#6E6E73';
  const accent = isDark ? '#0A84FF' : '#0071E3';

  const taskRows = p.today.tasks.slice(0, 3).map((t, idx) => {
    const y = 1495 + idx * 108;
    const circleFill = t.done ? accent : 'none';
    const circleStroke = t.done ? accent : muted;
    const textOpacity = t.done ? '0.48' : '1';
    const title = escapeXml(t.title.length > 18 ? `${t.title.slice(0, 18)}…` : t.title);
    return `
      <circle cx="176" cy="${y - 10}" r="16" fill="${circleFill}" stroke="${circleStroke}" stroke-width="3.5" />
      ${t.done ? `<path d="M168 ${y - 10} L174 ${y - 4} L185 ${y - 16}" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      <text x="218" y="${y}" font-size="36" font-weight="500" fill="${fg}" opacity="${textOpacity}">${title}</text>
    `;
  }).join('');

  const groupLine = p.group ? `${escapeXml(p.group.name)} · 今日达成 ${p.group.teamPct}%` : '时序 StudyOS';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532" viewBox="0 0 1170 2532">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg1}" />
      <stop offset="100%" stop-color="${bg2}" />
    </linearGradient>
    <radialGradient id="glow" cx="25%" cy="38%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="${isDark ? '0.22' : '0.16'}" />
      <stop offset="100%" stop-color="${accent}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1170" height="2532" fill="url(#bg)" />
  <rect width="1170" height="2532" fill="url(#glow)" />
  <rect x="96" y="1030" width="978" height="900" rx="68" fill="${cardBg}" stroke="${stroke}" stroke-width="2" />
  <g font-family="-apple-system, BlinkMacSystemFont, PingFang SC, Helvetica Neue, sans-serif">
    <text x="156" y="1125" font-size="32" font-weight="600" fill="${accent}" letter-spacing="1">${escapeXml(p.countdown.tag)} · ${escapeXml(p.countdown.targetDate)}</text>
    <text x="156" y="1192" font-size="48" font-weight="700" fill="${fg}">${escapeXml(p.countdown.name)}</text>
    <text x="156" y="1352" font-size="144" font-weight="700" fill="${fg}">${p.countdown.daysLeft}</text>
    <text x="${156 + String(p.countdown.daysLeft).length * 92}" y="1348" font-size="44" font-weight="500" fill="${muted}">天</text>
    <rect x="156" y="1396" width="858" height="12" rx="6" fill="${stroke}" />
    <rect x="156" y="1396" width="${Math.max(40, Math.round(858 * (p.countdown.progress / 100)))}" height="12" rx="6" fill="${accent}" />
    <line x1="156" y1="1440" x2="1014" y2="1440" stroke="${stroke}" stroke-width="2" />
    ${taskRows || `<text x="156" y="1560" font-size="34" font-weight="500" fill="${muted}">前往时序添加今日学习任务</text>`}
    <line x1="156" y1="1812" x2="1014" y2="1812" stroke="${stroke}" stroke-width="2" />
    <text x="156" y="1878" font-size="31" font-weight="500" fill="${muted}">${groupLine}</text>
    <text x="1014" y="1878" font-size="31" font-weight="600" fill="${accent}" text-anchor="end">今日 ${p.today.done}/${p.today.total}</text>
  </g>
</svg>`;
}

function buildScriptableCode(origin, userId) {
  const apiUrl = `${origin}/api/widget/data?userId=${encodeURIComponent(userId)}`;
  return `// 时序 StudyOS · iOS 桌面实时小组件 (Scriptable)
const API_URL = "${apiUrl}";
const APP_URL = "${origin}";
const req = new Request(API_URL);
req.timeoutInterval = 10;
const data = await req.loadJSON();

const w = new ListWidget();
w.url = APP_URL;
w.setPadding(16, 18, 16, 18);
w.backgroundColor = Color.dynamic(new Color("#FFFFFF", 0.96), new Color("#1C1C1E", 0.96));
const fg = Color.dynamic(new Color("#1D1D1F"), new Color("#F5F5F7"));
const muted = Color.dynamic(new Color("#6E6E73"), new Color("#98989D"));
const accent = Color.dynamic(new Color("#0071E3"), new Color("#0A84FF"));

const root = w.addStack();
root.layoutHorizontally();
root.centerAlignContent();

const left = root.addStack();
left.layoutVertically();
left.size = new Size(120, 0);
const tag = left.addText(data.countdown.name);
tag.font = Font.semiboldSystemFont(12); tag.textColor = muted; tag.lineLimit = 1;
left.addSpacer(4);
const numRow = left.addStack(); numRow.bottomAlignContent();
const days = numRow.addText(String(data.countdown.daysLeft));
days.font = Font.boldRoundedSystemFont(40); days.textColor = fg;
numRow.addSpacer(3);
const unit = numRow.addText("天");
unit.font = Font.mediumSystemFont(13); unit.textColor = muted;
left.addSpacer(6);
const sub = left.addText(data.group ? ("小组 " + data.group.teamPct + "%") : ("今日 " + data.today.done + "/" + data.today.total));
sub.font = Font.semiboldSystemFont(11); sub.textColor = accent;

root.addSpacer(14);
const right = root.addStack();
right.layoutVertically();
const head = right.addText("今日学习 · " + data.today.done + "/" + data.today.total);
head.font = Font.semiboldSystemFont(12); head.textColor = fg;
right.addSpacer(6);

const tasks = (data.today.tasks || []).slice(0, 3);
if (!tasks.length) {
  const empty = right.addText("点击添加今日任务");
  empty.font = Font.mediumSystemFont(12); empty.textColor = muted;
} else {
  for (const t of tasks) {
    const row = right.addStack(); row.centerAlignContent();
    const mark = row.addText(t.done ? "● " : "○ ");
    mark.font = Font.systemFont(11); mark.textColor = t.done ? accent : muted;
    const title = row.addText(t.title);
    title.font = Font.mediumSystemFont(12); title.textColor = t.done ? muted : fg; title.lineLimit = 1;
    right.addSpacer(4);
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();`;
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 512) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, reqPath) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!fullPath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (iErr, content) => {
        if (iErr) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(content);
      });
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' || ext === '.jpg' ? 'public, max-age=86400' : 'no-cache'
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

ensureStore();

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const origin = `${proto}://${host}`;
  const urlObj = new URL(req.url, origin);
  const pathname = urlObj.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (method === 'GET' && pathname === '/api/bootstrap') {
      return sendJSON(res, 200, buildBootstrap(urlObj.searchParams.get('userId') || ''));
    }

    if (method === 'POST' && pathname === '/api/reset') {
      store = createEmptyStore();
      saveStore();
      broadcast('sync', { reason: 'reset' });
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/widget/data') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return sendJSON(res, 200, buildWidgetPayload(urlObj.searchParams.get('userId') || ''));
    }

    if (method === 'GET' && pathname === '/api/widget/scriptable') {
      const code = buildScriptableCode(origin, urlObj.searchParams.get('userId') || '');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(code);
      return;
    }

    if (method === 'GET' && pathname === '/api/wallpaper.svg') {
      const svg = buildWallpaperSVG(urlObj.searchParams.get('userId') || '', urlObj.searchParams.get('theme') === 'dark' ? 'dark' : 'light');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(svg);
      return;
    }

    // Users
    if (method === 'POST' && pathname === '/api/users') {
      const body = await parseBody(req);
      const name = String(body.name || '').trim().slice(0, 16);
      if (!name) return sendJSON(res, 400, { error: '请输入昵称' });

      const user = {
        id: genId('u'),
        name,
        avatar: name.slice(0, 1),
        color: body.color || SYSTEM_COLORS[store.users.length % SYSTEM_COLORS.length],
        streak: 0,
        focusMinutesToday: 0,
        createdAt: Date.now()
      };
      store.users.push(user);

      if (body.joinCode) {
        const code = String(body.joinCode).trim().toUpperCase();
        const grp = store.groups.find((g) => g.inviteCode === code);
        if (grp && !grp.memberIds.includes(user.id)) {
          grp.memberIds.push(user.id);
          store.feeds.push({ id: genId('f'), groupId: grp.id, userId: user.id, type: 'join', text: '加入了学习小组', createdAt: Date.now(), likedBy: [] });
        }
      }

      saveStore();
      broadcast('sync', { reason: 'user_created', userId: user.id });
      return sendJSON(res, 201, { user, bootstrap: buildBootstrap(user.id) });
    }

    // Custom Task Categories (大标题管理)
    if (method === 'POST' && pathname === '/api/categories') {
      const body = await parseBody(req);
      const userId = body.userId;
      const name = String(body.name || '').trim().slice(0, 18);
      if (!userId || !name) return sendJSON(res, 400, { error: '请输入任务大标题名称' });
      const category = ensureCategoryForUser(userId, name, body.color);
      saveStore();
      broadcast('sync', { reason: 'category_created', userId });
      return sendJSON(res, 201, { category });
    }

    const catMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
    if (catMatch && method === 'PATCH') {
      const body = await parseBody(req);
      const cat = store.categories.find((c) => c.id === catMatch[1]);
      if (!cat) return sendJSON(res, 404, { error: '大标题不存在' });
      const oldName = cat.name;
      if (typeof body.name === 'string' && body.name.trim()) {
        const nextName = body.name.trim().slice(0, 18);
        cat.name = nextName;
        for (const t of store.tasks) {
          if (t.userId === cat.userId && (t.category === oldName || t.subject === oldName)) {
            t.category = nextName;
            t.subject = nextName;
          }
        }
      }
      if (typeof body.color === 'string' && body.color) cat.color = body.color;
      saveStore();
      broadcast('sync', { reason: 'category_updated', userId: cat.userId });
      return sendJSON(res, 200, { category: cat });
    }

    if (catMatch && method === 'DELETE') {
      const idx = store.categories.findIndex((c) => c.id === catMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: '大标题不存在' });
      const [removed] = store.categories.splice(idx, 1);
      for (const t of store.tasks) {
        if (t.userId === removed.userId && t.category === removed.name) {
          t.category = '未分组';
          t.subject = '未分组';
        }
      }
      saveStore();
      broadcast('sync', { reason: 'category_deleted', userId: removed.userId });
      return sendJSON(res, 200, { ok: true });
    }

    // Create Task (supports custom category big title & specific timeline date)
    if (method === 'POST' && pathname === '/api/tasks') {
      const body = await parseBody(req);
      const userId = body.userId;
      const title = String(body.title || '').trim().slice(0, 60);
      if (!userId || !title) return sendJSON(res, 400, { error: '请输入任务名称' });

      const categoryName = String(body.category || body.subject || '未分组').trim().slice(0, 18) || '未分组';
      if (categoryName !== '未分组') {
        ensureCategoryForUser(userId, categoryName, body.categoryColor);
      }

      const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : todayKey();
      const task = {
        id: genId('t'),
        userId,
        title,
        category: categoryName,
        subject: categoryName,
        durationMin: Math.min(360, Math.max(5, Number(body.durationMin) || 30)),
        repeatDaily: Boolean(body.repeatDaily),
        date: taskDate,
        completedDates: [],
        createdAt: Date.now()
      };
      store.tasks.unshift(task);
      saveStore();
      broadcast('sync', { reason: 'task_created', userId });
      return sendJSON(res, 201, { task });
    }

    // Toggle Task for a specific timeline date
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && method === 'PATCH') {
      const body = await parseBody(req);
      const task = store.tasks.find((t) => t.id === taskMatch[1]);
      if (!task) return sendJSON(res, 404, { error: '任务不存在' });

      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : todayKey();
      if (!Array.isArray(task.completedDates)) task.completedDates = [];
      const prevDone = task.completedDates.includes(targetDate);

      if (typeof body.done === 'boolean') {
        if (body.done && !prevDone) task.completedDates.push(targetDate);
        if (!body.done && prevDone) task.completedDates = task.completedDates.filter((d) => d !== targetDate);
      }

      if (!prevDone && body.done === true && targetDate === todayKey()) {
        const user = store.users.find((u) => u.id === task.userId);
        if (user && user.streak === 0) user.streak = 1;
        const summary = getUserTaskSummary(task.userId, targetDate);
        for (const g of store.groups.filter((gr) => gr.memberIds.includes(task.userId))) {
          const text = summary.done === summary.total && summary.total > 0
            ? `完成了今日全部 ${summary.total} 项学习任务，达成率 100%`
            : `打卡「${task.category} · ${task.title}」`;
          store.feeds.push({ id: genId('f'), groupId: g.id, userId: task.userId, type: 'checkin', text, createdAt: Date.now(), likedBy: [] });
        }
        broadcast('toast', { fromUserId: task.userId, text: `${user ? user.name : '成员'} 刚刚完成打卡：${task.title.slice(0, 14)}` });
      }

      saveStore();
      broadcast('sync', { reason: 'task_updated', userId: task.userId });
      return sendJSON(res, 200, { task });
    }

    if (taskMatch && method === 'DELETE') {
      const idx = store.tasks.findIndex((t) => t.id === taskMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: '任务不存在' });
      const [removed] = store.tasks.splice(idx, 1);
      saveStore();
      broadcast('sync', { reason: 'task_deleted', userId: removed.userId });
      return sendJSON(res, 200, { ok: true });
    }

    // Exams
    if (method === 'POST' && pathname === '/api/exams') {
      const body = await parseBody(req);
      const userId = body.userId;
      const name = String(body.name || '').trim().slice(0, 30);
      const targetDate = String(body.targetDate || '').trim();
      if (!userId || !name || !targetDate) return sendJSON(res, 400, { error: '请填写目标名称和日期' });

      const pinned = body.pinned !== false;
      if (pinned) for (const ex of store.exams) if (ex.userId === userId) ex.pinned = false;

      const exam = {
        id: genId('ex'),
        userId,
        name,
        tag: String(body.tag || '核心目标').trim().slice(0, 12),
        startDate: todayKey(),
        targetDate,
        color: body.color || '#0071E3',
        pinned
      };
      store.exams.push(exam);
      saveStore();
      broadcast('sync', { reason: 'exam_created', userId });
      return sendJSON(res, 201, { exam });
    }

    const examMatch = pathname.match(/^\/api\/exams\/([^/]+)$/);
    if (examMatch && method === 'PATCH') {
      const body = await parseBody(req);
      const exam = store.exams.find((e) => e.id === examMatch[1]);
      if (!exam) return sendJSON(res, 404, { error: '目标不存在' });
      if (body.pinned === true) {
        for (const e of store.exams) if (e.userId === exam.userId) e.pinned = false;
        exam.pinned = true;
      }
      saveStore();
      broadcast('sync', { reason: 'exam_updated', userId: exam.userId });
      return sendJSON(res, 200, { exam });
    }

    if (examMatch && method === 'DELETE') {
      const idx = store.exams.findIndex((e) => e.id === examMatch[1]);
      if (idx === -1) return sendJSON(res, 404, { error: '目标不存在' });
      const [removed] = store.exams.splice(idx, 1);
      if (removed.pinned) {
        const next = store.exams.find((e) => e.userId === removed.userId);
        if (next) next.pinned = true;
      }
      saveStore();
      broadcast('sync', { reason: 'exam_deleted', userId: removed.userId });
      return sendJSON(res, 200, { ok: true });
    }

    // Focus
    if (method === 'POST' && pathname === '/api/focus/complete') {
      const body = await parseBody(req);
      const user = store.users.find((u) => u.id === body.userId);
      if (!user) return sendJSON(res, 404, { error: '用户不存在' });
      const minutes = Math.min(240, Math.max(1, Number(body.minutes) || 25));
      const label = String(body.label || '专注学习').trim().slice(0, 30);
      user.focusMinutesToday = (user.focusMinutesToday || 0) + minutes;
      if (user.streak === 0) user.streak = 1;
      for (const g of store.groups.filter((gr) => gr.memberIds.includes(user.id))) {
        store.feeds.push({ id: genId('f'), groupId: g.id, userId: user.id, type: 'focus', text: `完成了 ${minutes} 分钟沉浸专注「${label}」`, createdAt: Date.now(), likedBy: [] });
      }
      saveStore();
      broadcast('sync', { reason: 'focus_completed', userId: user.id });
      return sendJSON(res, 200, { focusMinutesToday: user.focusMinutesToday });
    }

    // Groups
    if (method === 'POST' && pathname === '/api/groups') {
      const body = await parseBody(req);
      const ownerId = body.userId;
      const name = String(body.name || '').trim().slice(0, 24);
      const examName = String(body.examName || '共同备考目标').trim().slice(0, 24);
      const targetDate = String(body.targetDate || addDaysISO(60)).trim();
      if (!ownerId || !name) return sendJSON(res, 400, { error: '请输入小组名称' });

      let inviteCode = genInviteCode();
      while (store.groups.some((g) => g.inviteCode === inviteCode)) inviteCode = genInviteCode();

      const group = {
        id: genId('g'),
        name,
        inviteCode,
        examName,
        targetDate,
        notice: String(body.notice || '每天按计划完成打卡，互相监督。').trim().slice(0, 60),
        ownerId,
        memberIds: [ownerId],
        createdAt: Date.now()
      };
      store.groups.push(group);
      store.feeds.push({ id: genId('f'), groupId: group.id, userId: ownerId, type: 'join', text: `创建了学习小组「${group.name}」，邀请码 ${inviteCode}`, createdAt: Date.now(), likedBy: [] });
      saveStore();
      broadcast('sync', { reason: 'group_created', groupId: group.id });
      return sendJSON(res, 201, { group: buildGroupDTO(group) });
    }

    if (method === 'POST' && pathname === '/api/groups/join') {
      const body = await parseBody(req);
      const userId = body.userId;
      const code = String(body.inviteCode || '').trim().toUpperCase();
      const group = store.groups.find((g) => g.inviteCode === code);
      if (!group) return sendJSON(res, 404, { error: '未找到该邀请码对应的学习小组' });
      if (!group.memberIds.includes(userId)) {
        group.memberIds.push(userId);
        store.feeds.push({ id: genId('f'), groupId: group.id, userId, type: 'join', text: `加入小组，共同冲刺「${group.examName}」`, createdAt: Date.now(), likedBy: [] });
        saveStore();
        broadcast('sync', { reason: 'group_joined', groupId: group.id });
      }
      return sendJSON(res, 200, { group: buildGroupDTO(group) });
    }

    const nudgeMatch = pathname.match(/^\/api\/groups\/([^/]+)\/nudge$/);
    if (nudgeMatch && method === 'POST') {
      const body = await parseBody(req);
      const fromUser = store.users.find((u) => u.id === body.fromUserId);
      const toUser = store.users.find((u) => u.id === body.toUserId);
      if (!fromUser || !toUser) return sendJSON(res, 404, { error: '成员不存在' });
      const kind = body.kind === 'cheer' ? 'cheer' : 'nudge';
      const text = kind === 'cheer' ? `给 ${toUser.name} 送上了鼓励` : `拍了拍 ${toUser.name}：该学习打卡啦`;
      store.feeds.push({ id: genId('f'), groupId: nudgeMatch[1], userId: fromUser.id, type: kind, text, createdAt: Date.now(), likedBy: [] });
      saveStore();
      broadcast('toast', { fromUserId: fromUser.id, toUserId: toUser.id, text: `${fromUser.name} ${kind === 'cheer' ? '鼓励了' : '拍了拍'} ${toUser.name}` });
      broadcast('sync', { reason: 'nudge', groupId: nudgeMatch[1] });
      return sendJSON(res, 200, { ok: true });
    }

    const likeMatch = pathname.match(/^\/api\/feeds\/([^/]+)\/like$/);
    if (likeMatch && method === 'POST') {
      const body = await parseBody(req);
      const feed = store.feeds.find((f) => f.id === likeMatch[1]);
      if (!feed) return sendJSON(res, 404, { error: '动态不存在' });
      const i = feed.likedBy.indexOf(body.userId);
      if (i === -1) feed.likedBy.push(body.userId);
      else feed.likedBy.splice(i, 1);
      saveStore();
      broadcast('sync', { reason: 'feed_liked', feedId: feed.id });
      return sendJSON(res, 200, { likedBy: feed.likedBy });
    }

    if (method === 'GET') return serveStatic(res, pathname);
    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('[Server Error]', err);
    sendJSON(res, 500, { error: '服务暂时不可用，请稍后重试' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`时序 StudyOS Web 已启动: http://localhost:${PORT}`);
});
