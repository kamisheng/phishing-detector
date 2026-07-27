// ============================================================
// 钓鱼网站智能预警系统 - 自动化测试脚本
// 职责：在扩展环境中运行可自动化的功能测试
// 使用：在 chrome://extensions 扩展的 Service Worker 控制台中
//       执行 importScripts('test/test-runner.js') 或在 popup 控制台引入
// ============================================================

// ============== 1. 测试框架 ==============

const TestRunner = {
  results: [],
  passed: 0,
  failed: 0,

  /**
   * 重置测试状态
   */
  reset() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  },

  /**
   * 断言：实际值 === 期望值
   */
  assertEqual(actual, expected, msg) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    this._record(ok, `${msg} | 期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`);
    return ok;
  },

  /**
   * 断言：值为真
   */
  assertTrue(value, msg) {
    const ok = !!value;
    this._record(ok, `${msg} | 值: ${value}`);
    return ok;
  },

  /**
   * 断言：值为假
   */
  assertFalse(value, msg) {
    const ok = !value;
    this._record(ok, `${msg} | 值: ${value}`);
    return ok;
  },

  /**
   * 断言：函数应抛出错误
   */
  async assertThrows(fn, msg) {
    try {
      await fn();
      this._record(false, `${msg} | 未抛出错误`);
      return false;
    } catch (e) {
      this._record(true, `${msg} | 已抛出: ${e.message}`);
      return true;
    }
  },

  /**
   * 记录测试结果
   */
  _record(ok, detail) {
    if (ok) this.passed++;
    else this.failed++;
    this.results.push({ ok, detail });
  },

  /**
   * 打印测试报告
   */
  report() {
    const total = this.passed + this.failed;
    console.log(`\n========== 测试报告 ==========`);
    console.log(`总计: ${total} | 通过: ${this.passed} | 失败: ${this.failed}`);
    console.log(`==============================\n`);
    this.results.forEach((r, i) => {
      const tag = r.ok ? '✓ PASS' : '✗ FAIL';
      console.log(`${tag} #${i + 1}: ${r.detail}`);
    });
    return { total, passed: this.passed, failed: this.failed };
  }
};

// ============== 2. 工具：发送消息到 Background ==============

function sendToBg(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ code: 500, msg: chrome.runtime.lastError.message });
      } else {
        resolve(res);
      }
    });
  });
}

// ============== 3. 测试用例集 ==============

