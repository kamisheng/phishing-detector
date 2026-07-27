# 钓鱼网站智能预警系统 - 后端接口交接文档

> 本文档供后端同学参考，描述浏览器扩展（前端）对后端的所有接口依赖、数据结构约定、调用时机与降级策略。

---

## 一、总览

### 1.1 接口清单

| 序号 | 接口 | 方法 | 路径 | 用途 | 优先级 |
|------|------|------|------|------|--------|
| 1 | URL 检测 | POST | `/api/plugin/detect` | 提交 URL 进行钓鱼检测 | **P0（核心）** |
| 2 | 检测缓存查询 | GET | `/api/plugin/cache` | 查询某 URL 是否已有检测结果 | P1 |
| 3 | 用户反馈 | POST | `/api/plugin/feedback` | 用户举报/纠错 | P2 |
| 4 | 检测历史 | GET | `/api/plugin/history` | 查询历史检测记录 | P2 |
| 5 | 检测统计 | GET | `/api/plugin/statistics` | 获取统计数据 | P3 |
| 6 | 云端配置获取 | GET | `/api/plugin/config` | 获取云端下发配置 | P3 |
| 7 | 配置同步 | POST | `/api/plugin/config/sync` | 上报本地配置 | P3 |

### 1.2 基础信息

- **默认 BaseUrl**：`http://localhost:8080`（用户可在 Options 页面修改）
- **协议**：HTTP/HTTPS 均可
- **数据格式**：JSON（请求体与响应体均为 `application/json`）
- **字符编码**：UTF-8

---

## 二、通用约定

### 2.1 请求头（所有接口统一）

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | 固定 `application/json` |
| `X-Device-ID` | 是 | 设备唯一标识，UUID v4 格式（如 `550e8400-e29b-41d4-a716-446655440000`）。首次安装时由插件生成并持久化，卸载后清除。**用于服务端识别同一设备的检测历史与缓存** |
| `X-Plugin-Version` | 否 | 插件版本号（如 `1.0.0`），取自 manifest.json，便于服务端做版本兼容 |

### 2.2 统一响应格式

所有接口响应采用如下结构：

