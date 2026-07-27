# 基于大语言模型语义识别的钓鱼网站智能预警系统

> 浏览器扩展（Chrome / Edge）— 实时检测钓鱼网站，保护用户凭证与资产安全

![Manifest Version](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

## 项目简介

本项目是一套基于浏览器扩展形态的钓鱼网站预警系统前端。通过实时采集用户访问页面的 URL、HTML、文本内容与表单特征，结合后端大语言模型语义识别能力，对页面风险等级进行精准判定，并通过图标 Badge、Popup 弹窗、页面警告横幅、浏览器通知等多维度向用户预警。

**核心特色**：

- **云端 + 本地双引擎**：后端可用时调用 LLM 语义分析；后端不可用时自动降级到本地启发式检测，用户无感知
- **多层级风险提醒**：图标 Badge 状态、Popup 详情、页面顶部红色横幅、浏览器系统通知
- **零配置开箱即用**：安装即用，无需注册；后端地址可在 Options 页面自定义
- **MV3 现代架构**：基于 Chrome Manifest V3 标准，兼容 Chrome 与 Edge

---

## 主要功能

### 检测能力
- **手动检测**：点击扩展图标 → 一键检测当前页面
- **自动检测**：页面加载完成时自动触发（可在 Options 开启，受检测间隔限制）
- **缓存优化**：基于 domain 的 24 小时本地缓存，减少重复 API 调用
- **离线降级**：后端不可用时自动切换本地启发式检测，基于 10+ 项 URL/页面特征评分

### 风险等级与提醒

| 等级 | 评分区间 | 图标 Badge | Popup 展示 | 页面横幅 | 系统通知 |
|------|---------|-----------|------------|---------|---------|
| 安全 `safe` | 0.0 - 0.19 | 绿色 ✓ | 绿色安全卡片 | - | - |
| 低风险 `low` | 0.2 - 0.39 | 橙色 ! | 橙色警告卡片 | - | - |
| 中风险 `mid` | 0.4 - 0.69 | 橙色 ! | 橙色警告卡片 | - | - |
| 高风险 `high` | 0.7 - 1.0 | 红色 X | 红色警告卡片 | 顶部红色横幅 | 浏览器通知 |

### 其他功能
- **检测历史**：本地保留最近 50 条检测记录
- **用户反馈**：支持对检测结果进行误报/漏报上报
- **个性化配置**：Options 页面可调整 API 地址、检测间隔、提醒开关等
- **跨浏览器兼容**：支持 Chrome 与 Edge

---

## 目录结构

```
phishing-detector/
└── extension/                      # 浏览器扩展根目录（加载此目录到浏览器）
    ├── manifest.json               # 扩展配置（MV3）
    ├── README.md                   # 本文档
    │
    ├── background/                 # Background Service Worker（消息中枢）
    │   └── service-worker.js       # 消息路由、API 调用、Badge 管理、本地降级
    │
    ├── content/                    # Content Script（页面注入）
    │   └── content-script.js       # 页面信息采集、高风险警告横幅注入
    │
    ├── popup/                      # Popup 弹窗（点击图标弹出）
    │   ├── popup.html              # 五种状态界面（idle/detecting/safe/warning/error）
    │   ├── popup.css               # 弹窗样式
    │   └── popup.js                # 检测触发、结果渲染、数据来源徽章
    │
    ├── options/                    # Options 设置页面
    │   ├── options.html            # 设置表单
    │   ├── options.css             # 设置页面样式
    │   └── options.js              # 配置加载/保存/校验/恢复默认
    │
    ├── utils/                      # 工具模块
    │   ├── api.js                  # API 请求封装（统一请求头、超时、错误处理）
    │   └── storage.js              # Storage 封装（deviceId、配置、缓存、历史）
    │
    ├── icons/                      # 扩展图标
    │   ├── icon16.png
    │   ├── icon32.png
    │   ├── icon48.png
    │   └── icon128.png
    │
    ├── test/                       # 测试
    │   ├── test-runner.js          # 自动化测试脚本（7 组用例）
    │   └── test.html               # 可视化测试清单页面（14 项）
    │
    └── docs/                       # 文档
        └── backend-api-spec.md     # 后端接口交接文档
```

---

## 快速开始

### 1. 加载扩展

**Chrome**：
1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库的 `extension/` 目录

**Edge**：
1. 打开 `edge://extensions`
2. 开启左下角「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择本仓库的 `extension/` 目录

### 2. 配置后端地址（可选）

扩展默认连接 `http://localhost:8080`。如需修改：
- 右键扩展图标 → 「选项」
- 修改「后端 API 地址」
- 点击「测试连接」验证
- 点击「保存设置」

### 3. 开始使用

- 访问任意 HTTP/HTTPS 网页
- 点击扩展图标 → 点击「开始检测」
- 查看风险等级与分析说明

> 💡 **后端未启动？** 扩展会自动切换到「本地诊断模式」，基于 URL 与页面特征进行启发式风险判定，无需后端也能基本使用。Popup 顶部会显示「🔍 本地诊断模式（后端未连接）」徽章提示。

---

## 架构设计

### 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    浏览器扩展（前端）                      │
│                                                          │
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────┐ │
│  │   Popup     │◄──►│  Service Worker │◄──►│  Content │ │
│  │  (用户交互)  │    │   (消息中枢)    │    │  Script  │ │
│  └─────────────┘    └────────┬────────┘    │ (页面采集)│ │
│                              │             └──────────┘ │
│                              ▼                          │
│                     ┌────────────────┐                  │
│                     │  本地缓存/降级  │                  │
│                     │  (24h domain)  │                  │
│                     └────────┬───────┘                  │
│                              │                          │
└──────────────────────────────┼──────────────────────────┘
                               │ HTTP (X-Device-ID)
                               ▼
                    ┌─────────────────────┐
                    │   后端 SpringBoot   │
                    │  /api/plugin/*      │
                    │  (LLM 语义分析)     │
                    └─────────────────────┘
```

### 检测流程

```
用户点击检测
    │
    ▼
1. 查本地缓存（domain 级，24h TTL）─命中─► 直接返回
    │未命中
    ▼
2. 查服务端缓存 GET /api/plugin/cache ─命中─► 回填本地缓存后返回
    │未命中
    ▼
3. 调用检测 POST /api/plugin/detect
    │
    ├─成功─► 返回后端结果（标记 source: api）
    │
    └─失败─► 自动降级到本地启发式检测
             │
             ▼
         基于 10+ 项 URL/页面特征评分
         返回结果（标记 source: mock）
```

### 消息通信架构

扩展内部采用 `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` 进行通信：

| 消息方向 | action | 用途 |
|---------|--------|------|
| Popup → SW | `DETECT_URL` | 触发检测 |
| Popup → SW | `GET_DETECT_HISTORY` | 查询历史 |
| Popup → SW | `CLEAR_CACHE` | 清空缓存 |
| Popup → SW | `UPDATE_SETTINGS` | 更新配置 |
| SW → Content | `GET_PAGE_INFO` | 请求页面信息 |
| SW → Content | `SHOW_WARNING` | 注入警告横幅 |

> 💡 所有消息同时支持 `action` 与 `type` 字段，向后兼容

---

## 配置项说明

在 Options 页面可配置以下项目：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 自动检测 | 关闭 | 页面加载完成时自动触发检测 |
| 风险弹窗提醒 | 开启 | 检测到风险时弹出通知与警告横幅 |
| 仅高风险提醒 | 关闭 | 开启后仅 HIGH 风险触发弹窗 |
| 检测间隔时间 | 60 秒 | 同一 URL 两次自动检测的最小间隔（10-3600 秒） |
| 后端 API 地址 | `http://localhost:8080` | 后端服务地址 |

---

## 技术栈

- **扩展标准**：Chrome Manifest V3
- **前端语言**：原生 JavaScript（无框架依赖）
- **API 通信**：Fetch API + AbortController（超时控制）
- **存储**：chrome.storage.local（配置、缓存、历史、deviceId）
- **兼容浏览器**：Chrome 88+ / Edge 88+

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 获取当前激活标签页信息 |
| `storage` | 持久化配置、缓存、历史、deviceId |
| `notifications` | 高风险时发送浏览器系统通知 |
| `tabs` | 监听标签页切换、向 Content Script 发送消息 |

`host_permissions` 仅声明 `localhost:8080` 与示例 API 地址，用户在 Options 修改后端地址时，浏览器会按需提示授权。

---

## 测试

### 自动化测试

在 Service Worker 控制台执行：

```javascript
importScripts('test/test-runner.js');
runAllTests();
```

包含 7 组测试用例：
- 消息路由（action/type 兼容性）
- 缓存机制（domain 级读写、TTL）
- 设备 ID（UUID v4 格式校验）
- 配置管理（默认值、增量更新）
- 历史记录（置顶、50 条截断）
- 特殊协议页面（chrome://、about: 降级）
- 参数校验

### 手动测试清单

直接在浏览器中打开 `extension/test/test.html`，14 项测试用例可视化勾选，支持进度跟踪与报告导出。

---

## 后端对接

后端接口规范详见：[docs/backend-api-spec.md](docs/backend-api-spec.md)

**核心接口**：

| 接口 | 方法 | 路径 | 优先级 |
|------|------|------|--------|
| URL 检测 | POST | `/api/plugin/detect` | P0（核心） |
| 缓存查询 | GET | `/api/plugin/cache` | P1 |
| 用户反馈 | POST | `/api/plugin/feedback` | P2 |
| 检测历史 | GET | `/api/plugin/history` | P2 |
| 检测统计 | GET | `/api/plugin/statistics` | P3 |
| 云端配置 | GET | `/api/plugin/config` | P3 |
| 配置同步 | POST | `/api/plugin/config/sync` | P3 |

---

## 开发者说明

### 本地开发

1. Clone 仓库
2. 按「快速开始」加载 `extension/` 目录到浏览器
3. 修改代码后在 `chrome://extensions` 点击「刷新」按钮即可生效
4. Service Worker 日志：点击扩展卡片中的「Service Worker」链接
5. Popup 日志：右键扩展图标 → 「检查弹出内容」
6. Content Script 日志：在页面开发者工具 Console 查看

### 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| API 封装 | `utils/api.js` | 统一请求头注入、超时控制、错误处理 |
| Storage 封装 | `utils/storage.js` | deviceId 生成、配置读写、缓存管理、历史记录 |
| 消息中枢 | `background/service-worker.js` | 消息路由、检测流程编排、Badge 管理、本地降级 |
| 页面采集 | `content/content-script.js` | URL/HTML/文本/表单采集、警告横幅注入 |
| 本地降级 | `background/service-worker.js` `mockDetectUrl()` | 10+ 项特征启发式评分 |

### 本地启发式检测规则

后端不可用时，前端基于以下规则评分（供参考）：

| 检查项 | 加分 |
|--------|------|
| 无 HTTPS 加密 | +0.30 |
| IP 直连访问 | +0.30 |
| URL 含 @ 符号 | +0.20 |
| URL 长度 > 75 | +0.15 |
| 子域名数量 > 3 | +0.15 |
| 含可疑关键词（login/verify/bank 等） | +0.25 |
| 非标准端口 | +0.10 |
| 登录表单 + 非 HTTPS | +0.30 |
| 域名连字符 ≥ 3 | +0.15 |
| 纯数字域名 | +0.10 |

---

## 浏览器兼容性

| 浏览器 | 版本 | 状态 |
|--------|------|------|
| Chrome | 88+ | ✅ 完全支持 |
| Edge | 88+ | ✅ 完全支持 |
| Firefox | - | ❌ 暂不支持（MV3 兼容性待评估） |

---

## FAQ

**Q: 安装后点击检测提示"网络连接失败"？**
A: 后端服务未启动。扩展会自动降级到本地诊断模式，仍可正常使用基础检测功能。如需启用完整云端检测，请启动后端服务并配置正确地址。

**Q: 如何重新走真实后端检测（清除本地缓存）？**
A: 右键扩展图标 → 「选项」→ 修改任意配置触发 UPDATE_SETTINGS；或在 Service Worker 控制台执行 `chrome.runtime.sendMessage({action: 'CLEAR_CACHE'})`。

**Q: 在 chrome:// 页面无法检测？**
A: 浏览器安全策略限制，chrome://、edge://、about: 等特殊协议页面不支持检测，会提示"当前页面协议不支持检测"。

**Q: 本地诊断模式与云端检测结果会不一致吗？**
A: 可能存在差异。本地诊断基于 URL 与表单特征的启发式规则，覆盖维度有限；云端检测可结合 LLM 语义分析、黑名单、域名相似度等多维特征，准确率更高。后端可用时建议优先使用云端检测。

---

## 运行截图

> 📷 此处可补充运行截图（Popup 各状态、警告横幅、Options 页面等）

---

## 许可证

MIT License

## 贡献

本项目为实验室假期项目，暂不接受外部 PR。

## 联系方式

如有疑问请联系项目负责人。
