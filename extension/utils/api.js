// ============================================================
// 钓鱼网站智能预警系统 - API 请求封装模块
// 职责：统一请求头注入、响应解析、错误处理
// 暴露：globalThis.PluginAPI
// 依赖：utils/storage.js（取 deviceId 与 apiBaseUrl）
// ============================================================

// ============== 1. 接口路径常量 ==============
const API_ENDPOINTS = {
  DETECT: '/api/plugin/detect',          // 提交 URL 检测
  CACHE: '/api/plugin/cache',            // 查询检测缓存
  FEEDBACK: '/api/plugin/feedback',      // 提交用户反馈
  HISTORY: '/api/plugin/history',        // 查询检测历史
  STATISTICS: '/api/plugin/statistics',  // 获取检测统计
  CONFIG: '/api/plugin/config',          // 获取云端配置
  CONFIG_SYNC: '/api/plugin/config/sync' // 同步本地配置
};

// ============== 2. 插件版本号 ==============
// chrome.runtime.getManifest 在 service worker / popup / options 中均可用
function _getPluginVersion() {
  try {
    return chrome.runtime.getManifest().version || 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

const PLUGIN_VERSION = _getPluginVersion();

// ============== 3. 依赖解析 ==============
// 优先使用已加载的 PluginStorage；若未加载则内联最小实现（避免硬依赖）
const _Storage = (typeof PluginStorage !== 'undefined')
  ? PluginStorage
  : null;

async function _getDeviceId() {
  if (_Storage?.getDeviceId) return await _Storage.getDeviceId();
  // 回退：直接读取 storage.local
  const result = await chrome.storage.local.get('deviceId');
  if (result.deviceId) return result.deviceId;
  // 不在此处生成，避免与 storage 模块逻辑分裂
  return null;
}

async function _getApiBaseUrl() {
  if (_Storage?.getLocalConfig) {
    const cfg = await _Storage.getLocalConfig();
    return cfg.apiBaseUrl || 'http://localhost:8080';
  }
  const result = await chrome.storage.local.get('pluginConfig');
  return result.pluginConfig?.apiBaseUrl || 'http://localhost:8080';
}

// ============== 4. 通用请求封装 ==============

/**
 * 通用 API 请求函数
 * @param {string} method HTTP 方法（GET/POST/PUT/DELETE）
 * @param {string} path 接口路径（如 /api/plugin/detect）
 * @param {object} [data] 请求数据：GET 时作为 query 参数，其他方法作为 body
 * @param {object} [options] 额外配置
 * @param {object} [options.headers] 额外请求头
 * @param {number} [options.timeout=15000] 超时时间（ms）
 * @param {boolean} [options.skipDeviceId=false] 是否跳过 X-Device-ID 注入
 * @returns {Promise<object>} 解析后的响应 JSON
 * @throws {Error} 网络异常、HTTP 错误、业务错误时抛出可读错误
 */
async function apiRequest(method, path, data = null, options = {}) {
  const {
    headers = {},
    timeout = 15000,
    skipDeviceId = false
  } = options;

  const baseUrl = await _getApiBaseUrl();
  const url = _buildUrl(baseUrl + path, method, data);

  // 统一注入请求头
  const finalHeaders = {
    'Content-Type': 'application/json',
    'X-Plugin-Version': PLUGIN_VERSION,
    ...headers
  };
  if (!skipDeviceId) {
    const deviceId = await _getDeviceId();
    if (deviceId) finalHeaders['X-Device-ID'] = deviceId;
  }

  // fetch 超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(url, {
      method: method.toUpperCase(),
      headers: finalHeaders,
      body: _buildBody(method, data),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`请求超时（${timeout}ms）：${path}`);
    }
    throw new Error(`网络请求失败：${err.message}`);
  }
  clearTimeout(timer);

  // 解析响应
  let json;
  try {
    json = await response.json();
  } catch (e) {
    throw new Error(`响应解析失败：HTTP ${response.status}`);
  }

  // HTTP 状态码错误
  if (!response.ok) {
    const msg = json?.msg || json?.message || `HTTP ${response.status}`;
    throw new Error(`[${response.status}] ${msg}`);
  }

  // 业务状态码错误（约定 code !== 200 为失败）
  if (json && typeof json.code === 'number' && json.code !== 200) {
    const msg = json.msg || json.message || `业务错误：code=${json.code}`;
    throw new Error(`[code=${json.code}] ${msg}`);
  }

  return json;
}

/**
 * 构造请求 URL（GET/HEAD 方法时拼接 query string）
 */
