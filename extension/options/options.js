// ============================================================
// 钓鱼网站智能预警系统 - Options 设置页面逻辑
// 职责：加载/保存配置、UPDATE_SETTINGS 通知、恢复默认、API 测试
// 依赖：utils/storage.js（暴露 PluginStorage）
// ============================================================

// ============== 1. UI 字段 ↔ 存储字段映射 ==============
// UI 字段使用 snake_case（与需求字面命名一致）
// 存储字段使用 camelCase（与 storage.js DEFAULT_CONFIG 一致）
const FIELD_MAP = {
  auto_detect_enabled: 'autoDetect',
  warning_popup_enabled: 'warningPopupEnabled',
  notify_high_only: 'notifyHighOnly',
  min_detect_interval: 'minDetectInterval',
  api_base_url: 'apiBaseUrl'
};

// 反向映射：存储字段 → UI 字段
const REVERSE_FIELD_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([ui, store]) => [store, ui])
);

// ============== 2. DOM 元素缓存 ==============
const $ = id => document.getElementById(id);
const els = {
  autoDetect: $('auto_detect_enabled'),
  warningPopup: $('warning_popup_enabled'),
  notifyHighOnly: $('notify_high_only'),
  notifyHighItem: $('notifyHighOnlyItem'),
  minInterval: $('min_detect_interval'),
  apiBaseUrl: $('api_base_url'),
  saveBtn: $('saveBtn'),
  resetBtn: $('resetBtn'),
  testApiBtn: $('testApiBtn'),
  toast: $('toast')
};

// ============== 3. Toast 提示工具 ==============
let toastTimer = null;
function showToast(msg, type = 'info') {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.className = `toast ${type}`;
  toastTimer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2500);
}

// ============== 4. 加载配置到 UI ==============
async function loadConfigToUI() {
  try {
    const config = await PluginStorage.getLocalConfig();
    // 复选框
    els.autoDetect.checked = !!config.autoDetect;
    els.warningPopup.checked = !!config.warningPopupEnabled;
    els.notifyHighOnly.checked = !!config.notifyHighOnly;
    // 数字
    els.minInterval.value = config.minDetectInterval ?? 60;
    // 文本
    els.apiBaseUrl.value = config.apiBaseUrl || '';
    // 联动：弹窗关闭时禁用 "仅高风险" 选项
    syncNotifyHighOnlyState();
  } catch (err) {
    showToast('加载配置失败：' + err.message, 'error');
  }
}

// ============== 5. 从 UI 收集配置 ==============
function collectConfigFromUI() {
  return {
    autoDetect: els.autoDetect.checked,
    warningPopupEnabled: els.warningPopup.checked,
    notifyHighOnly: els.notifyHighOnly.checked,
    minDetectInterval: parseInt(els.minInterval.value, 10),
    apiBaseUrl: els.apiBaseUrl.value.trim()
  };
}

// ============== 6. 表单校验 ==============
function validateConfig(config) {
  // 检测间隔：10 - 3600 秒
  if (!Number.isFinite(config.minDetectInterval)
    || config.minDetectInterval < 10
    || config.minDetectInterval > 3600) {
    return '检测间隔时间需在 10 - 3600 秒之间';
  }
  // API 地址：必须以 http:// 或 https:// 开头
  if (!/^https?:\/\/.+/i.test(config.apiBaseUrl)) {
    return 'API 地址必须以 http:// 或 https:// 开头';
  }
  // 仅高风险弹窗开启时，弹窗总开关必须开启
  if (config.notifyHighOnly && !config.warningPopupEnabled) {
    return '开启"仅高风险提醒"需先开启"风险弹窗提醒"';
  }
  return null;
}

// ============== 7. 联动：弹窗开关影响"仅高风险"可用性 ==============
function syncNotifyHighOnlyState() {
  if (els.warningPopup.checked) {
    els.notifyHighItem.classList.remove('disabled');
  } else {
    // 弹窗关闭时，强制关闭"仅高风险"并禁用
    els.notifyHighOnly.checked = false;
    els.notifyHighItem.classList.add('disabled');
  }
}

// ============== 8. 保存配置 ==============
async function saveConfig() {
  const config = collectConfigFromUI();

  // 1. 校验
  const errMsg = validateConfig(config);
  if (errMsg) {
    showToast(errMsg, 'error');
    return;
  }

  try {
    // 2. 同步兼容字段 showNotifications（service-worker.js 在用）
    //    warningPopupEnabled 关闭时，showNotifications 也关闭
    const mergedConfig = {
      ...config,
      showNotifications: config.warningPopupEnabled
    };

    // 3. 写入 chrome.storage.local
    await PluginStorage.setLocalConfig(mergedConfig);

    // 4. 向 Background Service Worker 发送 UPDATE_SETTINGS 通知
    await sendUpdateSettingsToBg(mergedConfig);

    showToast('设置已保存', 'success');
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  }
}

// ============== 9. 向 Background SW 发送 UPDATE_SETTINGS ==============
function sendUpdateSettingsToBg(settings) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      // 同时带 action 与 type，兼容新旧 service-worker.js
      { action: 'UPDATE_SETTINGS', type: 'UPDATE_SETTINGS', settings },
      response => {
        if (chrome.runtime.lastError) {
          // SW 未响应不视为致命错误（配置已落盘）
          console.warn('[Options] 通知 SW 失败:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      }
    );
  });
}

// ============== 10. 恢复默认设置 ==============
async function resetConfig() {
  if (!confirm('确定要恢复所有设置到默认值吗？')) return;

  try {
    // 直接写入默认配置
    const defaults = { ...PluginStorage.DEFAULT_CONFIG };
    await PluginStorage.setLocalConfig(defaults);

    // 通知 SW
    await sendUpdateSettingsToBg(defaults);

    // 刷新 UI
    await loadConfigToUI();
    showToast('已恢复默认设置', 'success');
  } catch (err) {
    showToast('恢复失败：' + err.message, 'error');
  }
}

// ============== 11. 测试 API 连接 ==============
async function testApiConnection() {
  const url = els.apiBaseUrl.value.trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    showToast('请先填写有效的 API 地址', 'error');
    return;
  }

  els.testApiBtn.disabled = true;
  els.testApiBtn.textContent = '测试中...';

  try {
    // 简单 ping：请求根路径或 /api/plugin/config
    // 使用较短超时避免长时间等待
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${url}/api/plugin/config`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timer);

    if (response.ok) {
      showToast('连接成功 ✓', 'success');
    } else {
      showToast(`连接失败：HTTP ${response.status}`, 'error');
    }
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? '连接超时（5s）'
      : `连接失败：${err.message}`;
    showToast(msg, 'error');
  } finally {
    els.testApiBtn.disabled = false;
    els.testApiBtn.textContent = '测试连接';
  }
}

// ============== 12. 事件绑定 ==============
function bindEvents() {
  // 弹窗开关变化 → 联动 "仅高风险" 状态
  els.warningPopup.addEventListener('change', syncNotifyHighOnlyState);

  // 保存按钮
  els.saveBtn.addEventListener('click', saveConfig);
  // 恢复默认
  els.resetBtn.addEventListener('click', resetConfig);
  // 测试连接
  els.testApiBtn.addEventListener('click', testApiConnection);
}

// ============== 13. 初始化 ==============
(async function init() {
  bindEvents();
  await loadConfigToUI();
})();
