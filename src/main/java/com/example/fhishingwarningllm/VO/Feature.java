package com.example.fhishingwarningllm.VO;

import lombok.Data;

@Data
public class Feature {
    boolean isHttps;

    boolean isIp;

    long urlLen;

    long subDomainCount;
}