function _buildUrl(fullUrl, method, data) {
  if (!data) return fullUrl;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') {
    const qs = new URLSearchParams(
      Object.entries(data)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
    ).toString();
    return qs ? `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${qs}` : fullUrl;
  }
  return fullUrl;
}

/**
 * 构造请求 body（非 GET 方法）
 */
function _buildBody(method, data) {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || !data) return undefined;
  return JSON.stringify(data);
}

// ============== 5. 业务 API 方法封装 ==============

/**
 * 提交 URL 检测
 * @param {{url:string, title?:string, html?:string, text?:string, domain?:string}} pageInfo
 * @returns {Promise<object>} 检测结果 { code, data: { level, score, desc, feature } }
 */
async function detectUrl(pageInfo) {
  if (!pageInfo?.url) {
    throw new Error('detectUrl: 缺少 url 参数');
  }
  return await apiRequest('POST', API_ENDPOINTS.DETECT, {
    url: pageInfo.url,
    title: pageInfo.title || '',
    html: pageInfo.html || '',
    text: pageInfo.text || '',
    domain: pageInfo.domain || ''
  });
}

/**
 * 查询检测缓存
 * @param {string} url 待查询的 URL
 * @returns {Promise<object|null>} 命中返回 { code, data }，未命中返回 null
 */
async function checkCache(url) {
  if (!url) throw new Error('checkCache: 缺少 url 参数');
  try {
    const res = await apiRequest('GET', API_ENDPOINTS.CACHE, { url });
    // 兼容两种返回结构：{ hit:true, data } 或 { code:200, data }
    if (res?.hit === true && res.data) return res;
    if (res?.code === 200 && res.data) return res;
    return null;
  } catch (err) {
    // 缓存查询失败视为未命中，不阻塞主流程
    console.warn('[PluginAPI] checkCache 失败，视为未命中:', err.message);
    return null;
  }
}

/**
 * 提交用户反馈
 * @param {string} recordId 检测记录 ID
 * @param {string} feedback 反馈内容（如 'phishing' / 'safe' / 文本）
 * @returns {Promise<object>}
 */
async function submitFeedback(recordId, feedback) {
  if (!recordId) throw new Error('submitFeedback: 缺少 recordId');
  if (!feedback) throw new Error('submitFeedback: 缺少 feedback');
  return await apiRequest('POST', API_ENDPOINTS.FEEDBACK, { recordId, feedback });
}

/**
 * 查询检测历史
 * @param {object} [params] 查询参数
 * @param {number} [params.page=1] 页码
 * @param {number} [params.pageSize=20] 每页条数
 * @param {string} [params.startDate] 起始日期（YYYY-MM-DD）
 * @param {string} [params.endDate] 截止日期（YYYY-MM-DD）
 * @returns {Promise<object>} { code, data: { list, total } }
 */
async function getHistory(params = {}) {
  const query = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20
  };
  if (params.startDate) query.startDate = params.startDate;
  if (params.endDate) query.endDate = params.endDate;
  if (params.url) query.url = params.url;
  return await apiRequest('GET', API_ENDPOINTS.HISTORY, query);
}

/**
 * 获取检测统计
 * @returns {Promise<object>} { code, data: { total, highRisk, midRisk, lowRisk, safe, ... } }
 */
async function getStatistics() {
  return await apiRequest('GET', API_ENDPOINTS.STATISTICS);
}

/**
 * 获取云端配置
 * @returns {Promise<object>} { code, data: {...configs} }
 */
async function getConfig() {
  return await apiRequest('GET', API_ENDPOINTS.CONFIG);
}

/**
 * 同步本地配置到云端
 * @param {object} configs 待同步的配置对象
 * @returns {Promise<object>}
 */
async function syncConfig(configs) {
  if (!configs || typeof configs !== 'object') {
    throw new Error('syncConfig: configs 必须为对象');
  }
  return await apiRequest('POST', API_ENDPOINTS.CONFIG_SYNC, { configs });
}

// ============== 6. 导出 ==============
const PluginAPI = {
  API_ENDPOINTS,
  PLUGIN_VERSION,
  // 通用
  apiRequest,
  // 业务方法
  detectUrl,
  checkCache,
  submitFeedback,
  getHistory,
  getStatistics,
  getConfig,
  syncConfig
};

// 兼容 service worker / popup / options 多环境
if (typeof globalThis !== 'undefined') {
  globalThis.PluginAPI = PluginAPI;
}
if (typeof window !== 'undefined') {
  window.PluginAPI = PluginAPI;
}
if (typeof self !== 'undefined') {
  self.PluginAPI = PluginAPI;
}
