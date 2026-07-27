package com.example.fhishingwarningllm.VO;

import lombok.Data;

@Data
public class UrlCheckVO {

    private String level;

    private double score;

    private String desc;

    private Feature feature;

    private String recordId;
}
