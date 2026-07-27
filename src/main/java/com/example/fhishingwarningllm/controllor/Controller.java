package com.example.fhishingwarningllm.controllor;

import com.example.fhishingwarningllm.DTO.UrlCheckDTO;
import com.example.fhishingwarningllm.VO.UrlCheckVO;
import com.example.fhishingwarningllm.common.Result;
import jakarta.annotation.Resource;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;

@RestController
@RequestMapping("/api/plugin")
public class Controller {

    @Resource(name = "clientOpenAi")
    private ChatClient chatClient;

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String CACHE_PREFIX = "url:check:";
    private static final Duration CACHE_TTL = Duration.ofHours(24);

    @PostMapping("/detect")
    public Result<UrlCheckVO> urlCheck(@RequestBody UrlCheckDTO urlCheckDTO) {
        UrlCheckVO result = chatClient.prompt()
                .system("""
                        你是一个钓鱼网站检测专家。根据用户提供的网页信息，分析该URL是否为钓鱼网站。
                        
                        返回JSON格式，字段说明：
                        - level: 风险等级，**必须为以下四个值之一**（小写）：`safe` / `low` / `mid` / `high`
                        - score: 风险评分，范围 `0.0 ~ 1.0`，0 最安全，1 最危险
                        - desc: 风险描述，会直接展示给用户，建议 50-200 字
                        - feature: URL 特征对象，前端会用于详情面板展示（不传则前端本地计算）
                        -- isHttps: 是否使用HTTPS协议
                        -- isIp: 域名是否为IP地址（而非正常域名）
                        -- urlLen: url长度
                        -- subDomainCount: 子域名数量
                        - recordId: 检测记录 ID，**用户反馈接口依赖此字段**，建议返回
                        
                        JSON格式示例：
                        {
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
                        
                        风险等级语义:
                        
                        | level  | score 区间  | 含义   | 前端表现                                          |
                        | ------ | ---------- | ------| ------------------------------------------------  |
                        | `safe` | 0.0 - 0.19 | 安全   | 绿色 ✓ 图标，无警告                                 |
                        | `low`  | 0.2 - 0.39 | 低风险 | 橙色 ! 图标，popup 显示警告                          |
                        | `mid`  | 0.4 - 0.69 | 中风险 | 橙色 ! 图标，popup 显示警告                          |
                        | `high` | 0.7 - 1.0  | 高风险 | 红色 X 图标 + **页面顶部红色警告横幅** + **浏览器通知** |
                        
                        ⚠️ **重要**：`level` 字段必须严格使用上述四个小写值之一，前端依据此值决定是否注入警告横幅和发送通知
                        
                        """)
                .user(u -> u.text("""
                        请分析以下网页：
                        URL: {url}
                        标题: {title}
                        html：{html}
                        域名: {domain}
                        页面文本: {text}
                        """)
                        .param("url", urlCheckDTO.getUrl())
                        .param("title", urlCheckDTO.getTitle())
                        .param("html", urlCheckDTO.getHtml())
                        .param("domain", urlCheckDTO.getDomain())
                        .param("text", urlCheckDTO.getText()))
                .call()
                .entity(UrlCheckVO.class);

        // 写入缓存
        redisTemplate.opsForValue().set(CACHE_PREFIX + urlCheckDTO.getUrl(), result, CACHE_TTL);

        return Result.success(result);
    }

    @GetMapping("/cache")
    public Result<UrlCheckVO> cacheCheck(@RequestParam String url) {
        Object cached = redisTemplate.opsForValue().get(CACHE_PREFIX + url);
        if (cached != null) {
            return Result.success("hit", (UrlCheckVO) cached).hit(true);
        }
        return Result.<UrlCheckVO>success("miss", null).hit(false);
    }


}