```json
{
  "code": 200,
  "msg": "success",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | number | 业务状态码，`200` 表示成功，其他表示失败 |
| `msg` | string | 状态描述，失败时为可读错误信息 |
| `data` | object/array | 业务数据，成功时返回，失败时可为 null |

**前端处理逻辑**：
- HTTP 状态码非 2xx → 抛出 `[HTTP {status}] {msg}` 错误
- `code !== 200` → 抛出 `[code={code}] {msg}` 错误
- 网络异常/超时 → **自动降级到本地启发式检测**（详见第六节）

### 2.3 错误码建议

| code | 含义 | 前端处理 |
|------|------|---------|
| 200 | 成功 | 正常处理 |
| 400 | 参数错误 | 显示错误提示 |
| 401 | 设备 ID 缺失/非法 | 显示错误提示 |
| 429 | 请求频率超限 | 显示"请稍后重试" |
| 500 | 服务端内部错误 | **降级到本地检测** |
| 503 | 服务暂不可用 | **降级到本地检测** |

---

## 三、核心接口详解

### 3.1 URL 检测（最重要）

**这是整个系统的核心接口，必须优先实现。**

```
POST /api/plugin/detect
```

#### 请求体

```json
{
  "url": "https://example.com/login",
  "title": "用户登录 - 某某银行",
  "html": "<html>...</html>",
  "text": "页面可见文本内容...",
  "domain": "example.com"
}
```

| 字段 | 类型 | 必填 | 说明 | 限制 |
|------|------|------|------|------|
| `url` | string | 是 | 完整 URL（含协议） | 已过滤 chrome:// edge:// about:// 等特殊协议，保证是 http/https |
| `title` | string | 否 | 页面 `<title>` | 可为空字符串 |
| `html` | string | 否 | 页面 HTML 内容 | **前端已截断为前 500,000 字符**（约 500KB），避免超大页面压垮后端 |
| `text` | string | 否 | 页面正文文本 | **前端已截断为前 10,000 字符** |
| `domain` | string | 否 | 域名（hostname） | 如 `example.com` |

#### 响应体

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "level": "high",
    "score": 0.85,
    "desc": "检测到该网站存在钓鱼特征：使用 IP 直连、含登录表单且未加密、URL 含可疑关键词 login",
    "feature": {
      "isHttps": false,
      "isIp": true,
      "urlLen": 45,
      "subDomainCount": 2
    },
    "recordId": "rec_20260726_001"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `data.level` | string | **是** | 风险等级，**必须为以下四个值之一**（小写）：`safe` / `low` / `mid` / `high` |
| `data.score` | number | **是** | 风险评分，范围 `0.0 ~ 1.0`，0 最安全，1 最危险 |
| `data.desc` | string | **是** | 风险描述，会直接展示给用户，建议 50-200 字 |
| `data.feature` | object | 否 | URL 特征对象，前端会用于详情面板展示（不传则前端本地计算） |
| `data.recordId` | string | 否 | 检测记录 ID，**用户反馈接口依赖此字段**，建议返回 |

#### 风险等级语义

| level | score 区间 | 含义 | 前端表现 |
|-------|-----------|------|---------|
| `safe` | 0.0 - 0.19 | 安全 | 绿色 ✓ 图标，无警告 |
| `low` | 0.2 - 0.39 | 低风险 | 橙色 ! 图标，popup 显示警告 |
| `mid` | 0.4 - 0.69 | 中风险 | 橙色 ! 图标，popup 显示警告 |
| `high` | 0.7 - 1.0 | 高风险 | 红色 X 图标 + **页面顶部红色警告横幅** + **浏览器通知** |

> ⚠️ **重要**：`level` 字段必须严格使用上述四个小写值之一，前端依据此值决定是否注入警告横幅和发送通知。

#### feature 对象结构（可选）

如果后端有更丰富的特征分析，可返回此字段；不返回时前端用本地特征兜底：

```json
{
  "isHttps": true,
  "isIp": false,
  "urlLen": 45,
  "subDomainCount": 2
}
```

#### 超时说明

前端对此接口设置 **30 秒超时**（检测可能涉及 LLM 语义分析）。超时后前端会：
1. 抛出 "检测请求超时（30s），请稍后重试"
2. **自动降级到本地启发式检测**，用户无感知

---

### 3.2 检测缓存查询

**用途**：减少重复检测的 API 调用。前端在调用 `/detect` 前会先查此接口。

```
GET /api/plugin/cache?url={url}
```

#### 请求参数（Query）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 完整 URL，需 URL Encode |

#### 请求示例

```
GET /api/plugin/cache?url=https%3A%2F%2Fexample.com%2Flogin
```

#### 响应体

**缓存命中**：
```json
{
  "code": 200,
  "msg": "hit",
  "data": {
    "level": "high",
    "score": 0.85,
    "desc": "...",
    "feature": { ... },
    "recordId": "rec_20260726_001"
  },
  "hit": true
}
```

**缓存未命中**：
```json
{
  "code": 200,
  "msg": "miss",
  "data": null,
  "hit": false
}
```

> 💡 前端兼容两种返回结构：`{ hit: true, data }` 或 `{ code: 200, data }`。**建议同时返回 `hit` 布尔字段**，语义更清晰。

#### 缓存策略说明

- 前端本地也有 24h TTL 的 domain 级缓存
- 服务端缓存查询失败时，前端会忽略错误并继续走 `/detect` 接口（**缓存查询失败不阻塞主流程**）
- 建议服务端缓存 TTL ≥ 24h，与前端对齐

---

### 3.3 用户反馈

**用途**：用户对检测结果有异议时，可上报"误报"或"漏报"。

```
POST /api/plugin/feedback
```

#### 请求体

```json
{
  "recordId": "rec_20260726_001",
  "feedback": "phishing"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `recordId` | string | 是 | 检测记录 ID（来自 `/detect` 响应） |
| `feedback` | string | 是 | 反馈类型，前端会传以下值之一：<br>`phishing` - 用户认为是钓鱼网站（漏报）<br>`safe` - 用户认为是安全网站（误报）<br>或自由文本反馈 |

#### 响应体

```json
{
  "code": 200,
  "msg": "反馈已提交",
  "data": { "feedbackId": "fb_001" }
}
```

---

### 3.4 检测历史

**用途**：查询某设备的历史检测记录。

```
GET /api/plugin/history?page=1&pageSize=20&startDate=2026-01-01&endDate=2026-07-26
```

#### 请求参数（Query）

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `page` | number | 否 | 1 | 页码 |
| `pageSize` | number | 否 | 20 | 每页条数 |
| `startDate` | string | 否 | - | 起始日期 `YYYY-MM-DD` |
| `endDate` | string | 否 | - | 截止日期 `YYYY-MM-DD` |
| `url` | string | 否 | - | 按URL模糊查询 |

> 📌 历史查询**基于 `X-Device-ID` 隔离**，后端应只返回当前设备的历史记录。

#### 响应体

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "list": [
      {
        "url": "https://example.com/login",
        "level": "high",
        "score": 0.85,
        "desc": "...",
        "recordId": "rec_20260726_001",
        "detectTime": "2026-07-26 10:30:00"
      }
    ],
    "total": 156
  }
}
```

#### 降级策略

**此接口失败时**，前端会回退到本地存储的历史记录（最多 50 条），不阻塞用户使用。

---

### 3.5 检测统计

**用途**：获取统计数据，用于后续 dashboard 展示。

```
GET /api/plugin/statistics
```

#### 响应体（建议结构）

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "total": 156,
    "highRisk": 23,
    "midRisk": 45,
    "lowRisk": 38,
    "safe": 50,
    "byDate": [
      { "date": "2026-07-26", "count": 12, "highRisk": 3 }
    ]
  }
}
```

