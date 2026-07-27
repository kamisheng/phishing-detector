# 钓鱼网站智能预警系统 - 后端

基于 Spring Boot 4.0 + Spring AI 2.0 的钓鱼网站检测后端服务，通过大语言模型对网页内容进行语义分析，识别钓鱼/欺诈网站。

## 技术栈

- **Spring Boot 4.0.7** / Java 17
- **Spring AI 2.0** — 集成大模型（OpenAI 兼容接口）
- **MyBatis-Plus 3.5** — ORM
- **MySQL** — 数据持久化
- **Redis** — 检测结果缓存（24h TTL）

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/plugin/detect` | 提交 URL 进行钓鱼检测 |
| GET | `/api/plugin/cache?url={url}` | 查询缓存 |

### 检测请求

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

### 检测响应

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

## 快速开始

### 环境要求

- JDK 17+
- MySQL 8.0+
- Redis 6.0+

### 配置

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

### 运行

```bash
mvn spring-boot:run
```

服务启动在 `http://localhost:8080`。

## 项目结构

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

## 配套前端

浏览器扩展项目：[phishing-detector](https://github.com/your-org/phishing-detector)（Chrome 扩展，负责页面信息采集与结果展示）
