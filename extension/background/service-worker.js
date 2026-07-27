// ============================================================
// 钓鱼网站智能预警系统 - Background Service Worker
// 职责：消息中枢 + API 调用 + 图标状态 + 通知管理
// ============================================================

// ============== 1. 配置常量 ==============
const API_BASE_URL = 'http://localhost:8080';
const API_ENDPOINTS = {
  DETECT: '/api/plugin/detect',
  CACHE: '/api/plugin/cache',
  HISTORY: '/api/plugin/history'
};

const STORAGE_KEYS = {
  DEVICE_ID: 'deviceId',
  SETTINGS: 'settings',
  CACHE: 'detectCache',
  HISTORY: 'detectHistory'
};

// 本地缓存有效期：24 小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 历史记录最大条数
const HISTORY_MAX = 100;

// ============== 2. 通用工具函数 ==============

/**
 * 生成 UUID v4
 */
function generateUUID() {
  // 优先使用原生 API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 回退方案
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取当前激活的标签页
 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * 将风险等级统一规范化为小写简写形式（与现有 popup 兼容）
 * SAFE -> safe, LOW -> low, MEDIUM -> mid, HIGH -> high
 */
function normalizeLevel(level) {
  const l = (level || '').toLowerCase();
  if (l === 'medium') return 'mid';
  return l;
}

/**
 * 从 URL 本地计算基础特征（API 未返回 feature 时作为兜底）
 */
function computeUrlFeatures(url) {
  let isHttps = false;
  let isIp = false;
  let urlLen = 0;
  let subDomainCount = 0;
  try {
    isHttps = url.startsWith('https://');
    const afterProtocol = url.split('//')[1] || '';
    isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(afterProtocol);
    urlLen = url.length;
    const host = afterProtocol.split('/')[0].split(':')[0];
    subDomainCount = Math.max(0, host.split('.').length - 2);
  } catch (e) {
    // 解析失败保持默认值
  }
  return { isHttps, isIp, urlLen, subDomainCount };
}

// ============== 3. 设备 ID 管理 ==============

/**
 * 获取或生成 deviceId（UUID v4），持久化到 local storage
 */
async function getDeviceId() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.DEVICE_ID);
  if (result[STORAGE_KEYS.DEVICE_ID]) {
    return result[STORAGE_KEYS.DEVICE_ID];
  }
  const newId = generateUUID();
  await chrome.storage.local.set({ [STORAGE_KEYS.DEVICE_ID]: newId });
  return newId;
}

// ============== 4. 设置管理 ==============

const DEFAULT_SETTINGS = {
  autoDetect: false,           // 是否开启自动检测
  showNotifications: true,     // 是否弹出高风险通知
  apiBaseUrl: API_BASE_URL     // API 基础地址（可在 options 中修改）
};

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

async function updateSettings(patch = {}) {
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ============== 5. 本地缓存管理（基于 domain，规范结构） ==============
//
// 缓存数据结构（规范）：
// { recordId, riskLevel, riskScore, riskReason, cachedTime, feature? }
// 缓存有效期：24 小时（CACHE_TTL_MS）
// 存储 key：chrome.storage.local.detectCache，内部为 { [domain]: <规范结构> }

/**
 * 从 url 或 domain 字符串中提取 domain
 */
function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return '';
  if (!/^[a-zA-Z]+:\/\//.test(urlOrDomain) && !urlOrDomain.includes('/')) {
    return urlOrDomain;
  }
  try {
    return new URL(urlOrDomain).hostname || '';
  } catch (e) {
    return '';
  }
}

/**
 * 将检测结果规范化为缓存结构
 * 输入支持两种字段命名：recordId/riskLevel/riskScore/riskReason 或 level/score/desc
 */
function toCacheEntry(result) {
  if (!result || typeof result !== 'object') return null;
  const entry = {
    recordId:   result.recordId || result.record_id || '',
    riskLevel:  normalizeLevel(result.riskLevel || result.level || 'safe'),
    riskScore:  typeof result.riskScore === 'number'
                  ? result.riskScore
                  : (typeof result.score === 'number' ? result.score : 0),
    riskReason: result.riskReason || result.desc || result.reason || '',
    cachedTime: Date.now()
  };
  if (result.feature) entry.feature = result.feature;
  return entry;
}