> 📌 同样基于 `X-Device-ID` 隔离。此接口为 P3 优先级，可后续实现。

---

### 3.6 云端配置获取

**用途**：服务端下发配置（如黑名单更新、阈值调整）。

```
GET /api/plugin/config
```

#### 响应体（建议结构）

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "riskThresholds": {
      "high": 0.7,
      "mid": 0.4,
      "low": 0.2
    },
    "blacklist": ["evil-phishing.com", "fake-bank-login.com"],
    "whitelist": ["google.com", "baidu.com"],
    "suspiciousKeywords": ["login", "verify", "free"]
  }
}
```

> 💡 此接口也用于 Options 页面的"测试连接"按钮。前端会发 `GET /api/plugin/config` 验证后端是否可达，**返回 HTTP 200 即视为连接成功**，响应体内容不强制要求。

---

### 3.7 配置同步

**用途**：前端将本地配置上报到服务端，便于跨设备同步。

```
POST /api/plugin/config/sync
```

#### 请求体

```json
{
  "configs": {
    "autoDetect": true,
    "warningPopupEnabled": true,
    "notifyHighOnly": false,
    "minDetectInterval": 60,
    "apiBaseUrl": "http://localhost:8080"
  }
}
```

#### 响应体

```json
{
  "code": 200,
  "msg": "配置已同步",
  "data": null
}
```

---

## 四、前端降级策略（重要）

**前端具备完整的离线降级能力**，后端任何接口不可用时都不会让用户卡死：

```
用户点击检测
    ↓
1. 查本地缓存（domain 级，24h TTL）→ 命中直接返回
    ↓ 未命中
2. 查服务端缓存 GET /api/plugin/cache → 命中返回
    ↓ 未命中
3. 调用检测 POST /api/plugin/detect
    ↓
    ├─ 成功 → 返回后端结果
    └─ 失败（网络错误/超时/HTTP错误）
        ↓
        自动降级到本地启发式检测 mockDetectUrl()
        → 基于 URL 特征 + 页面表单特征计算风险
        → 返回结果，标记 source: 'mock'
