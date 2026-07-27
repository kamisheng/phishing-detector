package com.example.fhishingwarningllm.common;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.io.Serializable;

/**
 * 统一响应结果类
 * @author YourName
 * @date 2026-07-26
 */
@Data
@NoArgsConstructor
@ToString
@JsonInclude(JsonInclude.Include.NON_NULL)  // 忽略 null 字段
public class Result<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 业务状态码，200 表示成功
     */
    private Integer code;

    /**
     * 状态描述信息
     */
    private String msg;

    /**
     * 业务数据
     */
    private T data;

    /**
     * 缓存命中标记（仅缓存查询接口使用）
     */
    private Boolean hit;

    public Result(Integer code, String msg, T data) {
        this.code = code;
        this.msg = msg;
        this.data = data;
    }

    // ======================== 成功响应 ========================

    /**
     * 成功响应（无数据）
     */
    public static <T> Result<T> success() {
        return new Result<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMsg(), null);
    }

    /**
     * 成功响应（带数据）
     */
    public static <T> Result<T> success(T data) {
        return new Result<>(ResultCode.SUCCESS.getCode(), ResultCode.SUCCESS.getMsg(), data);
    }

    /**
     * 成功响应（自定义消息，带数据）
     */
    public static <T> Result<T> success(String msg, T data) {
        return new Result<>(ResultCode.SUCCESS.getCode(), msg, data);
    }

    /**
     * 成功响应（自定义状态码和消息，带数据）
     */
    public static <T> Result<T> success(Integer code, String msg, T data) {
        return new Result<>(code, msg, data);
    }

    // ======================== 失败响应 ========================

    /**
     * 失败响应（使用默认错误码 500）
     */
    public static <T> Result<T> error() {
        return new Result<>(ResultCode.ERROR.getCode(), ResultCode.ERROR.getMsg(), null);
    }

    /**
     * 失败响应（自定义错误消息，使用默认错误码 500）
     */
    public static <T> Result<T> error(String msg) {
        return new Result<>(ResultCode.ERROR.getCode(), msg, null);
    }

    /**
     * 失败响应（自定义错误码和消息）
     */
    public static <T> Result<T> error(Integer code, String msg) {
        return new Result<>(code, msg, null);
    }

    /**
     * 失败响应（使用枚举）
     */
    public static <T> Result<T> error(ResultCode resultCode) {
        return new Result<>(resultCode.getCode(), resultCode.getMsg(), null);
    }

    /**
     * 失败响应（使用枚举，自定义消息）
     */
    public static <T> Result<T> error(ResultCode resultCode, String msg) {
        return new Result<>(resultCode.getCode(), msg, null);
    }

    /**
     * 失败响应（带数据，使用默认错误码 500）
     */
    public static <T> Result<T> error(String msg, T data) {
        return new Result<>(ResultCode.ERROR.getCode(), msg, data);
    }

    // ======================== 链式调用 ========================

    /**
     * 设置状态码（链式）
     */
    public Result<T> code(Integer code) {
        this.code = code;
        return this;
    }

    /**
     * 设置消息（链式）
     */
    public Result<T> msg(String msg) {
        this.msg = msg;
        return this;
    }

    /**
     * 设置数据（链式）
     */
    public Result<T> data(T data) {
        this.data = data;
        return this;
    }

    /**
     * 设置缓存命中标记（链式）
     */
    public Result<T> hit(Boolean hit) {
        this.hit = hit;
        return this;
    }

    // ======================== 便捷判断 ========================

    /**
     * 判断是否成功
     */
    public boolean isSuccess() {
        return this.code != null && this.code.equals(ResultCode.SUCCESS.getCode());
    }

    /**
     * 判断是否失败
     */
    public boolean isError() {
        return !isSuccess();
    }
}
