package com.kanban;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 동기화 API가 캐시되지 않도록 하는 헤더 회귀 테스트.
 * 이 헤더가 빠지면 중간 캐시가 응답을 재사용해, 다른 PC에서 새로고침해도
 * 변경이 간헐적으로 반영되지 않는 형태로 나타난다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class NoCacheTests {

    @TempDir
    static Path uploadDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:nocache-test;DB_CLOSE_DELAY=-1");
        registry.add("app.upload-dir", () -> uploadDir.toString());
    }

    @Autowired
    TestRestTemplate rest;

    @Test
    void 동기화_api는_캐시_금지를_명시한다() {
        for (String path : new String[] {"/api/workspace/version", "/api/notes", "/api/diagrams", "/api/auth/me"}) {
            ResponseEntity<String> res = rest.getForEntity(path, String.class);
            String cacheControl = res.getHeaders().getFirst(HttpHeaders.CACHE_CONTROL);
            assertThat(cacheControl)
                    .as("%s 의 Cache-Control", path)
                    .isNotNull()
                    .contains("no-store");
        }
    }
}
