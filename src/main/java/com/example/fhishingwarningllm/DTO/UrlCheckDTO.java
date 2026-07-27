package com.example.fhishingwarningllm.DTO;

import lombok.Data;

@Data
public class UrlCheckDTO {

    private String url;

    private String title;

    private String html;

    private String text;

    private String domain;

}
