/**
 * SportLife v2 - 全功能后端
 * 用户认证 | 运动追踪 | GPS轨迹 | 步数记录 | 社区帖子 | 图片上传 | 训练计划
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();

// ========== 安全防护 ==========

// 1. Helmet: 自动设置安全 HTTP 头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://www.youtube.com", "https://wttr.in"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://player.vimeo.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://fonts.googleapis.com"],
      connectSrc: ["'self'", "https://wttr.in"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// 2. CORS: 限制允许的来源
app.use(cors({
  origin: function(origin, callback) {
    // 允许 localhost、局域网、ngrok
    const allowed = [
      /^http:\/\/localhost/,
      /^http:\/\/127\.0\.0\.1/,
      /^http:\/\/192\.168\.\d+\.\d+/,
      /^http:\/\/10\.\d+\.\d+\.\d+/,
      /^https:\/\/.*\.ngrok-free\.app$/,
      /^https:\/\/.*\.ngrok\.io$/,
    ];
    if (!origin || allowed.some(r => r.test(origin))) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));

// 3. 请求体大小限制（缩小到合理值）
app.use(express.json({ limit: '10mb' }));

// 4. 速率限制：防止暴力攻击
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 20, // 最多20次尝试
  message: { success: false, message: '操作过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 100, // 每分钟100次请求
  message: { success: false, message: '请求过于频繁' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 30, // 每小时30次上传
  message: { success: false, message: '上传次数已达上限' },
});

// 5. XSS 防护：清理用户输入
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>'"]/g, function(c) {
    return { '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c;
  });
}

// 6. SQL 注入防护：参数化查询检查
function validateId(id) {
  if (!id || typeof id !== 'string' || !/^[a-f0-9\-]{36}$/.test(id)) return false;
  return true;
}

// 应用全局 API 限流（非性能关键的 API）
app.use('/api/', apiLimiter);
// Static files with cache busting for HTML (no cache), short cache for assets
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } else if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'public, max-age=60');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname, '..', 'pages')));
app.use(express.static(path.join(__dirname, '..', 'assets')));

// ========== 文件上传配置 ==========
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ========== SQLite ==========
const initSqlJs = require('sql.js');
let db;

async function initDB() {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'sportlife.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    nickname TEXT DEFAULT '', avatar_color TEXT DEFAULT '#DCFCE7', avatar_initial TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '', gender TEXT DEFAULT '', age INTEGER DEFAULT 0,
    height REAL DEFAULT 0, weight REAL DEFAULT 0, target_weight REAL DEFAULT 0,
    bio TEXT DEFAULT '', theme TEXT DEFAULT 'light', language TEXT DEFAULT 'zh',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 0, duration_seconds INTEGER DEFAULT 0,
    calories_burned INTEGER DEFAULT 0, steps INTEGER DEFAULT 0, distance_km REAL DEFAULT 0,
    heart_rate_avg INTEGER DEFAULT 0, heart_rate_max INTEGER DEFAULT 0,
    notes TEXT DEFAULT '', completed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS gps_tracks (
    id TEXT PRIMARY KEY, workout_id TEXT NOT NULL, user_id TEXT NOT NULL,
    latitude REAL, longitude REAL, altitude REAL, accuracy REAL,
    speed REAL, timestamp TEXT,
    FOREIGN KEY (workout_id) REFERENCES workouts(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS step_records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    steps INTEGER DEFAULT 0, distance_km REAL DEFAULT 0, calories INTEGER DEFAULT 0,
    record_date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS training_plans (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
    difficulty TEXT DEFAULT 'medium', scheduled_date TEXT NOT NULL,
    scheduled_time TEXT DEFAULT '', duration_minutes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'planned', completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS body_metrics (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, weight REAL, body_fat REAL,
    bmi REAL, muscle_mass REAL, recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    icon TEXT DEFAULT '', color TEXT DEFAULT '#22C55E', earned_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL,
    image_url TEXT DEFAULT '', video_url TEXT DEFAULT '',
    workout_type TEXT DEFAULT '', workout_name TEXT DEFAULT '',
    calories_burned INTEGER DEFAULT 0, duration_minutes INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS post_likes (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(post_id, user_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS post_comments (
    id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // User XP and level system
  db.run(`CREATE TABLE IF NOT EXISTS user_xp (
    id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL,
    total_xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
    title TEXT DEFAULT '运动新手', avatar_frame TEXT DEFAULT 'none',
    streak_days INTEGER DEFAULT 0, last_workout_date TEXT DEFAULT '',
    total_workouts INTEGER DEFAULT 0, total_distance_km REAL DEFAULT 0,
    total_calories INTEGER DEFAULT 0, total_duration_minutes INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Daily challenges
  db.run(`CREATE TABLE IF NOT EXISTS daily_challenges (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    challenge_date TEXT NOT NULL, challenge_type TEXT NOT NULL,
    target_value INTEGER DEFAULT 0, current_value INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0, reward_xp INTEGER DEFAULT 50,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, challenge_date, challenge_type)
  )`);

  // Check-in records (streak tracking)
  db.run(`CREATE TABLE IF NOT EXISTS check_ins (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    check_in_date TEXT NOT NULL, xp_earned INTEGER DEFAULT 10,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, check_in_date)
  )`);

  // Social: follows
  db.run(`CREATE TABLE IF NOT EXISTS follows (
    id TEXT PRIMARY KEY, follower_id TEXT NOT NULL, following_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id),
    UNIQUE(follower_id, following_id)
  )`);

  // Friends (mutual follow = friend)
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, friend_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id),
    UNIQUE(user_id, friend_id)
  )`);

  // Friend requests
  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY, from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id),
    UNIQUE(from_user_id, to_user_id)
  )`);

  // Social: notifications
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    type TEXT NOT NULL, from_user_id TEXT DEFAULT '',
    content TEXT DEFAULT '', is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Default achievements
  const achCheck = db.exec("SELECT COUNT(*) as c FROM achievements WHERE id LIKE 'ach-%'");
  if (achCheck.length === 0 || achCheck[0].values[0][0] === 0) {
    const aches = [
      ['ach-run', '跑步达人', '\u{1F3C3}', '#22C55E'],
      ['ach-streak7', '\u8FDE\u7EED7\u5929', '\u{1F525}', '#F97316'],
      ['ach-strength', '\u529B\u91CF\u4E4B\u661F', '\u{1F4AA}', '#38BDF8'],
      ['ach-yoga', '\u745C\u4F3D\u65B0\u624B', '\u{1F9D8}', '#A78BFA'],
      ['ach-100day', '\u767E\u65E5\u575A\u6301', '\u{2B50}', '#EAB308'],
      ['ach-10k', '\u4E07\u6B65\u8FBE\u4EBA', '\u{1F3C3}\u200D\u2642\uFE0F', '#22C55E'],
      ['ach-marathon', '\u534A\u7A0B\u9A6C\u62C9\u677E', '\u{1F3C3}\u200D\u2640\uFE0F', '#F97316'],
    ];
    const stmt = db.prepare("INSERT OR IGNORE INTO achievements (id, user_id, name, icon, color) VALUES (?, 'SYSTEM', ?, ?, ?)");
    aches.forEach(a => stmt.run([a[0], a[1], a[2], a[3]]));
  }

  // Migrate: add new columns if they don't exist (for old databases)
  const newCols = [
    "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'light'",
    "ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'zh'",
  ];
  newCols.forEach(col => {
    try { db.run(col); } catch(e) { /* column already exists */ }
  });

  saveDB();
  console.log('[DB] SQLite initialized with all tables');
}

