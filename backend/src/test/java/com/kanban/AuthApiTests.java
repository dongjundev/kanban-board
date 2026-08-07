package com.kanban;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;
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

/** 인증을 켠 상태(app.auth.password 지정)에서의 동작. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class AuthApiTests {

    @TempDir
    static Path uploadDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:auth-test;DB_CLOSE_DELAY=-1");
        registry.add("app.upload-dir", () -> uploadDir.toString());
        registry.add("app.auth.username", () -> "admin");
        registry.add("app.auth.password", () -> "test-secret");
    }

    @Autowired
    TestRestTemplate rest;

    private HttpHeaders json() {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        return h;
    }

    @Test
    void 로그인하지_않으면_api가_401() {
        assertThat(rest.getForEntity("/api/notes", String.class).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(rest.getForEntity("/api/diagrams", String.class).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(rest.getForEntity("/api/workspace/version", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void me는_401이_아니라_상태를_알려준다() {
        // 백엔드 없음(404)과 "로그인 필요"를 프론트가 구분할 수 있어야 한다
        ResponseEntity<String> me = rest.getForEntity("/api/auth/me", String.class);
        assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(me.getBody()).contains("\"required\":true").contains("\"authenticated\":false");
    }

    @Test
    void 잘못된_자격증명은_401() {
        ResponseEntity<String> res = rest.postForEntity(
                "/api/auth/login",
                new HttpEntity<>("{\"username\":\"admin\",\"password\":\"wrong\"}", json()),
                String.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(res.getHeaders().get(HttpHeaders.SET_COOKIE)).isNullOrEmpty();
    }

    @Test
    void 로그인하면_api를_쓸_수_있고_로그아웃하면_다시_막힌다() {
        ResponseEntity<String> login = rest.postForEntity(
                "/api/auth/login",
                new HttpEntity<>("{\"username\":\"admin\",\"password\":\"test-secret\"}", json()),
                String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        List<String> cookies = login.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertThat(cookies).isNotNull().isNotEmpty();
        String session = cookies.get(0).split(";", 2)[0];
        assertThat(cookies.get(0)).contains("HttpOnly");

        HttpHeaders withSession = new HttpHeaders();
        withSession.add(HttpHeaders.COOKIE, session);

        ResponseEntity<String> notes =
                rest.exchange("/api/notes", HttpMethod.GET, new HttpEntity<>(withSession), String.class);
        assertThat(notes.getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<String> me =
                rest.exchange("/api/auth/me", HttpMethod.GET, new HttpEntity<>(withSession), String.class);
        assertThat(me.getBody()).contains("\"authenticated\":true");

        rest.exchange("/api/auth/logout", HttpMethod.POST, new HttpEntity<>(withSession), Void.class);
        ResponseEntity<String> afterLogout =
                rest.exchange("/api/notes", HttpMethod.GET, new HttpEntity<>(withSession), String.class);
        assertThat(afterLogout.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
