// ============================================================
// 钓鱼网站智能预警系统 - Storage 工具模块
// 职责：统一封装 chrome.storage.local 读写
// 暴露：globalThis.PluginStorage
// 依赖：无
// ============================================================

// ============== 1. 存储键名常量 ==============
const STORAGE_KEYS = {
  DEVICE_ID: 'deviceId',         // 设备唯一标识（UUID v4）
  CONFIG: 'pluginConfig',        // 插件本地配置
  CACHE: 'detectCache',          // URL 检测结果缓存
  HISTORY: 'detectHistory',      // 本地检测历史记录
  FEEDBACK: 'userFeedback'       // 用户反馈暂存
};

// ============== 2. 默认配置 ==============
// 字段命名统一使用 camelCase（与代码风格一致）
// UI 字段（snake_case）与存储字段（camelCase）的映射在 options.js 中维护
const DEFAULT_CONFIG = {
  autoDetect: false,                  // 自动检测开关（对应 UI: auto_detect_enabled）
  warningPopupEnabled: true,          // 风险弹窗提醒开关（对应 UI: warning_popup_enabled）
  notifyHighOnly: false,              // 仅高风险弹窗（对应 UI: notify_high_only）
  minDetectInterval: 60,              // 检测间隔时间（秒）（对应 UI: min_detect_interval）
  apiBaseUrl: 'http://localhost:8080',// 后端 API 地址（对应 UI: api_base_url）
  // 兼容字段：service-worker.js 中 showHighRiskNotification 读取此字段
  // options 保存时会与 warningPopupEnabled 保持同步
  showNotifications: true,
  pluginVersion: ''                   // 插件版本号（首次初始化时填入）
};

// ============== 3. 容量与时效常量 ==============
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 缓存有效期：24 小时
const HISTORY_MAX = 50;                    // 本地历史最多保留 50 条

// ============== 4. 通用读写工具 ==============

/**
 * 读取指定键的值
 * @param {string} key STORAGE_KEYS 中的键
 * @returns {Promise<any>}
 */
async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

/**
 * 写入指定键值
 */
async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * 移除指定键
 */
async function remove(key) {
  await chrome.storage.local.remove(key);
}

// ============== 5. 设备 ID 管理 ==============

/**
 * 生成 UUID v4
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取或生成 deviceId（UUID v4），持久化到本地
 * @returns {Promise<string>}
 */
async function getDeviceId() {
  let id = await get(STORAGE_KEYS.DEVICE_ID);
  if (id) return id;
  id = generateUUID();
  await set(STORAGE_KEYS.DEVICE_ID, id);
  return id;
}

// ============== 6. 本地插件配置 ==============

/**
 * 获取本地插件配置（合并默认值）
 * @returns {Promise<typeof DEFAULT_CONFIG>}
 */
async function getLocalConfig() {
  const saved = await get(STORAGE_KEYS.CONFIG) || {};
  // 合并默认值，确保新增字段有默认值
  return { ...DEFAULT_CONFIG, ...saved };
}

/**
 * 保存插件配置（增量合并）
 * @param {Partial<typeof DEFAULT_CONFIG>} patch 待更新的配置字段
 * @returns {Promise<typeof DEFAULT_CONFIG>} 合并后的完整配置
 */
async function setLocalConfig(patch = {}) {
  const current = await getLocalConfig();
  const merged = { ...current, ...patch };
  await set(STORAGE_KEYS.CONFIG, merged);
  return merged;
}

// ============== 7. 检测缓存读写（基于 domain，规范结构） ==============
//
// 缓存数据结构（规范）：
// {
//   recordId:   string,   // 检测记录 ID
//   riskLevel:  string,   // 风险等级：safe / low / mid / high
//   riskScore:  number,   // 风险评分 0-1
//   riskReason: string,   // 风险原因描述
//   cachedTime: number,   // 缓存写入时间戳（ms）
//   feature?:   object    // 附加字段：URL 特征（popup 渲染需要，可选）
// }
//
// 缓存有效期：24 小时（CACHE_TTL_MS）
// 存储 key：chrome.storage.local.detectCache，内部为 { [domain]: <规范结构> }

/**
 * 内部：读取整个缓存对象
 */
async function _readCacheMap() {
  return (await get(STORAGE_KEYS.CACHE)) || {};
}

/**
 * 内部：从 url 提取 domain
 */