function saveDB() {
  const data = db.export();
  const dbPath = path.join(__dirname, '..', 'data', 'sportlife.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// ========== Helper ==========
function ok(res, data, status = 200) { res.status(status).json({ success: true, ...data }); }
function fail(res, message, status = 400) { res.status(status).json({ success: false, message }); }
function getUserFields(row) {
  if (!row) return null;
  return { id: row[0], username: row[1], nickname: row[2], avatar_color: row[3], avatar_initial: row[4], avatar_url: row[5], gender: row[6], height: row[7], weight: row[8], bio: row[9] };
}
function today() { return new Date().toISOString().split('T')[0]; }
function mapRow(result, tableName) {
  if (!result || result.length === 0) return {};
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj = {};
  cols.forEach((c, i) => { obj[c] = vals[i]; });
  return obj;
}
function mapRows(result, tableName) {
  if (!result || result.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = v[i]; });
    return obj;
  });
}

// ========== Auth ==========
app.post('/api/register', authLimiter, (req, res) => {
  try {
    const { username, password, nickname, gender, height, weight } = req.body;
    if (!username || !password) return fail(res, 'Username and password required');
    // 输入验证
    if (typeof username !== 'string' || !/^[\w\u4e00-\u9fa5]{2,20}$/.test(username)) return fail(res, '用户名格式不正确');
    if (typeof password !== 'string' || password.length < 6 || password.length > 50) return fail(res, '密码长度6-50位');
    if (nickname && typeof nickname === 'string' && nickname.length > 20) return fail(res, '昵称过长');
    const cleanName = sanitize(username);
    const cleanNick = sanitize(nickname || '');
    const existing = db.exec("SELECT id FROM users WHERE username = ?", [cleanName]);
    if (existing.length > 0) return fail(res, 'Username already exists');
    const hash = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    db.run("INSERT INTO users (id, username, password, nickname, gender, height, weight, avatar_initial) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, cleanName, hash, cleanNick, sanitize(gender || ''), height || 0, weight || 0, (cleanNick || cleanName).charAt(0)]);
    saveDB();
    ok(res, { token: id, user: { id, username: cleanName, nickname: cleanNick, avatar_initial: (cleanNick || cleanName).charAt(0), avatar_color: '#DCFCE7', gender: sanitize(gender || ''), height: height || 0, weight: weight || 0 } }, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/login', authLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return fail(res, 'Username and password required');
    const cleanName = sanitize(username);
    const rows = db.exec("SELECT id, username, password, nickname, avatar_color, avatar_initial, avatar_url, gender, height, weight, bio FROM users WHERE username = ?", [cleanName]);
    if (rows.length === 0) return fail(res, 'User not found');
    const r = rows[0].values[0];
    if (!bcrypt.compareSync(password, r[2])) return fail(res, 'Wrong password');
    ok(res, { token: r[0], user: { id: r[0], username: r[1], nickname: r[3], avatar_color: r[4], avatar_initial: r[5], avatar_url: r[6], gender: r[7], height: r[8], weight: r[9], bio: r[10] } });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/profile/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT id, username, nickname, avatar_color, avatar_initial, avatar_url, gender, height, weight, bio FROM users WHERE id = ?", [req.params.userId]);
    if (rows.length === 0) return fail(res, 'User not found', 404);
    ok(res, { user: getUserFields(rows[0].values[0]) });
  } catch (e) { fail(res, e.message, 500); }
});

app.put('/api/profile/:userId', (req, res) => {
  try {
    const { nickname, gender, age, height, weight, bio, avatar_color, avatar_url } = req.body;
    console.log('[PROFILE] Saving:', JSON.stringify({ nickname, gender, age, height, weight, bio, avatar_color, avatar_url }));
    db.run("UPDATE users SET nickname=?, gender=?, height=?, weight=?, bio=?, avatar_color=?, avatar_url=?, updated_at=datetime('now') WHERE id=?",
      [nickname, gender, height, weight, bio, avatar_color || null, avatar_url || null, req.params.userId]);
    saveDB();
    ok(res, {});
  } catch (e) { console.error('[PROFILE ERROR]', e.message); fail(res, e.message, 500); }
});

app.post('/api/profile/:userId/avatar', upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return fail(res, 'No file');
    const url = '/uploads/' + req.file.filename;
    db.run("UPDATE users SET avatar_url=?, updated_at=datetime('now') WHERE id=?", [url, req.params.userId]);
    saveDB();
    ok(res, { avatar_url: url });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/change-password', (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    if (!userId || !oldPassword || !newPassword) return fail(res, 'Missing fields');
    if (newPassword.length < 6) return fail(res, 'Password at least 6 chars');
    const rows = db.exec("SELECT password FROM users WHERE id = ?", [userId]);
    if (rows.length === 0) return fail(res, 'User not found');
    if (!bcrypt.compareSync(oldPassword, rows[0].values[0][0])) return fail(res, 'Wrong old password');
    db.run("UPDATE users SET password=?, updated_at=datetime('now') WHERE id=?", [bcrypt.hashSync(newPassword, 10), userId]);
    saveDB();
    ok(res, {});
  } catch (e) { fail(res, e.message, 500); }
});