```

### 本地启发式检测规则（供后端参考）

前端本地检测会检查以下特征并累加评分：

| 检查项 | 加分 |
|--------|------|
| 无 HTTPS | +0.30 |
| IP 直连 | +0.30 |
| URL 含 @ | +0.20 |
| URL > 75 字符 | +0.15 |
| 子域名 > 3 层 | +0.15 |
| 含可疑关键词（login/verify/bank 等） | +0.25 |
| 非标准端口 | +0.10 |
| 登录表单 + 非 HTTPS | +0.30 |
| 域名连字符 ≥ 3 | +0.15 |
| 纯数字域名 | +0.10 |

**建议后端检测能力应显著优于上述规则**，重点可考虑：
- HTML 内容语义分析（页面是否仿冒知名站点）
- 域名相似度计算（与真实站点 Levenshtein 距离）
- 历史黑名单匹配
- LLM 辅助判断（可选）

---

## 五、前端数据采集说明

### 5.1 Content Script 采集的页面信息

前端通过 Content Script 采集以下信息提交给后端：

```javascript
{
  url: "https://example.com/page",      // 完整 URL
  title: "页面标题",                      // document.title
  text: "页面正文文本...",                // document.body.textContent，已截断为 10000 字符
  html: "<html>...</html>",              // outerHTML，已截断为 500000 字符
  domain: "example.com",                 // hostname
  protocol: "https:",                    // 协议
  meta: {
    description: "meta description",     // meta 标签内容
    keywords: "meta keywords"
  },
  forms: {
    hasLoginForm: true,                  // 是否含登录表单（启发式判断）
    hasPasswordField: true,              // 是否含密码输入框
    formCount: 2                         // 表单总数（最多扫描 50 个）
  }
}
```

### 5.2 采集限制

为避免超大页面（10万+字符）导致性能问题，前端已做以下限制：
- `text` 截断为前 10,000 字符
- `html` 截断为前 500,000 字符（约 500KB）
- `forms` 最多扫描 50 个表单

**后端应能处理截断后的数据**，不应假设收到完整的 HTML。

---

## 六、实施建议

### 6.1 优先级排序

| 阶段 | 接口 | 说明 |
|------|------|------|
| **MVP** | `/detect` | 核心检测接口，必须先实现 |
| **V1** | `/cache` | 缓存查询，减少重复检测压力 |
| **V1** | `/history` | 历史记录（前端有本地兜底） |
| **V2** | `/feedback` | 用户反馈 |
| **V2** | `/config` | 云端配置下发 |
| **V3** | `/statistics` | 统计数据 |
| **V3** | `/config/sync` | 配置同步 |

### 6.2 性能要求

| 接口 | 建议响应时间 | 说明 |
|------|------------|------|
| `/detect` | < 5s（普通）<br>< 30s（含 LLM） | 前端 30s 超时，超时降级 |
| `/cache` | < 200ms | 缓存查询应极快 |
| `/history` | < 1s | 分页查询 |
| 其他 | < 1s | - |

### 6.3 并发与限流建议

- 单设备 QPS 预估：≤ 1 QPS（用户手动触发 + 自动检测有 60s 间隔）
- 建议限流：单 deviceId 10 次/分钟
- 建议熔断：连续失败时返回 503，前端会自动降级

### 6.4 安全建议

- `X-Device-ID` 可作为软身份识别，但**不应作为安全边界**（用户可清除扩展数据重新生成）
- `/feedback` 接口建议加频率限制，防止滥用
- HTML 内容可能含恶意脚本，后端处理时注意 XSS 防护（仅做文本分析，不要回显或执行）

---

## 七、联调方式

### 7.1 本地启动

1. 后端启动在 `http://localhost:8080`
2. 前端 Options 页面默认 API 地址已是 `http://localhost:8080`
3. Options 页面有"测试连接"按钮，会发 `GET /api/plugin/config` 验证连通性

### 7.2 调试技巧

- 前端所有 API 调用日志可在 Service Worker 控制台查看
- 路径：`chrome://extensions` → 找到本扩展 → 点击 "Service Worker" 链接
- 前端会打印降级日志：`[ServiceWorker] 后端检测失败，降级到本地诊断: {错误信息}`

### 7.3 Mock 数据示例

开发初期可用以下 Mock 响应测试前端：

```json
// POST /api/plugin/detect 响应
{
  "code": 200,
  "msg": "success",
  "data": {
    "level": "high",
    "score": 0.85,
    "desc": "检测到钓鱼特征：URL 使用 IP 直连，含登录表单且未加密",
    "feature": {
      "isHttps": false,
      "isIp": true,
      "urlLen": 45,
      "subDomainCount": 2
    },
    "recordId": "rec_mock_001"
  }
}
```

---

## 八、字段命名约定

为避免前后端字段不一致，约定如下：

### 8.1 风险等级（必须小写）

| 值 | 含义 |
|----|------|
| `safe` | 安全 |
| `low` | 低风险 |
| `mid` | 中风险 |
| `high` | 高风险 |

> ⚠️ **禁止使用** `SAFE`/`LOW`/`MEDIUM`/`HIGH`/`medium` 等其他大小写形式。前端虽做了兼容处理，但建议严格按小写规范返回。

### 8.2 日期格式

- 日期：`YYYY-MM-DD`（如 `2026-07-26`）
- 时间戳：建议使用 ISO 8601 字符串或 Unix 毫秒时间戳，前端会做兼容

### 8.3 字段命名风格

- 后端返回字段建议使用 **camelCase**（与前端一致）
- 如使用 snake_case（如 `risk_level`），前端会做兼容但增加复杂度

---

## 九、变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-26 | v1.0 | 初始版本，含 7 个接口定义 |

---

## 附：前端代码位置参考

后端同学如需查看前端实现细节：

| 模块 | 文件 | 说明 |
|------|------|------|
| API 封装 | `utils/api.js` | 所有接口的封装方法 |
| 检测流程 | `background/service-worker.js` | DETECT_URL 处理函数 |
| 本地降级 | `background/service-worker.js` `mockDetectUrl()` | 启发式检测规则 |
| Content Script | `content/content-script.js` | 页面信息采集 |
| Popup 展示 | `popup/popup.js` | 检测结果渲染 |
