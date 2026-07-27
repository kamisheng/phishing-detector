package com.example.fhishingwarningllm.common;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 业务状态码枚举
 */
@Getter
@AllArgsConstructor
public enum ResultCode {

    // ======================== 成功 ========================
    SUCCESS(200, "success"),

    // ======================== 通用错误 1000-1999 ========================
    ERROR(500, "系统异常，请稍后重试"),
    BAD_REQUEST(1001, "请求参数错误"),
    VALIDATE_FAILED(1002, "参数校验失败"),
    UNAUTHORIZED(1003, "未授权，请重新登录"),
    FORBIDDEN(1004, "权限不足"),
    NOT_FOUND(1005, "资源不存在"),
    METHOD_NOT_ALLOWED(1006, "请求方法不允许"),
    UNSUPPORTED_MEDIA_TYPE(1007, "不支持的媒体类型"),
    TOO_MANY_REQUESTS(1008, "请求过于频繁，请稍后重试"),

    // ======================== 业务错误 2000-2999 ========================
    SERVICE_ERROR(2001, "业务处理失败"),
    DATA_NOT_FOUND(2002, "数据不存在"),
    DATA_EXISTS(2003, "数据已存在"),
    DATA_SAVE_FAILED(2004, "数据保存失败"),
    DATA_UPDATE_FAILED(2005, "数据更新失败"),
    DATA_DELETE_FAILED(2006, "数据删除失败"),
    FILE_UPLOAD_FAILED(2007, "文件上传失败"),
    FILE_DOWNLOAD_FAILED(2008, "文件下载失败"),

    // ======================== 检测业务错误 3000-3999 ========================
    DETECT_FAILED(3001, "钓鱼检测失败"),
    DETECT_TIMEOUT(3002, "检测超时"),
    LLM_SERVICE_ERROR(3003, "LLM服务异常"),
    ML_SERVICE_ERROR(3004, "机器学习模型服务异常"),
    URL_INVALID(3005, "URL格式无效"),
    URL_ACCESS_FAILED(3006, "URL访问失败"),
    DEVICE_NOT_FOUND(3007, "设备不存在"),

    // ======================== 数据库错误 4000-4999 ========================
    DB_ERROR(4001, "数据库操作异常"),
    DB_INSERT_ERROR(4002, "数据插入失败"),
    DB_UPDATE_ERROR(4003, "数据更新失败"),
    DB_DELETE_ERROR(4004, "数据删除失败"),
    DB_QUERY_ERROR(4005, "数据查询失败"),
    DUPLICATE_KEY_ERROR(4006, "数据重复");

    private final Integer code;
    private final String msg;
}