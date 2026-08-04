package com.kanban;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class MemoApiTests {

    @TempDir
    static Path uploadDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:memo-test;DB_CLOSE_DELAY=-1");
        registry.add("app.upload-dir", () -> uploadDir.toString());
    }

    @Autowired
    TestRestTemplate rest;

    @Test
    void noteCrud() {
        // 생성
        HttpHeaders json = new HttpHeaders();
        json.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> created = rest.postForEntity(
                "/api/notes", new HttpEntity<>("{\"content\":\"첫 메모 🎯\"}", json), String.class);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).contains("첫 메모 🎯");

        // 목록에 포함
        ResponseEntity<String> list = rest.getForEntity("/api/notes", String.class);
        assertThat(list.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(list.getBody()).contains("첫 메모 🎯");

        // 빈 내용은 400
        ResponseEntity<String> blank = rest.postForEntity(
                "/api/notes", new HttpEntity<>("{\"content\":\"   \"}", json), String.class);
        assertThat(blank.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        // 삭제
        long id = extractFirstId(list.getBody());
        rest.delete("/api/notes/" + id);
        ResponseEntity<String> afterDelete = rest.getForEntity("/api/notes", String.class);
        assertThat(afterDelete.getBody()).doesNotContain("\"id\":" + id + ",");
    }

    @Test
    void fileUploadDownloadDelete() {
        byte[] content = "안녕하세요 파일 내용".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new ByteArrayResource(content) {
            @Override
            public String getFilename() {
                return "테스트.txt";
            }
        });
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        // 업로드
        ResponseEntity<String> uploaded =
                rest.postForEntity("/api/files", new HttpEntity<>(body, headers), String.class);
        assertThat(uploaded.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(uploaded.getBody()).contains("테스트.txt");
        long id = extractFirstId(uploaded.getBody());

        // 다운로드 — 바이트 일치
        ResponseEntity<byte[]> downloaded = rest.getForEntity("/api/files/" + id, byte[].class);
        assertThat(downloaded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(downloaded.getBody()).isEqualTo(content);

        // 삭제 → 다운로드 404
        rest.exchange("/api/files/" + id, HttpMethod.DELETE, null, Void.class);
        ResponseEntity<byte[]> afterDelete = rest.getForEntity("/api/files/" + id, byte[].class);
        assertThat(afterDelete.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    /** JSON 응답에서 첫 번째 "id":N 값을 추출. */
    private long extractFirstId(String jsonBody) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"id\":(\\d+)").matcher(jsonBody);
        assertThat(m.find()).isTrue();
        return Long.parseLong(m.group(1));
    }
}
