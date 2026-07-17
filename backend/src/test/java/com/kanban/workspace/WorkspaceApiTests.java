package com.kanban.workspace;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
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

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.datasource.url=jdbc:h2:mem:workspace-api-test;DB_CLOSE_DELAY=-1")
@AutoConfigureTestRestTemplate
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class WorkspaceApiTests {

    private static final Pattern VERSION = Pattern.compile("\"version\":(\\d+)");

    @Autowired
    TestRestTemplate rest;

    private ResponseEntity<String> putJson(String body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange("/api/workspace", HttpMethod.PUT, new HttpEntity<>(body, headers), String.class);
    }

    private String workspaceBody(String title) {
        return """
                {"workspace": {
                  "boards": {"b1": {"boardTitle": "%s", "columns": {}, "columnOrder": [], "cards": {}, "labels": {}}},
                  "boardOrder": ["b1"],
                  "activeBoardId": "b1"
                }}
                """.formatted(title);
    }

    private long versionOf(String body) {
        Matcher m = VERSION.matcher(body == null ? "" : body);
        assertThat(m.find()).isTrue();
        return Long.parseLong(m.group(1));
    }

    @Test
    @Order(1)
    @DisplayName("저장 전에는 404, version은 0")
    void notFoundBeforeFirstSave() {
        ResponseEntity<String> get = rest.getForEntity("/api/workspace", String.class);
        assertThat(get.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

        ResponseEntity<String> version = rest.getForEntity("/api/workspace/version", String.class);
        assertThat(version.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(version.getBody()).contains("\"version\":0");
    }

    @Test
    @Order(2)
    @DisplayName("PUT은 버전을 증가시키고 GET은 저장한 문서를 돌려준다")
    void putIncrementsVersionAndGetReturnsDocument() {
        ResponseEntity<String> first = putJson(workspaceBody("테스트 보드"));
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(first.getBody()).contains("\"version\":1");

        ResponseEntity<String> second = putJson(workspaceBody("테스트 보드 v2"));
        assertThat(second.getBody()).contains("\"version\":2");

        ResponseEntity<String> get = rest.getForEntity("/api/workspace", String.class);
        assertThat(get.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(get.getBody()).contains("\"version\":2");
        assertThat(get.getBody()).contains("테스트 보드 v2");
        assertThat(get.getBody()).contains("\"activeBoardId\":\"b1\"");
    }

    @Test
    @Order(3)
    @DisplayName("형태가 어긋난 페이로드는 422")
    void malformedPayloadIsRejected() {
        ResponseEntity<String> invalidBoards =
                putJson("{\"workspace\": {\"boards\": \"오염\", \"boardOrder\": [], \"activeBoardId\": \"x\"}}");
        assertThat(invalidBoards.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);

        ResponseEntity<String> missingWorkspace = putJson("{\"other\": 1}");
        assertThat(missingWorkspace.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);

        // 실패한 PUT은 버전을 올리지 않는다
        ResponseEntity<String> version = rest.getForEntity("/api/workspace/version", String.class);
        assertThat(version.getBody()).contains("\"version\":2");
    }

    @Test
    @Order(4)
    @DisplayName("baseVersion 선행조건이 어긋나면 409와 현재 버전을 돌려준다")
    void staleBaseVersionIsRejectedWithConflict() {
        ResponseEntity<String> stale = putJson("""
                {"workspace": {
                  "boards": {"b1": {"boardTitle": "낡은 저장", "columns": {}, "columnOrder": [], "cards": {}, "labels": {}}},
                  "boardOrder": ["b1"],
                  "activeBoardId": "b1"
                }, "baseVersion": 1}
                """);
        assertThat(stale.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(stale.getBody()).contains("\"version\":2");

        ResponseEntity<String> matching = putJson("""
                {"workspace": {
                  "boards": {"b1": {"boardTitle": "선행조건 일치", "columns": {}, "columnOrder": [], "cards": {}, "labels": {}}},
                  "boardOrder": ["b1"],
                  "activeBoardId": "b1"
                }, "baseVersion": 2}
                """);
        assertThat(matching.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(matching.getBody()).contains("\"version\":3");
    }

    @Test
    @Order(5)
    @DisplayName("동시 PUT에도 버전이 정확히 증가한다 (행 잠금)")
    void concurrentPutsIncrementVersionExactly() throws InterruptedException {
        long baseVersion = versionOf(rest.getForEntity("/api/workspace/version", String.class).getBody());

        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        ConcurrentLinkedQueue<Long> versions = new ConcurrentLinkedQueue<>();
        CountDownLatch latch = new CountDownLatch(threads);
        for (int i = 0; i < threads; i++) {
            int n = i;
            pool.submit(() -> {
                try {
                    ResponseEntity<String> res = putJson(workspaceBody("동시성 " + n));
                    versions.add(versionOf(res.getBody()));
                } finally {
                    latch.countDown();
                }
            });
        }
        latch.await();
        pool.shutdown();

        // 모든 응답 버전이 서로 달라야 하고(잃어버린 갱신 없음), 최종 버전 = 시작 + 스레드 수
        assertThat(versions).hasSize(threads);
        assertThat(Set.copyOf(versions)).hasSize(threads);
        String after = rest.getForEntity("/api/workspace/version", String.class).getBody();
        assertThat(after).contains("\"version\":" + (baseVersion + threads));
    }

    @Test
    @Order(6)
    @DisplayName("한글·이모지·인용부호가 손상 없이 왕복한다")
    void unicodePayloadRoundTrips() {
        ResponseEntity<String> put = putJson(workspaceBody("한글 🎯 \\\"인용\\\" 테스트"));
        assertThat(put.getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<String> get = rest.getForEntity("/api/workspace", String.class);
        assertThat(get.getBody()).contains("한글 🎯");
        assertThat(get.getBody()).contains("인용");
    }
}
