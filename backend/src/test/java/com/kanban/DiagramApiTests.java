package com.kanban;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class DiagramApiTests {

    // 업로드 경로 기본값(./uploads)이 테스트 실행으로 생기지 않게 임시 디렉토리로 돌린다
    @TempDir
    static Path uploadDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:diagram-test;DB_CLOSE_DELAY=-1");
        registry.add("app.upload-dir", () -> uploadDir.toString());
    }

    @Autowired
    TestRestTemplate rest;

    @Test
    void diagramCrud() {
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);

        // 생성 — 줄바꿈·한글이 그대로 왕복되는지
        String body = "{\"title\":\"배포 구조\",\"code\":\"flowchart TD\\n  A[요청] --> B[(DB)]\"}";
        ResponseEntity<String> created =
                rest.postForEntity("/api/diagrams", new HttpEntity<>(body, json), String.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).contains("배포 구조").contains("A[요청] --> B[(DB)]");
        long id = extractFirstId(created.getBody());

        // 목록에 code까지 포함 — 프론트가 개별 조회 없이 바로 불러올 수 있어야 한다
        ResponseEntity<String> list = rest.getForEntity("/api/diagrams", String.class);
        assertThat(list.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(list.getBody()).contains("배포 구조").contains("flowchart TD");

        // 수정 — 같은 id를 덮어쓰고 새 행을 만들지 않는다
        String updated = "{\"title\":\"배포 구조 v2\",\"code\":\"sequenceDiagram\\n  A->>B: 안녕\"}";
        ResponseEntity<String> put = rest.exchange(
                "/api/diagrams/" + id, HttpMethod.PUT, new HttpEntity<>(updated, json), String.class);
        assertThat(put.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(put.getBody()).contains("배포 구조 v2");

        ResponseEntity<String> afterUpdate = rest.getForEntity("/api/diagrams", String.class);
        assertThat(afterUpdate.getBody()).contains("배포 구조 v2").doesNotContain("flowchart TD");
        assertThat(countOccurrences(afterUpdate.getBody(), "\"id\":")).isEqualTo(1);

        // 제목/코드가 비면 400
        ResponseEntity<String> blank = rest.postForEntity(
                "/api/diagrams", new HttpEntity<>("{\"title\":\"  \",\"code\":\"flowchart TD\"}", json), String.class);
        assertThat(blank.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        // 없는 id 수정은 404
        ResponseEntity<String> missing = rest.exchange(
                "/api/diagrams/999999", HttpMethod.PUT, new HttpEntity<>(updated, json), String.class);
        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        // 삭제
        rest.exchange("/api/diagrams/" + id, HttpMethod.DELETE, null, Void.class);
        ResponseEntity<String> afterDelete = rest.getForEntity("/api/diagrams", String.class);
        assertThat(afterDelete.getBody()).doesNotContain("배포 구조");
    }

    @Test
    void 너무_긴_제목은_500이_아니라_400() {
        // 제목 컬럼은 varchar(255) — 검증이 없으면 DB 제약 위반이 500으로 새어 나간다.
        // UI 입력칸에도 길이 제한이 있지만 API를 직접 호출하면 도달 가능하다.
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        String longTitle = "가".repeat(300);
        ResponseEntity<String> res = rest.postForEntity(
                "/api/diagrams",
                new HttpEntity<>("{\"title\":\"" + longTitle + "\",\"code\":\"flowchart TD\\n A-->B\"}", json),
                String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private long extractFirstId(String jsonBody) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"id\":(\\d+)").matcher(jsonBody);
        assertThat(m.find()).isTrue();
        return Long.parseLong(m.group(1));
    }

    private int countOccurrences(String haystack, String needle) {
        return haystack.split(java.util.regex.Pattern.quote(needle), -1).length - 1;
    }
}