function _extractDomain(urlOrDomain) {
  if (!urlOrDomain) return '';
  // 已是纯 domain（无协议）直接返回
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
 * 内部：将任意结果对象规范化为缓存结构
 */
function _normalizeCacheEntry(result) {
  if (!result || typeof result !== 'object') return null;
  const entry = {
    recordId:   result.recordId || result.record_id || '',
    riskLevel:  result.riskLevel || result.level || 'safe',
    riskScore:  typeof result.riskScore === 'number'
                  ? result.riskScore
                  : (typeof result.score === 'number' ? result.score : 0),
    riskReason: result.riskReason || result.desc || result.reason || '',
    cachedTime: Date.now()
  };
  // 附加字段：feature（popup 渲染需要）
  if (result.feature) entry.feature = result.feature;
  return entry;
}

/**
 * 内部：将缓存结构反向转换为 popup 期望的响应格式
 * { recordId, riskLevel, riskScore, riskReason, cachedTime, feature? }
 *   → { level, score, desc, feature, recordId }
 */
function _cacheEntryToResult(entry) {
  if (!entry) return null;
  return {
    level:    entry.riskLevel,
    score:    entry.riskScore,
    desc:     entry.riskReason,
    feature:  entry.feature || null,
    recordId: entry.recordId || ''
  };
}

/**
 * 按 domain 读取检测缓存
 * @param {string} domainOrUrl 域名或完整 URL（内部自动提取 domain）
 * @returns {Promise<object|null>} 命中返回规范结构，过期或未命中返回 null
 */
async function getDomainCache(domainOrUrl) {
  const domain = _extractDomain(domainOrUrl);
  if (!domain) return null;
  const cache = await _readCacheMap();
  const entry = cache[domain];
  if (!entry) return null;
  // TTL 过期清理
  if (Date.now() - entry.cachedTime > CACHE_TTL_MS) {
    delete cache[domain];
    await set(STORAGE_KEYS.CACHE, cache);
    return null;
  }
  return entry;
}

/**
 * 按 domain 写入检测缓存
 * @param {string} domainOrUrl 域名或完整 URL
 * @param {object} result 检测结果（支持 recordId/riskLevel/riskScore/riskReason 或 level/score/desc）
 */
async function setDomainCache(domainOrUrl, result) {
  const domain = _extractDomain(domainOrUrl);
  if (!domain) return;
  const entry = _normalizeCacheEntry(result);
  if (!entry) return;
  const cache = await _readCacheMap();
  cache[domain] = entry;
  await set(STORAGE_KEYS.CACHE, cache);
}

/**
 * 清空所有检测缓存
 */
async function clearDomainCache() {
  await set(STORAGE_KEYS.CACHE, {});
}

// -------- 向后兼容接口（基于 URL，内部转 domain） --------
// 保留旧方法名，便于尚未迁移的调用方继续使用

/**
 * 兼容方法：以 URL 查询缓存（内部按 domain 匹配）
 * @param {string} url
 * @returns {Promise<object|null>} 返回 popup 期望格式 { level, score, desc, feature, recordId }
 */
async function getCache(url) {
  const entry = await getDomainCache(url);
  return _cacheEntryToResult(entry);
}

/**
 * 兼容方法：以 URL 写入缓存（内部按 domain 存储）
 */
async function setCache(url, data) {
  await setDomainCache(url, data);
}

/**
 * 兼容别名：getCacheByDomain = getDomainCache
 * 返回 popup 期望格式
 */
async function getCacheByDomain(domain) {
  const entry = await getDomainCache(domain);
  return _cacheEntryToResult(entry);
}

/**
 * 兼容别名：clearCache = clearDomainCache
 */
async function clearCache() {
  await clearDomainCache();
}

// ============== 8. 检测历史本地存储（最多 50 条） ==============

/**
 * 追加一条检测历史（新记录置顶，超出上限自动截断）
 * @param {{url:string, level:string, score:number, desc?:string, feature?:object}} record
 */
async function addHistory(record) {
  const history = (await get(STORAGE_KEYS.HISTORY)) || [];
  history.unshift({ ...record, timestamp: Date.now() });
  if (history.length > HISTORY_MAX) {
    history.length = HISTORY_MAX;
  }
  await set(STORAGE_KEYS.HISTORY, history);
}

/**
 * 读取本地历史记录
 * @param {number} [limit=HISTORY_MAX] 最多返回条数
 * @returns {Promise<Array>}
 */
async function getHistory(limit = HISTORY_MAX) {
  const history = (await get(STORAGE_KEYS.HISTORY)) || [];
  return history.slice(0, limit);
}

/**
 * 清空本地历史
 */
async function clearHistory() {
  await set(STORAGE_KEYS.HISTORY, []);
}

// ============== 9. 导出 ==============
const PluginStorage = {
  STORAGE_KEYS,
  DEFAULT_CONFIG,
  CACHE_TTL_MS,
  HISTORY_MAX,
  // 通用
  get, set, remove,
  // deviceId
  getDeviceId,
  // 配置
  getLocalConfig, setLocalConfig,
  // 缓存（基于 domain，规范结构）
  getDomainCache, setDomainCache, clearDomainCache,
  // 缓存（兼容接口，基于 URL，内部转 domain）
  getCache, setCache, getCacheByDomain, clearCache,
  // 历史
  addHistory, getHistory, clearHistory
};

// 兼容 service worker（importScripts 场景）与 popup/options 等脚本环境
if (typeof globalThis !== 'undefined') {
  globalThis.PluginStorage = PluginStorage;
}
if (typeof window !== 'undefined') {
  window.PluginStorage = PluginStorage;
}
if (typeof self !== 'undefined') {
  self.PluginStorage = PluginStorage;
}
