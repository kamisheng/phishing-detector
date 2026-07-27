// ============================================================
// 钓鱼网站智能预警系统 - Content Script
// 职责：页面信息采集 + 高风险警告横幅注入
// 兼容：同时响应 action 与 type 字段
// ============================================================

// ============== 1. 采集配置 ==============
// 限制采集大小，避免超大页面（10万+字符）导致性能问题
const COLLECT_LIMITS = {
  TEXT_MAX: 10000,      // 正文文本最大字符数
  HTML_MAX: 500000,     // HTML 最大字符数（约 500KB）
  FORMS_MAX: 50         // 最多扫描表单数量
};

// 不支持检测的特殊协议（chrome://, edge://, about: 等）
const UNSUPPORTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'moz-extension:', 'view-source:'];

// ============== 2. 页面信息采集（懒执行，每次请求重新采集） ==============

/**
 * 判断当前页面协议是否支持检测
 */
function isSupportedPage() {
  const proto = window.location.protocol;
  return !UNSUPPORTED_PROTOCOLS.includes(proto);
}

/**
 * 采集页面信息（按需执行，避免内存常驻）
 * @returns {object} 页面信息对象
 */
function collectPageInfo() {
  // 协议检查：特殊协议页面返回精简信息
  if (!isSupportedPage()) {
    return {
      url: window.location.href,
      title: document.title || '',
      text: '',
      html: '',
      domain: window.location.hostname,
      protocol: window.location.protocol,
      unsupported: true,
      meta: { description: '', keywords: '' },
      forms: { hasLoginForm: false, hasPasswordField: false, formCount: 0 }
    };
  }

  // 正文文本：使用 textContent 替代 innerText 提升性能（innerText 触发重排）
  // 限制长度，避免超大页面内存爆炸
  const rawText = document.body ? document.body.textContent || '' : '';
  const text = rawText.slice(0, COLLECT_LIMITS.TEXT_MAX);

  // HTML：限制大小，超大页面仅取前 N 字符
  const rawHtml = document.documentElement ? document.documentElement.outerHTML || '' : '';
  const html = rawHtml.slice(0, COLLECT_LIMITS.HTML_MAX);

  // 表单检测：限制扫描数量，避免超多表单页面卡顿
  const formsInfo = detectForms();

  return {
    url: window.location.href,
    title: document.title || '',
    text,
    html,
    domain: window.location.hostname,
    protocol: window.location.protocol,
    meta: {
      description: getMetaContent('description'),
      keywords: getMetaContent('keywords')
    },
    forms: formsInfo
  };
}

/**
 * 安全读取 meta 标签内容
 */
function getMetaContent(name) {
  try {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el?.content || '';
  } catch (e) {
    return '';
  }
}

/**
 * 检测页面表单特征：是否含登录表单、密码框、表单总数
 */
function detectForms() {
  const result = { hasLoginForm: false, hasPasswordField: false, formCount: 0 };
  try {
    const forms = document.querySelectorAll('form');
    result.formCount = Math.min(forms.length, COLLECT_LIMITS.FORMS_MAX);

    // 密码框检测
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    result.hasPasswordField = passwordInputs.length > 0;

    // 登录表单检测：包含密码框 或 包含疑似登录关键词的表单
    for (let i = 0; i < Math.min(forms.length, COLLECT_LIMITS.FORMS_MAX); i++) {
      const form = forms[i];
      const hasPassword = form.querySelector('input[type="password"]');
      const action = (form.action || '').toLowerCase();
      const inputs = form.querySelectorAll('input');
      // 启发式：表单含密码框 + 文本输入框，或 action 含 login/signin/account 关键词
      if (hasPassword && inputs.length > 0) {
        result.hasLoginForm = true;
        break;
      }
      if (/login|signin|sign-in|account|auth|session/i.test(action)) {
        result.hasLoginForm = true;
        break;
      }
    }
  } catch (e) {
    // 表单查询失败保持默认值
  }
  return result;
}

// ============== 3. 消息监听 ==============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 兼容 action 与 type 两种字段命名
  const action = msg.action || msg.type;

  switch (action) {
    case 'GET_PAGE_INFO': {
      // 采集页面信息并返回（懒采集，保证数据新鲜）
      try {
        const info = collectPageInfo();
        sendResponse({ code: 200, data: info });
      } catch (err) {
        sendResponse({ code: 500, msg: '页面信息采集失败: ' + err.message });
      }
      return true; // 异步响应
    }

    case 'SHOW_WARNING': {
      // 高风险警告横幅注入
      try {
        createWarningBanner(msg.data);
        sendResponse({ code: 200, msg: '警告已显示' });
      } catch (err) {
        sendResponse({ code: 500, msg: '警告注入失败: ' + err.message });
      }
      return true;
    }

    default:
      // 未知 action 不响应
      return false;
  }
});

// ============== 4. 高风险警告横幅 ==============

/**
 * 创建顶部警告横幅
 * @param {object} data 检测结果数据（可选，用于展示风险详情）
 */
function createWarningBanner(data) {
  // 避免重复插入多个警告条
  if (document.getElementById('phishing-warning-banner')) return;

  // body 可能尚未就绪（极端情况），做兜底处理
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => createWarningBanner(data), { once: true });
    return;
  }

  // 风险描述（如有）
  const riskDesc = data?.desc || data?.riskReason || '';
  const descHtml = riskDesc
    ? `<div style="font-size:13px;font-weight:normal;margin-top:6px;opacity:0.95;">${escapeHtml(riskDesc)}</div>`
    : '';

  // 完整警告 DOM 字符串
  const bannerHtml = `
    <div id="phishing-warning-banner" style="
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
        background: #F56C6C; color: white; padding: 14px 16px; text-align: center;
        font-size: 16px; font-weight: bold; font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
        ⚠ 检测到疑似钓鱼网站！建议不要输入账号密码等敏感信息。
        ${descHtml}
        <button id="phishing-warning-close" style="
            margin-left: 16px; background: white; color: #F56C6C;
            border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer;
            font-weight: bold; font-size: 14px;">
            我知道了
        </button>
    </div>
  `;

  // 插入页面最顶部
  document.body.insertAdjacentHTML('afterbegin', bannerHtml);

  // 绑定关闭按钮点击事件
  const closeBtn = document.getElementById('phishing-warning-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const banner = document.getElementById('phishing-warning-banner');
      if (banner) banner.remove();
    });
  }
}

/**
 * 简单 HTML 转义，防止风险描述中的 XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
