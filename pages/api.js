/**
 * SportLife API 工具模块
 * 所有页面通过此模块与后端通信
 */
const API_BASE = '/api';

// ========== 通用工具 ==========

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('sportlife_user'));
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem('sportlife_user', JSON.stringify(user));
}

function clearCurrentUser() {
  localStorage.removeItem('sportlife_user');
}

function isLoggedIn() {
  return !!getCurrentUser();
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

function logout() {
  clearCurrentUser();
  window.location.href = 'login.html';
}

async function request(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('API request failed:', err);
    return { success: false, error: '网络连接失败，请检查服务器是否启动' };
  }
}

// ========== Toast 通知 ==========

function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-100px);
    padding: 12px 24px; border-radius: 10px; color: white; font-size: 14px;
    z-index: 10000; transition: transform 0.3s ease; font-family: Inter, sans-serif;
    max-width: 90vw; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: ${type === 'error' ? '#EF4444' : type === 'success' ? '#22C55E' : '#3B82F6'};
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(-100px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ========== Auth API ==========

const AuthAPI = {
  async register(data) {
    return request('/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  async login(username, password) {
    return request('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },
  async getProfile(userId) {
    return request('/profile/' + userId);
  }
};

// ========== Workout API ==========

const WorkoutAPI = {
  async create(data) {
    return request('/workouts', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  async getHistory(userId, limit = 10, offset = 0) {
    return request(`/workouts/${userId}?limit=${limit}&offset=${offset}`);
  },
  async getToday(userId) {
    return request(`/workouts/${userId}/today`);
  },
  async getStats(userId) {
    return request(`/workouts/${userId}/stats`);
  }
};

// ========== Training Plan API ==========

const PlanAPI = {
  async create(data) {
    return request('/plans', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  async getByUser(userId, date) {
    const q = date ? `?date=${date}` : '';
    return request(`/plans/${userId}${q}`);
  },
  async update(planId, data) {
    return request(`/plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }
};

// ========== Body Metrics API ==========

const MetricsAPI = {
  async create(data) {
    return request('/metrics', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  async getLatest(userId) {
    return request(`/metrics/${userId}`);
  }
};

// ========== Achievement API ==========

const AchievementAPI = {
  async getByUser(userId) {
    return request(`/achievements/${userId}`);
  }
};

// ========== 页面底部通用脚本 ==========

function initAppShell() {
  // 如果未登录且不在登录/注册页，跳转登录
  const currentPage = window.location.pathname.split('/').pop();
  if (!isLoggedIn() && !['login.html', 'register.html'].includes(currentPage)) {
    window.location.href = 'login.html';
    return false;
  }

  const user = getCurrentUser();
  if (user) {
    // 更新页面中的用户名显示
    document.querySelectorAll('[data-user-nickname]').forEach(el => {
      el.textContent = user.nickname || user.username;
    });
    document.querySelectorAll('[data-user-avatar-initial]').forEach(el => {
      el.textContent = (user.nickname || user.username).charAt(0);
    });
    document.querySelectorAll('[data-user-avatar-color]').forEach(el => {
      el.style.background = user.avatar_color || '#DCFCE7';
    });
  }
  return true;
}
