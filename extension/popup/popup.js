// DOM元素缓存
const $ = s => document.querySelector(s);
const stateMap = {
  idle: $('#idleState'),
  detecting: $('#detectState'),
  safe: $('#safeState'),
  warning: $('#warnState'),
  error: $('#errorState')
};
// 初始化隐藏所有状态
Object.values(stateMap).forEach(el => el.classList.add('hidden'));

// 切换页面状态
function switchState(type) {
  Object.values(stateMap).forEach(el => el.classList.add('hidden'));
  stateMap[type].classList.remove('hidden');
}

// 获取当前激活标签页URL
async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;
  $('#currentUrl').textContent = url;
  return url;
}

// 与background通信封装
function sendMsg(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, res => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(res);
    });
  });
}

// 填充安全状态特征面板
function renderFeatureList(feature) {
  // render渲染
  const list = $('#featureList');
  list.innerHTML = '';
  const data = [
    ['HTTPS', feature.isHttps ? '是' : '否'],
    ['IP访问', feature.isIp ? '是' : '否'],
    ['URL长度', feature.urlLen + ''],
    ['子域名数量', feature.subDomainCount + '']
  ];
  data.forEach(([k, v]) => {
    list.innerHTML += `<span>${k}：</span><span>${v}</span>`;
  });
}

// 渲染数据来源徽章
// source: 'api' 云端检测 | 'mock' 本地诊断 | 'cache' 缓存
function renderSourceBadge(elId, source) {
  const el = $('#' + elId);
  if (!el) return;
  if (source === 'mock') {
    el.textContent = '🔍 本地诊断模式（后端未连接）';
    el.className = 'source-badge mock';
  } else if (source === 'api') {
    el.textContent = '☁️ 云端检测';
    el.className = 'source-badge api';
  } else if (source === 'cache') {
    el.textContent = '💾 缓存结果';
    el.className = 'source-badge mock';
  } else {
    el.className = 'source-badge hidden';
  }
}

// 触发检测流程
async function startDetect() {
  try {
    const url = await getCurrentTabUrl();
    switchState('detecting');
    // 发送检测请求给background
    const res = await sendMsg('DETECT_URL', { url });
    // 根据返回结果切换状态
    if (res.code === 200) {
      const data = res.data;
      // 数据来源徽章：mock（本地诊断）/ api（云端检测）/ 缓存继承上一次来源
      const source = res.source || res.fromCache && 'cache' || 'api';
      if (data.level === 'safe') {
        switchState('safe');
        $('#safePercent').textContent = `${Math.round(data.score * 100)}%`;
        $('#safeScore').textContent = data.score.toFixed(2);
        $('#safeDesc').textContent = data.desc;
        renderFeatureList(data.feature);
        renderSourceBadge('safeSourceBadge', source);
      } else if (['low', 'mid', 'high'].includes(data.level)) {
        switchState('warning');
        const levelText = { low: '低风险', mid: '中风险', high: '高风险' }[data.level];
        $('#warnLevel').textContent = levelText + '网站';
        $('#warnPercent').textContent = `${Math.round(data.score * 100)}%`;
        $('#warnScore').textContent = data.score.toFixed(2);
        $('#warnDesc').textContent = data.desc;
        renderSourceBadge('warnSourceBadge', source);
      }
    } else {
      throw new Error(res.msg || '检测接口异常');
    }
  } catch (err) {
    switchState('error');
    // 网络错误/超时给出更友好的提示（fallback 机制生效后此分支极少触发）
    const msg = err.message || '检测失败';
    if (/Failed to fetch|NetworkError|网络请求失败|请求超时/i.test(msg)) {
      $('#errorMsg').textContent = '请先连接后端服务';
    } else {
      $('#errorMsg').textContent = msg;
    }
  }
}

// 绑定所有按钮事件
function bindEvents() {
  // 初始检测按钮
  $('#startDetectBtn').addEventListener('click', startDetect);
  // 安全页重新检测
  $('#reDetectSafe').addEventListener('click', startDetect);
  // 风险页重新检测
  $('#reDetectWarn').addEventListener('click', startDetect);
  // 错误重试
  $('#retryBtn').addEventListener('click', startDetect);

  // 查看历史（示例空逻辑，自行扩展）
  $('#viewHistory').addEventListener('click', async () => {
    const history = await sendMsg('GET_DETECT_HISTORY');
    console.log('检测历史', history);
    alert('检测历史已打印控制台');
  });

  // 举报网址
  $('#reportUrl').addEventListener('click', async () => {
    const url = $('#currentUrl').textContent;
    await sendMsg('REPORT_URL', { url });
    alert('举报提交成功');
  });
}

// 页面初始化
(async function init() {
  bindEvents();
  switchState('idle');
  await getCurrentTabUrl();
})();
