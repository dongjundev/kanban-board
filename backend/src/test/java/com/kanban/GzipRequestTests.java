package com.kanban;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.zip.GZIPOutputStream;
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

/**
 * gzip 요청 본문(Content-Encoding: gzip) 해제 회귀 테스트.
 * 프론트가 메모·차트 저장 본문을 gzip으로 보내므로, GzipRequestFilter가 빠지면
 * 컨트롤러가 gzip 바이트를 JSON으로 읽다 실패해 저장이 전부 400이 된다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class GzipRequestTests {

    @TempDir
    static Path uploadDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:gzip-test;DB_CLOSE_DELAY=-1");
        registry.add("app.upload-dir", () -> uploadDir.toString());
    }

    @Autowired
    TestRestTemplate rest;

    @Test
    void gzip_본문으로_메모를_저장한다() throws IOException {
        // 회사망에서 막히던 크기대(수십 KB)의 긴 메모 — 한글·이모지가 그대로 왕복해야 한다
        String content = "긴 메모 🎯 ".repeat(3000);
        String json = "{\"content\":\"" + content + "\"}";
        byte[] body = gzip(json);
        assertThat(body.length).isLessThan(json.getBytes(UTF_8).length / 5); // 실제로 압축됐는지

        ResponseEntity<String> created =
                rest.postForEntity("/api/notes", new HttpEntity<>(body, gzipJson()), String.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).contains(content);

        ResponseEntity<String> list = rest.getForEntity("/api/notes", String.class);
        assertThat(list.getBody()).contains(content);
    }

    @Test
    void gzip_본문으로_차트를_저장하고_수정한다() throws IOException {
        ResponseEntity<String> created = rest.postForEntity(
                "/api/diagrams",
                new HttpEntity<>(gzip("{\"title\":\"압축 차트\",\"code\":\"flowchart TD\\n  A --> B\"}"), gzipJson()),
                String.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).contains("압축 차트").contains("A --> B");
        long id = extractFirstId(created.getBody());

        // PUT 경로도 같은 필터를 지난다
        ResponseEntity<String> updated = rest.exchange(
                "/api/diagrams/" + id,
                HttpMethod.PUT,
                new HttpEntity<>(gzip("{\"title\":\"압축 차트 v2\",\"code\":\"flowchart LR\\n  C --> D\"}"), gzipJson()),
                String.class);
        assertThat(updated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(updated.getBody()).contains("압축 차트 v2").contains("C --> D");
    }

    @Test
    void gzip이라고_했지만_평문이면_500이_아니라_400() {
        ResponseEntity<String> res = rest.postForEntity(
                "/api/notes", new HttpEntity<>("{\"content\":\"평문\"}".getBytes(UTF_8), gzipJson()), String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void 풀린_본문이_한도를_넘으면_400() throws IOException {
        // gzip 폭탄 방어 — 51MB의 공백(압축하면 ~50KB)을 JSON 토큰 사이에 끼워 파서가 끝까지 읽게 한다.
        // 공백은 파서가 버퍼에 쌓지 않으므로 테스트 자체는 가볍다.
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
            gz.write("{\"content\":\"x\"".getBytes(UTF_8));
            byte[] spaces = new byte[64 * 1024];
            Arrays.fill(spaces, (byte) ' ');
            for (int i = 0; i < 51 * 16; i++) {
                gz.write(spaces);
            }
            gz.write("}".getBytes(UTF_8));
        }
        ResponseEntity<String> res = rest.postForEntity(
                "/api/notes", new HttpEntity<>(bytes.toByteArray(), gzipJson()), String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            gz.write(text.getBytes(UTF_8));
        }
        return out.toByteArray();
    }

    private static HttpHeaders gzipJson() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.CONTENT_ENCODING, "gzip");
        return headers;
    }

    private long extractFirstId(String jsonBody) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"id\":(\\d+)").matcher(jsonBody);
        assertThat(m.find()).isTrue();
        return Long.parseLong(m.group(1));
    }
}