const TestCases = {

  /**
   * 3.1 消息路由测试
   */
  async testMessageRouting() {
    console.log('\n--- 测试组 1: 消息路由 ---');

    // 未知 action 应返回 500
    const unknown = await sendToBg({ action: 'UNKNOWN_ACTION' });
    TestRunner.assertEqual(unknown.code, 500, '未知 action 返回 500');

    // CLEAR_CACHE 应返回 200
    const clearRes = await sendToBg({ action: 'CLEAR_CACHE' });
    TestRunner.assertEqual(clearRes.code, 200, 'CLEAR_CACHE 返回 200');

    // 兼容 type 字段
    const typeRes = await sendToBg({ type: 'CLEAR_CACHE' });
    TestRunner.assertEqual(typeRes.code, 200, 'type 字段兼容性');

    // UPDATE_SETTINGS
    const updateRes = await sendToBg({
      action: 'UPDATE_SETTINGS',
      settings: { autoDetect: true }
    });
    TestRunner.assertEqual(updateRes.code, 200, 'UPDATE_SETTINGS 返回 200');
    TestRunner.assertEqual(updateRes.data.autoDetect, true, '设置更新生效');

    // 恢复默认
    await sendToBg({
      action: 'UPDATE_SETTINGS',
      settings: { autoDetect: false }
    });
  },

  /**
   * 3.2 缓存测试
   */
  async testCache() {
    console.log('\n--- 测试组 2: 缓存机制 ---');

    // 先清空
    await sendToBg({ action: 'CLEAR_CACHE' });

    // 测试 storage 模块（如果可用）
    if (typeof PluginStorage !== 'undefined') {
      // 写入缓存
      await PluginStorage.setDomainCache('https://example.com/page', {
        level: 'high',
        score: 0.85,
        desc: '测试高风险',
        recordId: 'test-123'
      });

      // 读取缓存
      const cached = await PluginStorage.getDomainCache('https://example.com/other');
      TestRunner.assertTrue(cached !== null, '缓存命中（同 domain 不同 path）');
      if (cached) {
        TestRunner.assertEqual(cached.riskLevel, 'high', '缓存 riskLevel 正确');
        TestRunner.assertEqual(cached.riskScore, 0.85, '缓存 riskScore 正确');
        TestRunner.assertEqual(cached.recordId, 'test-123', '缓存 recordId 正确');
        TestRunner.assertTrue(typeof cached.cachedTime === 'number', 'cachedTime 为数字');
      }

      // 清空缓存
      await PluginStorage.clearDomainCache();
      const afterClear = await PluginStorage.getDomainCache('https://example.com');
      TestRunner.assertTrue(afterClear === null, '清空后缓存未命中');
    } else {
      console.log('  跳过：PluginStorage 未加载');
    }
  },

  /**
   * 3.3 设备 ID 测试
   */
  async testDeviceId() {
    console.log('\n--- 测试组 3: 设备 ID ---');

    if (typeof PluginStorage !== 'undefined') {
      const id1 = await PluginStorage.getDeviceId();
      const id2 = await PluginStorage.getDeviceId();
      TestRunner.assertTrue(typeof id1 === 'string', 'deviceId 为字符串');
      TestRunner.assertTrue(id1.length > 0, 'deviceId 非空');
      TestRunner.assertEqual(id1, id2, '多次获取 deviceId 一致');

      // UUID v4 格式校验
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      TestRunner.assertTrue(uuidRegex.test(id1), 'deviceId 符合 UUID v4 格式');
    } else {
      console.log('  跳过：PluginStorage 未加载');
    }
  },

  /**
   * 3.4 配置测试
   */
  async testConfig() {
    console.log('\n--- 测试组 4: 配置管理 ---');

    if (typeof PluginStorage !== 'undefined') {
      // 获取默认配置
      const config = await PluginStorage.getLocalConfig();
      TestRunner.assertTrue(typeof config === 'object', '配置为对象');
      TestRunner.assertEqual(config.autoDetect, false, '默认 autoDetect = false');
      TestRunner.assertEqual(config.warningPopupEnabled, true, '默认 warningPopupEnabled = true');
      TestRunner.assertEqual(config.minDetectInterval, 60, '默认 minDetectInterval = 60');

      // 更新配置
      const updated = await PluginStorage.setLocalConfig({ autoDetect: true, minDetectInterval: 30 });
      TestRunner.assertEqual(updated.autoDetect, true, '更新后 autoDetect = true');
      TestRunner.assertEqual(updated.minDetectInterval, 30, '更新后 minDetectInterval = 30');
      TestRunner.assertEqual(updated.warningPopupEnabled, true, '未更新字段保持原值');

      // 恢复
      await PluginStorage.setLocalConfig({ autoDetect: false, minDetectInterval: 60 });
    } else {
      console.log('  跳过：PluginStorage 未加载');
    }
  },

  /**
   * 3.5 历史记录测试
   */
  async testHistory() {
    console.log('\n--- 测试组 5: 历史记录 ---');

    if (typeof PluginStorage !== 'undefined') {
      await PluginStorage.clearHistory();
      await PluginStorage.addHistory({ url: 'https://a.com', level: 'safe', score: 0.1 });
      await PluginStorage.addHistory({ url: 'https://b.com', level: 'high', score: 0.9 });

      const history = await PluginStorage.getHistory();
      TestRunner.assertEqual(history.length, 2, '历史记录条数');
      TestRunner.assertEqual(history[0].url, 'https://b.com', '最新记录置顶');

      // 测试上限截断（HISTORY_MAX = 50）
      for (let i = 0; i < 55; i++) {
        await PluginStorage.addHistory({ url: `https://test${i}.com`, level: 'low', score: 0.2 });
      }
      const fullHistory = await PluginStorage.getHistory();
      TestRunner.assertEqual(fullHistory.length, 50, '历史记录截断为 50 条');

      // 清空
      await PluginStorage.clearHistory();
    } else {
      console.log('  跳过：PluginStorage 未加载');
    }
  },

  /**
   * 3.6 特殊协议页面测试
   */
  async testUnsupportedProtocol() {
    console.log('\n--- 测试组 6: 特殊协议页面 ---');

    // chrome:// URL 应返回 400
    const chromeRes = await sendToBg({ action: 'DETECT_URL', url: 'chrome://settings/' });
    TestRunner.assertEqual(chromeRes.code, 400, 'chrome:// 返回 400');

    // about: URL 应返回 400
    const aboutRes = await sendToBg({ action: 'DETECT_URL', url: 'about:blank' });
    TestRunner.assertEqual(aboutRes.code, 400, 'about: 返回 400');

    // 缺少 url 参数应返回 400
    const noUrlRes = await sendToBg({ action: 'DETECT_URL' });
    TestRunner.assertEqual(noUrlRes.code, 400, '缺少 url 返回 400');
  },

  /**
   * 3.7 缺少参数测试
   */
  async testMissingParams() {
    console.log('\n--- 测试组 7: 参数校验 ---');

    // GET_DETECT_HISTORY 应正常返回
    const historyRes = await sendToBg({ action: 'GET_DETECT_HISTORY' });
    TestRunner.assertEqual(historyRes.code, 200, 'GET_DETECT_HISTORY 返回 200');
    TestRunner.assertTrue(Array.isArray(historyRes.list), '历史记录为数组');
  }
};

// ============== 4. 运行入口 ==============

/**
 * 运行所有测试
 */
async function runAllTests() {
  TestRunner.reset();
  console.log('======== 开始自动化测试 ========\n');

  for (const [name, fn] of Object.entries(TestCases)) {
    try {
      await fn();
    } catch (err) {
      console.error(`测试组 ${name} 异常:`, err);
      TestRunner._record(false, `测试组 ${name} 异常: ${err.message}`);
    }
  }

  return TestRunner.report();
}

/**
 * 运行单个测试组
 */
async function runTest(name) {
  if (!TestCases[name]) {
    console.error(`未找到测试: ${name}`);
    return;
  }
  TestRunner.reset();
  try {
    await TestCases[name]();
  } catch (err) {
    console.error(`测试 ${name} 异常:`, err);
    TestRunner._record(false, `测试 ${name} 异常: ${err.message}`);
  }
  return TestRunner.report();
}

// 导出
if (typeof globalThis !== 'undefined') {
  globalThis.TestRunner = TestRunner;
  globalThis.runAllTests = runAllTests;
  globalThis.runTest = runTest;
}
if (typeof window !== 'undefined') {
  window.TestRunner = TestRunner;
  window.runAllTests = runAllTests;
  window.runTest = runTest;
}
