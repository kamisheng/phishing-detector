# 钓鱼网站智能预警系统

基于大语言模型语义分析的钓鱼网站实时检测与预警系统，包含 **Spring Boot 后端** 和 **Chrome 浏览器扩展前端**。

## 系统架构

```
Chrome 扩展（前端）                    Spring Boot（后端）
┌──────────────────────┐            ┌──────────────────────┐
│  content-script.js   │  页面信息   │  /api/plugin/detect  │
│  （采集 HTML/文本）    │ ────────→ │  （LLM 语义分析）      │
│                      │            │                      │
│  popup.js            │  检测结果   │  Redis 缓存（24h）     │
│  （结果展示/警告横幅）  │ ←──────── │  MySQL 持久化         │
└──────────────────────┘            └──────────────────────┘
```

---

## 后端

### 技术栈

- **Spring Boot 4.0.7** / Java 17
- **Spring AI 2.0** — 集成大模型（OpenAI 兼容接口）
- **MyBatis-Plus 3.5** — ORM
- **MySQL** — 数据持久化
- **Redis** — 检测结果缓存（24h TTL）

### 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/plugin/detect` | 提交 URL 进行钓鱼检测 |
| GET | `/api/plugin/cache?url={url}` | 查询缓存 |

#### 检测请求

```json
POST /api/plugin/detect
{
  "url": "https://example.com/login",
  "title": "页面标题",
  "html": "<html>...</html>",
  "text": "页面文本",
  "domain": "example.com"
}
```

#### 检测响应

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "level": "high",
    "score": 0.85,
    "desc": "检测到钓鱼特征...",
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

风险等级：`safe` / `low` / `mid` / `high`

### 快速开始

#### 环境要求

- JDK 17+
- MySQL 8.0+
- Redis 6.0+

#### 配置

修改 `src/main/resources/application.yaml`：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/your_db
    username: root
    password: your_password
  ai:
    openai:
      base-url: https://api.openai.com        # 或其他兼容接口
      api-key: ${OPENAI_API_KEY}
      chat:
        options:
          model: gpt-4o
```

#### 运行

```bash
mvn spring-boot:run
```

服务启动在 `http://localhost:8080`。

### 项目结构

```
src/main/java/com/example/fhishingwarningllm/
├── config/
│   ├── AIConfiguration.java      # ChatClient Bean 配置
│   └── RedisConfiguration.java   # Redis 序列化配置
├── controllor/
│   └── Controller.java           # /detect、/cache 接口
├── DTO/
│   └── UrlCheckDTO.java          # 检测请求体
├── VO/
│   ├── UrlCheckVO.java           # 检测响应体
│   └── Feature.java              # URL 特征
└── common/
    ├── Result.java               # 统一响应封装
    └── ResultCode.java           # 状态码枚举
```

---

## 前端（Chrome 扩展）

### 技术栈

- Manifest V3
- 原生 JavaScript（无框架依赖）
- Chrome Extensions API（Storage / Tabs / Notifications）

### 功能

- 自动采集当前页面 HTML、文本、标题、域名
- 调用后端 `/detect` 接口进行 LLM 语义检测
- 四级风险展示：safe / low / mid / high
- 高风险页面注入红色警告横幅 + 浏览器通知
- 本地 domain 级缓存（24h TTL），减少重复请求
- 后端不可用时提示用户连接后端

### 安装

1. 打开 `chrome://extensions`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `phishing-detector/extension` 目录

### 项目结构

```
extension/
├── manifest.json              # 扩展配置
├── background/
│   └── service-worker.js      # 消息中枢、API 调用、缓存管理
├── content/
│   └── content-script.js      # 页面信息采集、警告横幅注入
├── popup/
│   ├── popup.html             # 弹窗界面
│   ├── popup.js               # 检测触发、结果渲染
│   └── popup.css
├── options/
│   ├── options.html           # 设置页面
│   ├── options.js             # API 地址配置、测试连接
│   └── options.css
├── utils/
│   ├── api.js                 # API 请求封装
│   └── storage.js             # 本地存储工具
└── icons/                     # 扩展图标
```

---

## 检测流程

```
用户打开网页
    ↓
Content Script 采集页面信息（HTML/文本/标题/域名）
    ↓
Popup 触发检测
    ↓
1. 查本地缓存（domain 级，24h TTL）→ 命中直接返回
    ↓ 未命中
2. 查服务端缓存 GET /api/plugin/cache → 命中返回
    ↓ 未命中
3. 调用 POST /api/plugin/detect → LLM 语义分析
    ↓
返回风险等级 + 评分 + 描述 + 特征
    ↓
高风险 → 页面顶部红色警告横幅 + 浏览器通知
```