// Delete account and all related data
app.delete('/api/account/:userId', (req, res) => {
  try {
    const uid = req.params.userId;
    const pw = req.body.password || '';
    if (!pw) return fail(res, 'Password required');
    const rows = db.exec("SELECT password FROM users WHERE id=?", [uid]);
    if (rows.length === 0) return fail(res, 'User not found');
    if (!bcrypt.compareSync(pw, rows[0].values[0][0])) return fail(res, 'Wrong password');
    // Delete related data (ignore errors for missing tables)
    var tables = ['workouts', 'steps', 'training_plans', 'post_likes', 'posts', 'user_sessions',
      'gps_tracks', 'body_metrics', 'achievements', 'post_comments', 'user_xp',
      'daily_challenges', 'check_ins', 'follows', 'notifications', 'messages',
      'friends', 'friend_requests'];
    tables.forEach(function(t) {
      try { db.run("DELETE FROM " + t + " WHERE user_id=?", [uid]); } catch(e) {}
    });
    db.run("DELETE FROM users WHERE id=?", [uid]);
    saveDB();
    ok(res, { deleted: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/settings/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT theme, language FROM users WHERE id=?", [req.params.userId]);
    if (rows.length === 0) return fail(res, 'User not found');
    const r = rows[0].values[0];
    ok(res, { theme: r[0] || 'light', language: r[1] || 'zh' });
  } catch (e) { fail(res, e.message, 500); }
});

app.put('/api/settings/:userId', (req, res) => {
  try {
    const { theme, language } = req.body;
    if (theme) db.run("UPDATE users SET theme=? WHERE id=?", [theme, req.params.userId]);
    if (language) db.run("UPDATE users SET language=? WHERE id=?", [language, req.params.userId]);
    saveDB();
    ok(res, {});
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Workouts ==========
app.post('/api/workouts', (req, res) => {
  try {
    const { userId, type, name, duration_minutes, duration_seconds, calories_burned, steps, distance_km, heart_rate_avg, heart_rate_max, notes } = req.body;
    const id = uuidv4();
    const durSec = (duration_minutes || 0) * 60 + (duration_seconds || 0);
    db.run("INSERT INTO workouts (id, user_id, type, name, duration_minutes, duration_seconds, calories_burned, steps, distance_km, heart_rate_avg, heart_rate_max, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, userId, type, name, duration_minutes || 0, duration_seconds || 0, calories_burned || 0, steps || 0, distance_km || 0, heart_rate_avg || 0, heart_rate_max || 0, notes || '']);
    saveDB();
    ok(res, { workout: { id, type, name, duration_minutes: Math.floor(durSec / 60), calories_burned, steps, distance_km } }, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/workouts/:userId', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const rows = db.exec("SELECT id, type, name, duration_minutes, duration_seconds, calories_burned, steps, distance_km, completed_at FROM workouts WHERE user_id = ? ORDER BY completed_at DESC LIMIT ? OFFSET ?",
      [req.params.userId, limit, offset]);
    const workouts = (rows.length > 0 ? rows[0].values : []).map(r => ({
      id: r[0], type: r[1], name: r[2], duration_minutes: r[3] + Math.floor(r[4] / 60),
      calories_burned: r[5], steps: r[6], distance_km: r[7], completed_at: r[8]
    }));
    ok(res, { workouts });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/workouts/:userId/today', (req, res) => {
  try {
    const rows = db.exec("SELECT id, type, name, duration_minutes, duration_seconds, calories_burned, steps, distance_km, completed_at FROM workouts WHERE user_id = ? AND date(completed_at) = date('now') ORDER BY completed_at DESC",
      [req.params.userId]);
    const workouts = (rows.length > 0 ? rows[0].values : []).map(r => ({
      id: r[0], type: r[1], name: r[2], duration_minutes: r[3] + Math.floor(r[4] / 60),
      calories_burned: r[5], steps: r[6], distance_km: r[7], completed_at: r[8]
    }));
    ok(res, { workouts });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/workouts/:userId/stats', (req, res) => {
  try {
    const uid = req.params.userId;
    const totalRows = db.exec("SELECT COUNT(*), COALESCE(SUM(duration_minutes*60+duration_seconds),0), COALESCE(SUM(calories_burned),0), COALESCE(SUM(steps),0), COALESCE(SUM(distance_km),0) FROM workouts WHERE user_id = ?", [uid]);
    const t = totalRows.length > 0 ? totalRows[0].values[0] : [0, 0, 0, 0, 0];
    // Streak
    const streakRows = db.exec("SELECT DISTINCT date(completed_at) as d FROM workouts WHERE user_id = ? ORDER BY d DESC", [uid]);
    let streak = 0;
    if (streakRows.length > 0) {
      const dates = streakRows[0].values.map(r => r[0]);
      const todayStr = today();
      if (dates[0] === todayStr || (new Date(dates[0]).getTime() + 86400000 === new Date(todayStr).getTime())) {
        streak = 1;
        for (let i = 1; i < dates.length; i++) {
          if (new Date(dates[i - 1]).getTime() - new Date(dates[i]).getTime() === 86400000) streak++;
          else break;
        }
      }
    }
    ok(res, { stats: { totalWorkouts: t[0], totalDurationMin: Math.floor(t[1] / 60), totalCalories: t[2], totalSteps: t[3], totalDistance: t[4], streak } });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== GPS Tracks ==========
app.post('/api/tracks', (req, res) => {
  try {
    const { workoutId, userId, points } = req.body;
    if (!points || !Array.isArray(points) || points.length === 0) return fail(res, 'No track points');
    const stmt = db.prepare("INSERT INTO gps_tracks (id, workout_id, user_id, latitude, longitude, altitude, accuracy, speed, timestamp) VALUES (?,?,?,?,?,?,?,?,?)");
    points.forEach(p => stmt.run([uuidv4(), workoutId, userId, p.lat, p.lng, p.alt || 0, p.acc || 0, p.speed || 0, p.time || new Date().toISOString()]));
    saveDB();
    ok(res, { saved: points.length });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/tracks/:workoutId', (req, res) => {
  try {
    const rows = db.exec("SELECT latitude, longitude, altitude, speed, timestamp FROM gps_tracks WHERE workout_id = ? ORDER BY timestamp", [req.params.workoutId]);
    const points = rows.length > 0 ? rows[0].values.map(r => ({ lat: r[0], lng: r[1], alt: r[2], speed: r[3], time: r[4] })) : [];
    ok(res, { points });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Step Records ==========
app.post('/api/steps', (req, res) => {
  try {
    const { userId, steps, distance_km, calories, record_date } = req.body;
    const id = uuidv4();
    const date = record_date || today();
    // Upsert: update if exists for same user+date
    const existing = db.exec("SELECT id FROM step_records WHERE user_id = ? AND record_date = ?", [userId, date]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      db.run("UPDATE step_records SET steps=?, distance_km=?, calories=? WHERE id=?", [steps, distance_km, calories, existing[0].values[0][0]]);
    } else {
      db.run("INSERT INTO step_records (id, user_id, steps, distance_km, calories, record_date) VALUES (?,?,?,?,?,?)", [id, userId, steps, distance_km, calories, date]);
    }
    saveDB();
    ok(res, {});
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/steps/:userId', (req, res) => {
  try {
    const date = req.query.date || today();
    const rows = db.exec("SELECT steps, distance_km, calories FROM step_records WHERE user_id = ? AND record_date = ?", [req.params.userId, date]);
    if (rows.length > 0 && rows[0].values.length > 0) {
      ok(res, { steps: rows[0].values[0][0], distance_km: rows[0].values[0][1], calories: rows[0].values[0][2] });
    } else {
      ok(res, { steps: 0, distance_km: 0, calories: 0 });
    }
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/steps/:userId/week', (req, res) => {
  try {
    const rows = db.exec("SELECT record_date, steps, distance_km, calories FROM step_records WHERE user_id = ? AND record_date >= date('now', '-7 days') ORDER BY record_date", [req.params.userId]);
    const records = rows.length > 0 ? rows[0].values.map(r => ({ date: r[0], steps: r[1], distance_km: r[2], calories: r[3] })) : [];
    ok(res, { records });
  } catch (e) { fail(res, e.message, 500); }
});

// 本周训练记录（用于活动量柱状图）
app.get('/api/workouts/:userId/week', (req, res) => {
  try {
    const rows = db.exec("SELECT date(completed_at) as workout_date, type, duration_minutes, duration_seconds, calories_burned, steps, distance_km FROM workouts WHERE user_id = ? AND date(completed_at) >= date('now', '-7 days') ORDER BY workout_date", [req.params.userId]);
    const records = rows.length > 0 ? rows[0].values.map(r => ({ date: r[0], type: r[1], duration_minutes: r[2], duration_seconds: r[3], calories_burned: r[4], steps: r[5], distance_km: r[6] })) : [];
    ok(res, { records });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Training Plans ==========
app.post('/api/plans', (req, res) => {
  try {
    const { userId, name, type, difficulty, scheduled_date, scheduled_time, duration_minutes } = req.body;
    const id = uuidv4();
    db.run("INSERT INTO training_plans (id, user_id, name, type, difficulty, scheduled_date, scheduled_time, duration_minutes) VALUES (?,?,?,?,?,?,?,?)",
      [id, userId, name, type, difficulty || 'medium', scheduled_date, scheduled_time || '08:00', duration_minutes || 30]);
    saveDB();
    ok(res, { plan: { id, name, type, scheduled_date } }, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/plans/:userId', (req, res) => {
  try {
    const date = req.query.date;
    let query = "SELECT tp.id, tp.name, tp.type, tp.difficulty, tp.scheduled_date, tp.scheduled_time, tp.duration_minutes, tp.status, w.duration_minutes as actual_min, w.calories_burned FROM training_plans tp LEFT JOIN workouts w ON w.id = (SELECT id FROM workouts WHERE type = tp.type AND user_id = tp.user_id AND date(completed_at) = tp.scheduled_date LIMIT 1) WHERE tp.user_id = ?";
    const params = [req.params.userId];
    if (date) { query += " AND tp.scheduled_date = ?"; params.push(date); }
    query += " ORDER BY tp.scheduled_date, tp.scheduled_time";
    const rows = db.exec(query, params);
    const plans = (rows.length > 0 ? rows[0].values : []).map(r => ({
      id: r[0], name: r[1], type: r[2], difficulty: r[3], scheduled_date: r[4], scheduled_time: r[5], duration_minutes: r[6], status: r[7], actual_duration: r[8] || 0
    }));
    ok(res, { plans });
  } catch (e) { fail(res, e.message, 500); }
});

app.patch('/api/plans/:planId', (req, res) => {
  try {
    const { status } = req.body;
    db.run("UPDATE training_plans SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END WHERE id = ?", [status || 'planned', status || 'planned', req.params.planId]);
    saveDB();
    ok(res, {});
  } catch (e) { fail(res, e.message, 500); }
});

app.delete('/api/plans/:planId', (req, res) => {
  try {
    db.run("DELETE FROM training_plans WHERE id = ?", [req.params.planId]);
    saveDB();
    ok(res, {});
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Body Metrics ==========
app.post('/api/metrics', (req, res) => {
  try {
    const { userId, weight, body_fat, bmi, muscle_mass } = req.body;
    const id = uuidv4();
    db.run("INSERT INTO body_metrics (id, user_id, weight, body_fat, bmi, muscle_mass) VALUES (?,?,?,?,?,?)", [id, userId, weight, body_fat, bmi, muscle_mass]);
    saveDB();
    ok(res, {}, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/metrics/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT weight, body_fat, bmi, muscle_mass, recorded_at FROM body_metrics WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 10", [req.params.userId]);
    const metrics = (rows.length > 0 ? rows[0].values : []).map(r => ({ weight: r[0], body_fat: r[1], bmi: r[2], muscle_mass: r[3], recorded_at: r[4] }));
    ok(res, { metrics });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Community Posts ==========
app.get('/api/posts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.user_id;
    let query, params;
    if (userId) {
      query = `SELECT p.id, p.user_id, p.content, p.image_url, p.video_url, p.workout_type, p.workout_name, p.calories_burned, p.duration_minutes, p.likes_count, p.comments_count, p.created_at, u.username, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url
        FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
      params = [userId, limit, offset];
    } else {
      query = `SELECT p.id, p.user_id, p.content, p.image_url, p.video_url, p.workout_type, p.workout_name, p.calories_burned, p.duration_minutes, p.likes_count, p.comments_count, p.created_at, u.username, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url
        FROM posts p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
      params = [limit, offset];
    }
    const rows = db.exec(query, params);
    const posts = (rows.length > 0 ? rows[0].values : []).map(r => ({
      id: r[0], user_id: r[1], content: r[2], image_url: r[3], video_url: r[4],
      workout_type: r[5], workout_name: r[6], calories_burned: r[7], duration_minutes: r[8],
      likes_count: r[9], comments_count: r[10], created_at: r[11],
      user: { id: r[1], username: r[12], nickname: r[13], avatar_color: r[14], avatar_initial: r[15], avatar_url: r[16] }
    }));
    ok(res, { posts });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/posts', (req, res) => {
  try {
    const { userId, content, image_url, workout_type, workout_name, calories_burned, duration_minutes } = req.body;
    if (!userId || !content) return fail(res, 'Missing fields');
    if (!validateId(userId)) return fail(res, 'Invalid userId');
    if (typeof content !== 'string' || content.length > 2000) return fail(res, 'Content too long');
    const id = uuidv4();
    db.run("INSERT INTO posts (id, user_id, content, image_url, workout_type, workout_name, calories_burned, duration_minutes) VALUES (?,?,?,?,?,?,?,?)",
      [id, userId, sanitize(content), image_url || '', sanitize(workout_type || ''), sanitize(workout_name || ''), calories_burned || 0, duration_minutes || 0]);
    saveDB();
    ok(res, { post: { id } }, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/upload', uploadLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return fail(res, 'No file uploaded');
    const url = '/uploads/' + req.file.filename;
    ok(res, { url });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/posts/:postId/like', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return fail(res, 'Missing userId');
    const existing = db.exec("SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?", [req.params.postId, userId]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      // Unlike
      db.run("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", [req.params.postId, userId]);
      db.run("UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?", [req.params.postId]);
      saveDB();
      const countRow = db.exec("SELECT likes_count FROM posts WHERE id = ?", [req.params.postId]);
      const likesCount = countRow.length > 0 ? countRow[0].values[0][0] : 0;
      ok(res, { liked: false, likes_count: likesCount });
    } else {
      db.run("INSERT INTO post_likes (id, post_id, user_id) VALUES (?,?,?)", [uuidv4(), req.params.postId, userId]);
      db.run("UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?", [req.params.postId]);
      saveDB();
      const countRow = db.exec("SELECT likes_count FROM posts WHERE id = ?", [req.params.postId]);
      const likesCount = countRow.length > 0 ? countRow[0].values[0][0] : 0;
      ok(res, { liked: true, likes_count: likesCount });
    }
  } catch (e) { fail(res, e.message, 500); }
});

app.delete('/api/posts/:postId', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return fail(res, 'Missing userId');
    if (!validateId(req.params.postId)) return fail(res, 'Invalid postId');
    // Verify ownership
    const post = db.exec("SELECT user_id FROM posts WHERE id=?", [req.params.postId]);
    if (post.length === 0) return fail(res, 'Post not found', 404);
    if (post[0].values[0][0] !== userId) return fail(res, 'Not authorized', 403);
    // Delete related data first
    db.run("DELETE FROM post_likes WHERE post_id=?", [req.params.postId]);
    db.run("DELETE FROM post_comments WHERE post_id=?", [req.params.postId]);
    db.run("DELETE FROM posts WHERE id=?", [req.params.postId]);
    saveDB();
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/posts/:postId/comments', (req, res) => {
  try {
    const { userId, content } = req.body;
    if (!userId || !content) return fail(res, 'Missing fields');
    db.run("INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?,?,?,?)", [uuidv4(), req.params.postId, userId, content]);
    db.run("UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?", [req.params.postId]);
    saveDB();
    ok(res, {}, 201);
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/posts/:postId/comments', (req, res) => {
  try {
    const rows = db.exec(`SELECT c.content, c.created_at, u.username, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url
      FROM post_comments c JOIN users u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at`, [req.params.postId]);
    const comments = (rows.length > 0 ? rows[0].values : []).map(r => ({
      content: r[0], created_at: r[1], user: { username: r[2], nickname: r[3], avatar_color: r[4], avatar_initial: r[5], avatar_url: r[6] }
    }));
    ok(res, { comments });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Achievements ==========
app.get('/api/achievements/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT name, icon, color, earned_at FROM achievements WHERE user_id = ?", [req.params.userId]);
    const userAch = rows.length > 0 ? rows[0].values.map(r => ({ name: r[0], icon: r[1], color: r[2], earned_at: r[3] })) : [];
    const sysRows = db.exec("SELECT name, icon, color FROM achievements WHERE user_id = 'SYSTEM'");
    const sysAch = sysRows.length > 0 ? sysRows[0].values.map(r => ({ name: r[0], icon: r[1], color: r[2] })) : [];
    ok(res, { earned: userAch, available: sysAch });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Video Courses (hardcoded curated list) ==========
const COURSES = [
  { id: 'c1', name: '全身燃脂HIIT', type: 'HIIT', difficulty: '中高级', duration: 25, calories: 320, instructor: 'Sarah', desc: '高效全身燃脂，适合有一定基础的训练者', video: 'https://www.youtube.com/embed/ml6cT4AZdqI' },
  { id: 'c2', name: '晨间活力瑜伽', type: '瑜伽', difficulty: '初级', duration: 20, calories: 150, instructor: 'Luna', desc: '温和唤醒身体，提升一天的能量', video: 'https://www.youtube.com/embed/g_tea8ZNkPA' },
  { id: 'c3', name: '核心力量训练', type: '力量', difficulty: '中级', duration: 30, calories: 280, instructor: 'Mike', desc: '针对核心肌群的系统训练', video: 'https://www.youtube.com/embed/R1kvFHZQYnk' },
  { id: 'c4', name: '5公里跑步训练', type: '跑步', difficulty: '中级', duration: 35, calories: 350, instructor: 'Amy', desc: '科学配速指导，轻松完成5公里', video: 'https://www.youtube.com/embed/QLgJQrnviqM' },
  { id: 'c5', name: '睡前拉伸放松', type: '拉伸', difficulty: '初级', duration: 15, calories: 60, instructor: 'Luna', desc: '深度拉伸放松，改善睡眠质量', video: 'https://www.youtube.com/embed/9aVijpIAO6Y' },
  { id: 'c6', name: '上肢塑形训练', type: '力量', difficulty: '中级', duration: 25, calories: 220, instructor: 'Mike', desc: '手臂、肩部、背部综合塑形', video: 'https://www.youtube.com/embed/UBMk30rjy0o' },
  { id: 'c7', name: '有氧搏击操', type: 'HIIT', difficulty: '高级', duration: 30, calories: 400, instructor: 'Sarah', desc: '高能量搏击动作组合，极速燃脂', video: 'https://www.youtube.com/embed/n3wOx2g6J7Q' },
  { id: 'c8', name: '初学者跑步入门', type: '跑步', difficulty: '初级', duration: 20, calories: 200, instructor: 'Amy', desc: '从零开始的跑步训练计划', video: 'https://www.youtube.com/embed/0yXIF-qjTsY' },
];
app.get('/api/courses', (req, res) => ok(res, { courses: COURSES }));
app.get('/api/courses/:id', (req, res) => {
  const course = COURSES.find(c => c.id === req.params.id);
  if (!course) return fail(res, 'Course not found', 404);
  ok(res, { course });
});

// ========== XP & Level System ==========

// Level config: XP needed per level
const LEVEL_CONFIG = [
  { level: 1, title: '运动新手', xpNeeded: 0, frame: 'none' },
  { level: 2, title: '初级运动者', xpNeeded: 100, frame: 'bronze' },
  { level: 3, title: '运动达人', xpNeeded: 300, frame: 'silver' },
  { level: 4, title: '健身达人', xpNeeded: 600, frame: 'gold' },
  { level: 5, title: '运动精英', xpNeeded: 1000, frame: 'platinum' },
  { level: 6, title: '健身高手', xpNeeded: 1500, frame: 'diamond' },
  { level: 7, title: '运动大师', xpNeeded: 2500, frame: 'master' },
  { level: 8, title: '传奇运动员', xpNeeded: 4000, frame: 'legend' },
];

function calcLevel(totalXp) {
  let level = 1;
  for (let i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_CONFIG[i].xpNeeded) { level = LEVEL_CONFIG[i].level; break; }
  }
  return level;
}

// Get user XP info
app.get('/api/xp/:userId', (req, res) => {
  try {
    const row = db.exec("SELECT * FROM user_xp WHERE user_id = ?", [req.params.userId]);
    if (row.length === 0) {
      db.run("INSERT INTO user_xp (id, user_id) VALUES (?, ?)", [uuidv4(), req.params.userId]);
      const fresh = db.exec("SELECT * FROM user_xp WHERE user_id = ?", [req.params.userId]);
      return ok(res, mapRow(fresh, 'user_xp'));
    }
    const data = mapRow(row, 'user_xp');
    data.level_info = LEVEL_CONFIG[calcLevel(data.total_xp) - 1];
    const nextLevel = LEVEL_CONFIG[calcLevel(data.total_xp)];
    if (nextLevel) {
      data.xp_to_next = nextLevel.xpNeeded - data.total_xp;
      data.next_title = nextLevel.title;
    }
    ok(res, data);
  } catch (e) { fail(res, e.message, 500); }
});

// Add XP (called after workout save)
app.post('/api/xp/:userId/add', (req, res) => {
  try {
    const { xp = 0, workout_type = '', distance_km = 0, calories = 0, duration_minutes = 0 } = req.body;
    const existing = db.exec("SELECT * FROM user_xp WHERE user_id = ?", [req.params.userId]);
    let total_xp = 0, total_workouts = 0, total_distance = 0, total_cal = 0, total_dur = 0;
    if (existing.length > 0) {
      const d = mapRow(existing, 'user_xp');
      total_xp = d.total_xp; total_workouts = d.total_workouts;
      total_distance = d.total_distance_km; total_cal = d.total_calories; total_dur = d.total_duration_minutes;
    }
    total_xp += xp; total_workouts += 1;
    total_distance += (distance_km || 0); total_cal += (calories || 0); total_dur += (duration_minutes || 0);
    const newLevel = calcLevel(total_xp);
    const levelInfo = LEVEL_CONFIG[newLevel - 1];
    if (existing.length === 0) {
      db.run("INSERT INTO user_xp (id,user_id,total_xp,level,title,avatar_frame,total_workouts,total_distance_km,total_calories,total_duration_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [uuidv4(), req.params.userId, total_xp, newLevel, levelInfo.title, levelInfo.frame, total_workouts, total_distance, total_cal, total_dur]);
    } else {
      db.run("UPDATE user_xp SET total_xp=?,level=?,title=?,avatar_frame=?,total_workouts=?,total_distance_km=?,total_calories=?,total_duration_minutes=?,updated_at=datetime('now') WHERE user_id=?",
        [total_xp, newLevel, levelInfo.title, levelInfo.frame, total_workouts, total_distance, total_cal, total_dur, req.params.userId]);
    }
    // Update streak
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastDate = existing.length > 0 ? mapRow(existing, 'user_xp').last_workout_date : '';
    let streak = existing.length > 0 ? db.exec("SELECT streak_days FROM user_xp WHERE user_id=?", [req.params.userId])[0].values[0][0] : 0;
    if (lastDate !== todayStr) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      streak = (lastDate === yesterday) ? streak + 1 : 1;
      db.run("UPDATE user_xp SET streak_days=?, last_workout_date=? WHERE user_id=?", [streak, todayStr, req.params.userId]);
    }
    ok(res, { total_xp, level: newLevel, title: levelInfo.title, streak_days: streak, leveled_up: existing.length > 0 && newLevel > mapRow(existing, 'user_xp').level });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Daily Challenge & Check-in ==========

// Get today's challenge
app.get('/api/challenges/:userId', (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const rows = db.exec("SELECT * FROM daily_challenges WHERE user_id=? AND challenge_date=?", [req.params.userId, todayStr]);
    if (rows.length === 0) {
      // Generate today's challenges
      const challenges = [
        { type: 'steps', target: 8000, desc: '步行8000步' },
        { type: 'workout', target: 1, desc: '完成1次训练' },
        { type: 'calories', target: 300, desc: '消耗300千卡' },
      ];
      const results = challenges.map(c => {
        const id = uuidv4();
        db.run("INSERT INTO daily_challenges (id,user_id,challenge_date,challenge_type,target_value,reward_xp) VALUES (?,?,?,?,?,50)",
          [id, req.params.userId, todayStr, c.type, c.target]);
        return { id, challenge_type: c.type, target_value: c.target, current_value: 0, completed: 0, reward_xp: 50, desc: c.desc };
      });
      return ok(res, { date: todayStr, challenges: results });
    }
    ok(res, { date: todayStr, challenges: mapRows(rows, 'daily_challenges') });
  } catch (e) { fail(res, e.message, 500); }
});

// Check in (daily sign-in)
app.post('/api/checkin/:userId', (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const exists = db.exec("SELECT id FROM check_ins WHERE user_id=? AND check_in_date=?", [req.params.userId, todayStr]);
    if (exists.length > 0) return fail(res, '今日已签到', 400);
    db.run("INSERT INTO check_ins (id,user_id,check_in_date,xp_earned) VALUES (?,?,?,?)", [uuidv4(), req.params.userId, todayStr, 10]);
    // Add 10 XP for check-in
    const xpRow = db.exec("SELECT total_xp FROM user_xp WHERE user_id=?", [req.params.userId]);
    const curXp = xpRow.length > 0 ? xpRow[0].values[0][0] : 0;
    const newLvl = calcLevel(curXp + 10);
    const lvlInfo = LEVEL_CONFIG[newLvl - 1];
    if (xpRow.length === 0) {
      db.run("INSERT INTO user_xp (id,user_id,total_xp,level,title,avatar_frame) VALUES (?,?,?,?,?,?)", [uuidv4(), req.params.userId, 10, newLvl, lvlInfo.title, lvlInfo.frame]);
    } else {
      db.run("UPDATE user_xp SET total_xp=total_xp+10,level=?,title=?,avatar_frame=?,updated_at=datetime('now') WHERE user_id=?", [newLvl, lvlInfo.title, lvlInfo.frame, req.params.userId]);
    }
    // Get streak info
    const streakRow = db.exec("SELECT streak_days FROM user_xp WHERE user_id=?", [req.params.userId]);
    const streak = streakRow.length > 0 ? streakRow[0].values[0][0] : 1;
    ok(res, { checked_in: true, xp_earned: 10, total_xp: curXp + 10, streak_days: streak });
  } catch (e) { fail(res, e.message, 500); }
});

// Get check-in calendar (for heatmap)
app.get('/api/checkin/:userId/calendar', (req, res) => {
  try {
    const rows = db.exec("SELECT check_in_date FROM check_ins WHERE user_id=? ORDER BY check_in_date DESC LIMIT 90", [req.params.userId]);
    const dates = rows.length > 0 ? rows[0].values.map(v => v[0]) : [];
    const totalCheckins = dates.length;
    // Calculate max streak
    let maxStreak = 0, cur = 0;
    const sorted = [...dates].sort();
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) { cur = 1; }
      else {
        const prev = new Date(sorted[i-1]), curr = new Date(sorted[i]);
        cur = (curr - prev) === 86400000 ? cur + 1 : 1;
      }
      if (cur > maxStreak) maxStreak = cur;
    }
    // This month count
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    const monthRows = db.exec("SELECT COUNT(*) FROM check_ins WHERE user_id=? AND check_in_date >= ?", [req.params.userId, monthStart]);
    const monthCount = monthRows.length > 0 ? monthRows[0].values[0][0] : 0;
    ok(res, { calendar: dates, totalCheckins, maxStreak, monthCount });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Leaderboard ==========

app.get('/api/leaderboard', (req, res) => {
  try {
    const type = req.query.type || 'total_workouts';
    const validTypes = ['total_workouts', 'total_distance_km', 'total_calories', 'streak_days', 'total_xp'];
    const sortCol = validTypes.includes(type) ? type : 'total_workouts';
    const rows = db.exec(
      "SELECT u.id, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url, x." + sortCol + " as value, x.level, x.title, x.avatar_frame FROM users u LEFT JOIN user_xp x ON u.id=x.user_id ORDER BY x." + sortCol + " DESC LIMIT 50"
    );
    const list = rows.length > 0 ? rows[0].values.map(v => ({
      user_id: v[0], nickname: v[1] || '匿名用户', avatar_color: v[2], avatar_initial: v[3],
      avatar_url: v[4], value: v[5], level: v[6] || 1, title: v[7] || '运动新手', avatar_frame: v[8] || 'none'
    })) : [];
    ok(res, { type: sortCol, leaderboard: list });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Social: Follow ==========

app.post('/api/follow/:userId', (req, res) => {
  try {
    const { target_user_id } = req.body;
    if (!target_user_id || target_user_id === req.params.userId) return fail(res, '无效操作', 400);
    const exists = db.exec("SELECT id FROM follows WHERE follower_id=? AND following_id=?", [req.params.userId, target_user_id]);
    if (exists.length > 0) { db.run("DELETE FROM follows WHERE follower_id=? AND following_id=?", [req.params.userId, target_user_id]); ok(res, { followed: false }); }
    else { db.run("INSERT INTO follows (id,follower_id,following_id) VALUES (?,?,?)", [uuidv4(), req.params.userId, target_user_id]); ok(res, { followed: true }); }
    saveDB();
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/social/:userId', (req, res) => {
  try {
    const followers = db.exec("SELECT COUNT(*) FROM follows WHERE following_id=?", [req.params.userId]);
    const following = db.exec("SELECT COUNT(*) FROM follows WHERE follower_id=?", [req.params.userId]);
    const isFollowing = req.query.target ? db.exec("SELECT id FROM follows WHERE follower_id=? AND following_id=?", [req.params.userId, req.query.target]) : [];
    ok(res, {
      followers: followers.length > 0 ? followers[0].values[0][0] : 0,
      following: following.length > 0 ? following[0].values[0][0] : 0,
      is_following: isFollowing.length > 0
    });
  } catch (e) { fail(res, e.message, 500); }
});

// Get user public profile (for social)
app.get('/api/user/:userId/public', (req, res) => {
  try {
    const u = db.exec("SELECT id,username,nickname,avatar_color,avatar_initial,avatar_url,bio,gender,height,weight,created_at FROM users WHERE id=?", [req.params.userId]);
    if (u.length === 0) return fail(res, '用户不存在', 404);
    const userData = mapRow(u, 'users');
    const xp = db.exec("SELECT level,title,avatar_frame,total_workouts,total_distance_km,total_calories,streak_days FROM user_xp WHERE user_id=?", [req.params.userId]);
    if (xp.length > 0) {
      const xpData = mapRow(xp, 'user_xp');
      Object.assign(userData, xpData);
    }
    const social = db.exec("SELECT COUNT(*) as c FROM follows WHERE following_id=?", [req.params.userId]);
    userData.followers_count = social.length > 0 ? social[0].values[0][0] : 0;
    const fol2 = db.exec("SELECT COUNT(*) as c FROM follows WHERE follower_id=?", [req.params.userId]);
    userData.following_count = fol2.length > 0 ? fol2[0].values[0][0] : 0;
    ok(res, userData);
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Weekly Stats for Charts ==========

app.get('/api/stats/:userId/weekly', (req, res) => {
  try {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = ['日','一','二','三','四','五','六'][d.getDay()];
      const workouts = db.exec("SELECT COUNT(*) FROM workouts WHERE user_id=? AND DATE(completed_at)=?", [req.params.userId, dateStr]);
      const cal = db.exec("SELECT COALESCE(SUM(calories_burned),0) FROM workouts WHERE user_id=? AND DATE(completed_at)=?", [req.params.userId, dateStr]);
      const dist = db.exec("SELECT COALESCE(SUM(distance_km),0) FROM workouts WHERE user_id=? AND DATE(completed_at)=?", [req.params.userId, dateStr]);
      const dur = db.exec("SELECT COALESCE(SUM(duration_minutes),0) FROM workouts WHERE user_id=? AND DATE(completed_at)=?", [req.params.userId, dateStr]);
      days.push({
        date: dateStr, day: '周' + dayLabel,
        workouts: workouts.length > 0 ? workouts[0].values[0][0] : 0,
        calories: cal.length > 0 ? cal[0].values[0][0] : 0,
        distance: parseFloat((dist.length > 0 ? dist[0].values[0][0] : 0).toFixed(2)),
        duration: dur.length > 0 ? dur[0].values[0][0] : 0
      });
    }
    // Weekly totals
    const weekTotal = {
      total_workouts: days.reduce((s,d) => s+d.workouts, 0),
      total_calories: days.reduce((s,d) => s+d.calories, 0),
      total_distance: parseFloat(days.reduce((s,d) => s+d.distance, 0).toFixed(2)),
      total_duration: days.reduce((s,d) => s+d.duration, 0)
    };
    // Type distribution
    const types = db.exec("SELECT type, COUNT(*) as cnt, SUM(calories_burned) as cal FROM workouts WHERE user_id=? AND completed_at >= datetime('now','-7 days') GROUP BY type", [req.params.userId]);
    const typeDist = types.length > 0 ? types[0].values.map(v => ({type:v[0], count:v[1], calories:v[2]})) : [];
    ok(res, { days, week_total: weekTotal, type_distribution: typeDist });
  } catch (e) { fail(res, e.message, 500); }
});

// Get recent activities (for feed)
app.get('/api/feed', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const posts = db.exec(
      "SELECT p.id, p.user_id, p.content, p.image_url, p.workout_type, p.calories_burned, p.duration_minutes, p.likes_count, p.comments_count, p.created_at, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url FROM posts p JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );
    const feed = posts.length > 0 ? posts[0].values.map(v => ({
      id: v[0], user_id: v[1], content: v[2], image_url: v[3],
      workout_type: v[4], calories_burned: v[5], duration_minutes: v[6],
      likes_count: v[7], comments_count: v[8], created_at: v[9],
      author: { id: v[1], nickname: v[10], avatar_color: v[11], avatar_initial: v[12], avatar_url: v[13] }
    })) : [];
    ok(res, { feed, has_more: feed.length === limit });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Friend Requests ==========
app.post('/api/friends/request', (req, res) => {
  try {
    const { from_user_id, to_user_id } = req.body;
    if (!from_user_id || !to_user_id) return fail(res, 'Missing fields');
    if (from_user_id === to_user_id) return fail(res, 'Cannot add self');
    // Check if already friends
    const exists = db.exec("SELECT id FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)", [from_user_id, to_user_id, to_user_id, from_user_id]);
    if (exists.length > 0) return ok(res, { message: 'Already friends' });
    // Check if request already exists
    const pending = db.exec("SELECT id, status FROM friend_requests WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)", [from_user_id, to_user_id, to_user_id, from_user_id]);
    if (pending.length > 0) {
      const st = pending[0].values[0][1];
      if (st === 'pending') return ok(res, { message: 'Request pending' });
      // If rejected, allow re-send
      db.run("DELETE FROM friend_requests WHERE id=?", [pending[0].values[0][0]]);
    }
    db.run("INSERT INTO friend_requests (id,from_user_id,to_user_id) VALUES (?,?,?)", [uuidv4(), from_user_id, to_user_id]);
    // Create notification (using existing table columns: from_user_id, content)
    db.run("INSERT INTO notifications (id,user_id,type,from_user_id,content) VALUES (?,?,?,?,?)", 
      [uuidv4(), to_user_id, 'friend_request', from_user_id, '请求添加你为好友']);
    saveDB();
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/friends/accept', (req, res) => {
  try {
    const { request_id, from_user_id, to_user_id } = req.body;
    if (!from_user_id || !to_user_id) return fail(res, 'Missing fields');
    db.run("UPDATE friend_requests SET status='accepted' WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)", [from_user_id, to_user_id, to_user_id, from_user_id]);
    db.run("INSERT OR IGNORE INTO friends (id,user_id,friend_id) VALUES (?,?,?)", [uuidv4(), from_user_id, to_user_id]);
    db.run("INSERT OR IGNORE INTO friends (id,user_id,friend_id) VALUES (?,?,?)", [uuidv4(), to_user_id, from_user_id]);
    saveDB();
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/friends/reject', (req, res) => {
  try {
    const { from_user_id, to_user_id } = req.body;
    if (!from_user_id || !to_user_id) return fail(res, 'Missing fields');
    db.run("UPDATE friend_requests SET status='rejected' WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)", [from_user_id, to_user_id, to_user_id, from_user_id]);
    saveDB();
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/friends/check', (req, res) => {
  try {
    const userId = req.query.user_id;
    const targetId = req.query.target_id;
    if (!userId || !targetId) return ok(res, { is_friend: false, status: 'none' });
    const f = db.exec("SELECT id FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)", [userId, targetId, targetId, userId]);
    if (f.length > 0) return ok(res, { is_friend: true, status: 'friends' });
    const req2 = db.exec("SELECT status FROM friend_requests WHERE (from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?)", [userId, targetId, targetId, userId]);
    if (req2.length > 0) return ok(res, { is_friend: false, status: req2[0].values[0][0] });
    ok(res, { is_friend: false, status: 'none' });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/friends/requests/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const rows = db.exec("SELECT fr.id, fr.from_user_id, fr.created_at, u.nickname, u.avatar_color, u.avatar_initial FROM friend_requests fr JOIN users u ON fr.from_user_id = u.id WHERE fr.to_user_id=? AND fr.status='pending'", [userId]);
    const requests = rows.length > 0 ? rows[0].values.map(r => ({ id: r[0], from_user_id: r[1], created_at: r[2], nickname: r[3], avatar_color: r[4], avatar_initial: r[5] })) : [];
    ok(res, { requests });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/friends/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const rows = db.exec("SELECT u.id, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url FROM friends f JOIN users u ON f.friend_id = u.id WHERE f.user_id=?", [userId]);
    const friends = rows.length > 0 ? rows[0].values.map(r => ({ id: r[0], nickname: r[1], avatar_color: r[2], avatar_initial: r[3], avatar_url: r[4] })) : [];
    ok(res, { friends });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/following/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT u.id, u.nickname, u.avatar_color, u.avatar_initial, u.avatar_url FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id=?", [req.params.userId]);
    const following = rows.length > 0 ? rows[0].values.map(r => ({ id: r[0], nickname: r[1], avatar_color: r[2], avatar_initial: r[3], avatar_url: r[4] })) : [];
    ok(res, { following });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Notifications ==========
app.get('/api/notifications/:userId', (req, res) => {
  try {
    const rows = db.exec("SELECT n.id, n.type, n.from_user_id, n.content, n.is_read, n.created_at, u.nickname, u.avatar_color, u.avatar_initial FROM notifications n LEFT JOIN users u ON n.from_user_id = u.id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 50", [req.params.userId]);
    const notifications = rows.length > 0 ? rows[0].values.map(r => ({ id: r[0], type: r[1], actor_id: r[2], message: r[3], is_read: r[4], created_at: r[5], actor: r[6] ? { nickname: r[6], avatar_color: r[7], avatar_initial: r[8] } : null })) : [];
    ok(res, { notifications });
  } catch (e) { fail(res, e.message, 500); }
});

app.get('/api/notifications/:userId/unread-count', (req, res) => {
  try {
    const rows = db.exec("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0", [req.params.userId]);
    const count = rows.length > 0 ? rows[0].values[0][0] : 0;
    // Also count unread messages
    const msgRows = db.exec("SELECT COUNT(DISTINCT sender_id) FROM messages WHERE receiver_id=? AND is_read=0", [req.params.userId]);
    const msgCount = msgRows.length > 0 ? msgRows[0].values[0][0] : 0;
    ok(res, { total: count + msgCount, notifications: count, messages: msgCount });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/notifications/read/:userId', (req, res) => {
  try {
    db.run("UPDATE notifications SET is_read=1 WHERE user_id=?", [req.params.userId]);
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

// Mark messages as read
app.post('/api/chat/messages/read', (req, res) => {
  try {
    const { sender_id, receiver_id } = req.body;
    if (!sender_id || !receiver_id) return fail(res, 'Missing fields');
    db.run("UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND is_read=0", [sender_id, receiver_id]);
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/chat/messages/read-all/:userId', (req, res) => {
  try {
    db.run("UPDATE messages SET is_read=1 WHERE receiver_id=? AND is_read=0", [req.params.userId]);
    ok(res, { success: true });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Start ==========
initDB().then(() => {
  // Chat: messages table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), is_read INTEGER DEFAULT 0,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  )`);
  // Add is_read column if missing (for existing databases)
  try { db.run("ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0"); } catch(e) {}

  // 用户会话表（单点登录检测）
  db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    user_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, device_info TEXT DEFAULT '',
    login_time TEXT DEFAULT (datetime('now')), last_active TEXT DEFAULT (datetime('now'))
  )`);

  // ========== 单点登录 API ==========
  // 检测用户是否已在其他设备登录
  app.get('/api/session/check/:userId', (req, res) => {
    try {
      const uid = req.params.userId;
      if (!validateId(uid)) return fail(res, 'Invalid user id', 400);
      const rows = db.exec("SELECT session_id, device_info, login_time FROM user_sessions WHERE user_id = ?", [uid]);
      if (rows.length === 0) return ok(res, { online: false });
      const r = rows[0].values[0];
      ok(res, { online: true, session_id: r[0], device_info: r[1], login_time: r[2] });
    } catch (e) { fail(res, e.message, 500); }
  });

  // 检测当前 session 是否已被踢下线
  app.get('/api/session/kicked/:userId/:sessionId', (req, res) => {
    try {
      const uid = req.params.userId;
      const sid = req.params.sessionId;
      if (!validateId(uid)) return ok(res, { kicked: false });
      const rows = db.exec("SELECT session_id FROM user_sessions WHERE user_id = ?", [uid]);
      if (rows.length === 0) return ok(res, { kicked: true }); // 没有记录说明已被清除
      if (rows[0].values[0][0] !== sid) return ok(res, { kicked: true });
      ok(res, { kicked: false });
    } catch (e) { fail(res, e.message, 500); }
  });

  // 强制登录（踢掉旧 session）
  app.post('/api/session/force-login', (req, res) => {
    try {
      const { userId, sessionId, deviceInfo } = req.body;
      if (!userId || !sessionId) return fail(res, 'Missing fields', 400);
      const info = deviceInfo || '';
      // 先查旧 session
      const oldRows = db.exec("SELECT session_id FROM user_sessions WHERE user_id = ?", [userId]);
      const oldSessionId = oldRows.length > 0 ? oldRows[0].values[0][0] : null;
      // 写入新 session（REPLACE 实现覆盖）
      db.run("REPLACE INTO user_sessions (user_id, session_id, device_info, login_time, last_active) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
        [userId, sessionId, info]);
      saveDB();
      ok(res, { success: true, kicked_old: !!oldSessionId, old_session_id: oldSessionId });
    } catch (e) { fail(res, e.message, 500); }
  });

  // 主动登出（清除 session）
  app.post('/api/session/logout', (req, res) => {
    try {
      const { userId, sessionId } = req.body;
      if (!userId) return fail(res, 'Missing userId', 400);
      db.run("DELETE FROM user_sessions WHERE user_id = ? AND session_id = ?", [userId, sessionId || '']);
      if (!sessionId) db.run("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
      saveDB();
      ok(res, { success: true });
    } catch (e) { fail(res, e.message, 500); }
  });

  // ========== 在线用户列表（社区/好友页用） ==========
  app.get('/api/session/online-users', (req, res) => {
    try {
      const rows = db.exec("SELECT user_id, device_info FROM user_sessions");
      const list = rows.length > 0 ? rows[0].values.map(function(v) { return { user_id: v[0], device_info: v[1] }; }) : [];
      ok(res, { online_users: list });
    } catch (e) { fail(res, e.message, 500); }
  });

  // Clear all data (dev/admin)
app.delete('/api/admin/clear-all', (req, res) => {
  try {
    ['workouts','gps_tracks','steps','training_plans','body_metrics','achievements','post_likes','post_comments','posts','user_xp','daily_challenges','check_ins','follows','notifications','messages','friends','friend_requests','user_sessions','users'].forEach(function(t) {
      try { db.run("DELETE FROM " + t); } catch(e) {}
    });
    saveDB();
    ok(res, { cleared: true });
  } catch (e) { fail(res, e.message, 500); }
});

// ========== Chat API ==========
// Get messages between two users
app.get('/api/chat/messages', (req, res) => {
  try {
    const { uid1, uid2 } = req.query;
    if (!uid1 || !uid2) return fail(res, 'Missing uid1 or uid2', 400);
    if (!validateId(uid1) || !validateId(uid2)) return fail(res, 'Invalid user id', 400);
    const rows = db.exec(
      "SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, u.nickname, u.avatar_initial, u.avatar_color, u.avatar_url FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) ORDER BY m.created_at ASC",
      [uid1, uid2, uid2, uid1]
    );
    const messages = rows.length > 0 ? rows[0].values.map(r => ({
      id: r[0], sender_id: r[1], receiver_id: r[2], content: r[3], created_at: r[4],
      sender_nickname: r[5], sender_avatar_initial: r[6], sender_avatar_color: r[7], sender_avatar_url: r[8]
    })) : [];
    ok(res, { messages });
  } catch (e) { fail(res, e.message, 500); }
});

// Send a message
app.post('/api/chat/messages', (req, res) => {
  try {
    const { sender_id, receiver_id, content } = req.body;
    if (!sender_id || !receiver_id || !content) return fail(res, 'Missing fields', 400);
    if (!validateId(sender_id) || !validateId(receiver_id)) return fail(res, 'Invalid user id', 400);
    if (typeof content !== 'string' || content.trim().length === 0 || content.length > 2000) return fail(res, 'Message content invalid (1-2000 chars)', 400);
    const cleanContent = sanitize(content.trim());
    const id = uuidv4();
    db.run("INSERT INTO messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)",
      [id, sender_id, receiver_id, cleanContent]);
    // 同时为收件人创建一条通知
    const senderRows = db.exec("SELECT nickname FROM users WHERE id = ?", [sender_id]);
    const senderName = (senderRows.length > 0 && senderRows[0].values.length > 0) ? senderRows[0].values[0][0] : '用户';
    const notifId = uuidv4();
    db.run("INSERT INTO notifications (id, user_id, type, from_user_id, content) VALUES (?, ?, ?, ?, ?)",
      [notifId, receiver_id, 'message', sender_id, senderName + '：' + (cleanContent.length > 30 ? cleanContent.substring(0, 30) + '...' : cleanContent)]);
    saveDB();
    ok(res, { message: { id, sender_id, receiver_id, content: cleanContent, created_at: new Date().toISOString() } }, 201);
  } catch (e) { fail(res, e.message, 500); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('SportLife v2.1 server started at http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