/**
 * 将缓存结构反向转换为 popup 期望的响应格式
 */
function cacheEntryToResult(entry) {
  if (!entry) return null;
  return {
    level:    normalizeLevel(entry.riskLevel),
    score:    entry.riskScore,
    desc:     entry.riskReason,
    feature:  entry.feature || computeUrlFeatures(''),
    recordId: entry.recordId || ''
  };
}

/**
 * 按 domain 读取检测缓存（命中返回规范结构，过期/未命中返回 null）
 * @param {string} domainOrUrl
 */
async function getLocalCache(domainOrUrl) {
  const domain = extractDomain(domainOrUrl);
  if (!domain) return null;
  const result = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  const cache = result[STORAGE_KEYS.CACHE] || {};
  const entry = cache[domain];
  if (!entry) return null;
  // TTL 过期清理
  if (Date.now() - entry.cachedTime > CACHE_TTL_MS) {
    delete cache[domain];
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: cache });
    return null;
  }
  return entry; // 返回规范结构
}

/**
 * 按 domain 写入检测缓存
 * @param {string} domainOrUrl
 * @param {object} result 检测结果（自动规范化）
 */
async function setLocalCache(domainOrUrl, result) {
  const domain = extractDomain(domainOrUrl);
  if (!domain) return;
  const entry = toCacheEntry(result);
  if (!entry) return;
  const result2 = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  const cache = result2[STORAGE_KEYS.CACHE] || {};
  cache[domain] = entry;
  await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: cache });
}

/**
 * 清空所有检测缓存
 */
async function clearLocalCache() {
  await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: {} });
}

// ============== 6. 历史记录管理 ==============

async function addHistory(record) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  const history = result[STORAGE_KEYS.HISTORY] || [];
  history.unshift({ ...record, timestamp: Date.now() });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

async function getLocalHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

// ============== 7. API 调用封装 ==============

/**
 * 查询服务端缓存接口
 * GET /api/plugin/cache?url=xxx
 * 命中返回 { hit: true, data: {...} }，否则 null
 */
async function checkServerCache(url, deviceId) {
  const settings = await getSettings();
  const baseUrl = settings.apiBaseUrl || API_BASE_URL;
  const requestUrl = `${baseUrl}${API_ENDPOINTS.CACHE}?url=${encodeURIComponent(url)}`;
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'X-Device-ID': deviceId,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) return null;
  const json = await response.json();
  // 兼容两种返回结构：{ hit:true, data } 或直接 data
  if (json?.hit && json.data) return json.data;
  if (json?.code === 200 && json.data) return json.data;
  return null;
}

/**
 * 调用检测接口
 * POST /api/plugin/detect
 */
async function callDetectAPI(url, deviceId, pageInfo) {
  const settings = await getSettings();
  const baseUrl = settings.apiBaseUrl || API_BASE_URL;
  // 超时控制：30s（检测可能涉及 LLM 语义分析，给较长时限）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(`${baseUrl}${API_ENDPOINTS.DETECT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId
      },
      body: JSON.stringify({
        url,
        title: pageInfo?.title || '',
        html: pageInfo?.html || '',
        text: pageInfo?.text || '',
        domain: pageInfo?.domain || ''
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('检测请求超时（30s），请稍后重试');
    }
    throw new Error(`网络请求失败：${err.message}`);
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`检测接口请求失败: HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * 本地启发式检测（后端不可用时的 fallback）
 * 基于 URL 特征 + 页面信息进行风险判断，不依赖任何后端服务
 *
 * 评分规则：
 *   - 无 HTTPS 加密         +0.30
 *   - IP 直连访问           +0.30
 *   - URL 含 @ 符号         +0.20（钓鱼常用跳转欺骗）
 *   - URL 长度 > 75         +0.15
 *   - 子域名数量 > 3        +0.15
 *   - 含可疑关键词          +0.25（login/verify/account/free/bank/wallet 等）
 *   - 非 80/443 端口        +0.10
 *   - 含登录表单 + 非 HTTPS  +0.30（极高危组合）
 *   - 域名含可疑字符        +0.15（连字符过多、纯数字域名等）
 *
 * 等级划分：
 *   score >= 0.70 → high（高风险）
 *   score >= 0.40 → mid（中风险）
 *   score >= 0.20 → low（低风险）
 *   其他          → safe（安全）
 *
 * @param {string} url 待检测 URL
 * @param {object} pageInfo 页面信息（可选，来自 content script）
 * @returns {{ code:number, data:{ level:string, score:number, desc:string, feature:object, recordId:string } }}
 */
function mockDetectUrl(url, pageInfo) {
  let score = 0;
  const reasons = [];
  const feature = computeUrlFeatures(url);

  // 1. HTTPS 检查
  if (!feature.isHttps) {
    score += 0.30;
    reasons.push('未使用 HTTPS 加密传输');
  }

  // 2. IP 直连检查
  if (feature.isIp) {
    score += 0.30;
    reasons.push('使用 IP 直连访问（钓鱼常用手法）');
  }

  // 3. URL 含 @ 符号
  if (url.includes('@')) {
    score += 0.20;
    reasons.push('URL 含 @ 符号（可能用于跳转欺骗）');
  }

  // 4. URL 长度
  if (feature.urlLen > 75) {
    score += 0.15;
    reasons.push(`URL 过长（${feature.urlLen} 字符）`);
  }

  // 5. 子域名数量
  if (feature.subDomainCount > 3) {
    score += 0.15;
    reasons.push(`子域名层级过多（${feature.subDomainCount} 层）`);
  }

  // 6. 可疑关键词检查
  const SUSPICIOUS_KEYWORDS = [
    'login', 'signin', 'sign-in', 'verify', 'verification',
    'account', 'update', 'confirm', 'secure', 'security',
    'free', 'gift', 'bonus', 'prize', 'winner',
    'bank', 'paypal', 'alipay', 'wechat', 'apple', 'icloud',
    'wallet', 'crypto', 'bitcoin', 'metamask'
  ];
  const lowerUrl = url.toLowerCase();
  const matchedKeywords = SUSPICIOUS_KEYWORDS.filter(kw => lowerUrl.includes(kw));
  if (matchedKeywords.length > 0) {
    score += 0.25;
    reasons.push(`URL 含可疑关键词：${matchedKeywords.join('、')}`);
  }

  // 7. 非标准端口
  try {
    const port = new URL(url).port;
    if (port && !['80', '443'].includes(port)) {
      score += 0.10;
      reasons.push(`使用非标准端口：${port}`);
    }
  } catch (e) { /* 忽略解析失败 */ }

  // 8. 登录表单 + 非 HTTPS 组合（极高危）
  if (pageInfo?.forms?.hasLoginForm && !feature.isHttps) {
    score += 0.30;
    reasons.push('页面含登录表单且未加密，存在凭证窃取风险');
  }

  // 9. 域名可疑特征：连字符过多 / 纯数字域名
  try {
    const host = new URL(url).hostname;
    const hyphenCount = (host.match(/-/g) || []).length;
    if (hyphenCount >= 3) {
      score += 0.15;
      reasons.push(`域名含过多连字符（${hyphenCount} 个）`);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) === false && /^\d+$/.test(host.split('.')[0])) {
      score += 0.10;
      reasons.push('域名主体为纯数字');
    }
  } catch (e) { /* 忽略解析失败 */ }

  // 限制总分
  score = Math.min(score, 1);

  // 等级判定
  let level;
  if (score >= 0.70) level = 'high';
  else if (score >= 0.40) level = 'mid';
  else if (score >= 0.20) level = 'low';
  else level = 'safe';

  // 拼接描述
  const desc = reasons.length > 0
    ? `【本地诊断】检测到 ${reasons.length} 项风险特征：${reasons.join('；')}。`
    : '【本地诊断】未发现明显风险特征，网站相对安全。';

  return {
    code: 200,
    data: {
      level,
      score,
      desc,
      feature,
      recordId: 'local-' + Date.now()
    }
  };
}

/**
 * 从服务端拉取历史记录
 */
async function fetchHistoryAPI(deviceId) {
  const settings = await getSettings();
  const baseUrl = settings.apiBaseUrl || API_BASE_URL;
  const response = await fetch(`${baseUrl}${API_ENDPOINTS.HISTORY}`, {
    method: 'GET',
    headers: {
      'X-Device-ID': deviceId,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`历史接口请求失败: ${response.status}`);
  return await response.json();
}

// ============== 8. Content Script 通信 ==============

/**
 * 向指定标签页的 Content Script 请求页面信息
 */
function getPageInfoFromContent(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: 'GET_PAGE_INFO', type: 'GET_PAGE_INFO' },
      response => {
        if (chrome.runtime.lastError) {
          // content script 未注入或未响应
          resolve(null);
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * 向 Content Script 发送高风险警告指令
 * 同时带上 type 与 action，兼容现有 content-script.js
 */
function sendShowWarning(tabId, data) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: 'SHOW_WARNING', type: 'SHOW_WARNING', data },
      () => {
        // 忽略错误（content script 可能未注入）
        resolve();
      }
    );
  });
}

// ============== 9. 扩展图标 Badge 管理 ==============

const BADGE_CONFIG = {
  safe: { text: '✓', color: '#67C23A' },  // 绿色
  low: { text: '✓', color: '#67C23A' },  // 绿色
  mid: { text: '!', color: '#E6A23C' },  // 橙色
  high: { text: 'X', color: '#F56C6C' },  // 红色
  idle: { text: '', color: '#909399' }   // 默认灰色
};

/**
 * 根据风险等级更新扩展图标 Badge
 * @param {string|null} level - safe/low/mid/high/null
 */
function updateBadge(level) {
  const cfg = BADGE_CONFIG[level] || BADGE_CONFIG.idle;
  try {
    chrome.action.setBadgeText({ text: cfg.text });
    chrome.action.setBadgeBackgroundColor({ color: cfg.color });
  } catch (e) {
    console.warn('[ServiceWorker] 更新 Badge 失败', e);
  }
}

// ============== 10. 通知管理 ==============

/**
 * 高风险时弹出浏览器通知
 */
async function showHighRiskNotification(url, desc) {
  const settings = await getSettings();
  if (settings.showNotifications === false) return;

  const notifId = `phishing-warning-${Date.now()}`;
  const safeDesc = desc || '该网站存在钓鱼风险特征';
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⚠ 高风险钓鱼网站警告',
    message: `检测到当前网站存在高风险！\n${safeDesc}\n建议立即关闭该页面，不要输入账号密码等敏感信息。`,
    priority: 2,
    requireInteraction: true,
    buttons: [
      { title: '关闭该页面' },
      { title: '我知道了' }
    ]
  });
}

// 通知按钮点击：第一个按钮 → 关闭当前标签页
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  if (buttonIndex === 0) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) chrome.tabs.remove(tabs[0].id);
    });
  }
  chrome.notifications.clear(notifId);
});

// 通知点击 → 关闭通知
chrome.notifications.onClicked.addListener(notifId => {
  chrome.notifications.clear(notifId);
});

// ============== 11. 检测结果统一处理 ==============

/**
 * 规范化检测结果，确保 popup 能正常渲染
 * - 统一 level 为小写简写
 * - 补全 feature 字段
 * - 保留 recordId（用户反馈需要）
 */
function normalizeResultData(rawData, url) {
  const data = rawData || {};
  const level = normalizeLevel(data.level);
  const feature = data.feature || computeUrlFeatures(url);
  return {
    level,
    score: typeof data.score === 'number' ? data.score : 0,
    desc: data.desc || '',
    feature,
    recordId: data.recordId || data.record_id || ''
  };
}

/**
 * 处理检测结果：更新 Badge + 高风险发送警告 + 高风险通知
 */
async function handleDetectResult(rawData, url) {
  const data = normalizeResultData(rawData, url);
  const level = data.level;

  // 1. 更新扩展图标 Badge
  updateBadge(level);

  // 2. HIGH 风险 → 向 Content Script 发送警告横幅
  if (level === 'high') {
    try {
      const tab = await getActiveTab();
      if (tab?.id) {
        await sendShowWarning(tab.id, data);
      }
    } catch (e) {
      console.warn('[ServiceWorker] 发送 SHOW_WARNING 失败', e);
    }

    // 3. HIGH 风险 → 弹出浏览器通知
    await showHighRiskNotification(url, data.desc);
  }
}

// ============== 12. 消息路由表 ==============

const messageHandlers = {
  /**
   * 向 Content Script 请求页面信息
   */
  GET_PAGE_INFO: async (msg, sender) => {
    const tab = sender.tab || (await getActiveTab());
    if (!tab?.id) {
      return { code: 500, msg: '无活动标签页' };
    }
    const info = await getPageInfoFromContent(tab.id);
    if (!info) {
      return { code: 500, msg: 'Content Script 未响应' };
    }
    return { code: 200, data: info };
  },

  /**
   * 调用 API 提交检测
   * 流程：本地 domain 缓存 → 服务端缓存 → 调用检测接口 → 存缓存 + 处理结果
   */
  DETECT_URL: async (msg) => {
    const url = msg.url;
    if (!url) {
      return { code: 400, msg: '缺少 url 参数' };
    }

    // 特殊协议页面（chrome://, edge://, about: 等）跳过检测
    if (!/^https?:\/\//i.test(url)) {
      return { code: 400, msg: '当前页面协议不支持检测（仅支持 http/https）' };
    }

    const deviceId = await getDeviceId();

    // 1. 先查本地缓存（基于 domain）
    const cachedEntry = await getLocalCache(url);
    if (cachedEntry) {
      // 缓存命中：转换为 popup 期望格式
      const normalized = normalizeResultData(cacheEntryToResult(cachedEntry), url);
      await handleDetectResult(normalized, url);
      // 透传缓存的 source 字段（mock/api），让 popup 正确显示数据来源
      return { code: 200, data: normalized, fromCache: 'local', source: cachedEntry.source || 'cache' };
    }

    // 2. 再查服务端缓存
    try {
      const serverCached = await checkServerCache(url, deviceId);
      if (serverCached) {
        const normalized = normalizeResultData(serverCached, url);
        // 存入本地 domain 缓存（自动规范化为 {recordId,riskLevel,riskScore,riskReason,cachedTime,feature?}）
        await setLocalCache(url, { ...normalized, source: 'api' });
        await addHistory({ url, ...normalized, source: 'api' });
        await handleDetectResult(normalized, url);
        return { code: 200, data: normalized, fromCache: 'server', source: 'api' };
      }
    } catch (e) {
      console.warn('[ServiceWorker] 服务端缓存查询失败，继续走检测接口', e.message);
    }

    // 3. 获取页面信息（用于辅助检测）
    let pageInfo = null;
    try {
      const tab = await getActiveTab();
      if (tab?.id) {
        pageInfo = await getPageInfoFromContent(tab.id);
      }
    } catch (e) {
      console.warn('[ServiceWorker] 获取页面信息失败，使用 URL 检测', e.message);
    }

    // 4. 调用检测 API（失败时自动 fallback 到本地启发式检测）
    let apiResponse;
    let source = 'api';
    try {
      apiResponse = await callDetectAPI(url, deviceId, pageInfo);
    } catch (apiErr) {
      console.error('[ServiceWorker] 后端检测失败:', apiErr.message);
      throw apiErr;
    }
    const rawData = apiResponse?.data || apiResponse;
    const normalized = normalizeResultData(rawData, url);

    // 5. 存本地 domain 缓存 + 历史记录
    // 注意：mock 模式下也写入缓存，避免同域名重复"假检测"消耗算力
    // 缓存 TTL 仍为 24h；后端恢复后用户可手动"清除缓存"重新走真实检测
    await setLocalCache(url, { ...normalized, source });
    await addHistory({ url, ...normalized, source });

    // 6. 处理结果（Badge + 警告 + 通知）
    await handleDetectResult(normalized, url);

    return { code: 200, data: normalized, source };
  },

  /**
   * 自动检测流程
   * 通常由标签页加载完成事件触发；受 settings.autoDetect 开关控制
   */
  AUTO_DETECT_TRIGGER: async (msg, sender) => {
    const settings = await getSettings();
    if (!settings.autoDetect) {
      return { code: 200, msg: '自动检测未开启', skipped: true };
    }

    // 优先使用 sender.tab（来自 content script 的消息），否则取活动标签
    const tab = sender.tab || (await getActiveTab());
    if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
      return { code: 200, msg: '非 HTTP(S) 页面，跳过', skipped: true };
    }

    // 复用 DETECT_URL 流程
    return await messageHandlers.DETECT_URL({ url: tab.url }, sender);
  },

  /**
   * 获取检测历史记录
   * 优先从服务端拉取，失败则回退本地
   */
  GET_DETECT_HISTORY: async () => {
    try {
      const deviceId = await getDeviceId();
      const apiResult = await fetchHistoryAPI(deviceId);
      const list = apiResult?.data || apiResult?.list || [];
      return { code: 200, list };
    } catch (e) {
      console.warn('[ServiceWorker] 历史接口失败，回退本地', e.message);
      const localList = await getLocalHistory();
      return { code: 200, list: localList, fromLocal: true };
    }
  },

  /**
   * 清除本地存储缓存
   */
  CLEAR_CACHE: async () => {
    await clearLocalCache();
    // 同时重置图标状态
    updateBadge(null);
    return { code: 200, msg: '缓存已清空' };
  },

  /**
   * 更新配置
   * msg.settings = { autoDetect?, showNotifications?, apiBaseUrl? }
   */
  UPDATE_SETTINGS: async (msg) => {
    const merged = await updateSettings(msg.settings || {});
    return { code: 200, msg: '设置已更新', data: merged };
  },

  /**
   * 兼容现有 popup 的举报功能（保留旧入口）
   */
  REPORT_URL: async (msg) => {
    // 真实项目可在此调用举报 API
    return { code: 200, msg: '举报成功' };
  }
};

// ============== 13. 全局消息监听器 ==============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 兼容 action / type 两个字段名
  const action = msg.action || msg.type;
  const handler = messageHandlers[action];

  if (!handler) {
    sendResponse({ code: 500, msg: `未知请求类型: ${action}` });
    return false;
  }

  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(result => sendResponse(result))
    .catch(err => {
      console.error(`[ServiceWorker] 处理 ${action} 失败:`, err);
      sendResponse({ code: 500, msg: err.message || '处理失败' });
    });

  // 异步响应必须 return true
  return true;
});

// ============== 14. 安装初始化 ==============

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[ServiceWorker] onInstalled:', details.reason);

  // 1. 初始化 deviceId
  const deviceId = await getDeviceId();
  console.log('[ServiceWorker] deviceId =', deviceId);

  // 2. 初始化默认设置
  const settings = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });

  // 3. 初始化空缓存容器（避免后续读取判空逻辑）
  const cacheResult = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  if (!cacheResult[STORAGE_KEYS.CACHE]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: {} });
  }

  // 4. 设置默认图标状态（灰色）
  updateBadge(null);
});

// ============== 15. 标签页切换时同步 Badge ==============

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url) {
      updateBadge(null);
      return;
    }
    // getLocalCache 现在返回规范结构 { riskLevel, ... }
    const cached = await getLocalCache(tab.url);
    if (cached) {
      updateBadge(normalizeLevel(cached.riskLevel));
    } else {
      updateBadge(null);
    }
  } catch (e) {
    // 标签页可能无权限访问（如 chrome://）
    updateBadge(null);
  }
});

// ============== 16. 标签页加载完成 → 触发自动检测（受开关控制） ==============

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 仅在页面加载完成时触发
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) return;

  const settings = await getSettings();
  if (!settings.autoDetect) return;

  try {
    await messageHandlers.DETECT_URL({ url: tab.url }, { tab });
  } catch (e) {
    console.warn('[ServiceWorker] 自动检测失败:', e.message);
  }
});

console.log('[ServiceWorker] 已加载');
