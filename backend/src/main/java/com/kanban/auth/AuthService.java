package com.kanban.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 단일 관리자 계정 인증. 자격증명은 환경변수로만 주입한다(공개 저장소이므로 소스에 두지 않는다).
 * 비밀번호가 비어 있으면 인증을 끈 것으로 보고 모든 요청을 통과시킨다 —
 * 로컬 개발과 E2E 스위트가 환경변수 없이도 그대로 돌아가게 하기 위한 것이며,
 * 운영에서는 docker-compose.prod.yml이 값을 강제한다.
 */
@Service
public class AuthService {

    /** 로그인 성공 시 세션에 심는 표시. */
    public static final String SESSION_KEY = "kanban.authenticated";

    private final String username;
    private final String password;

    public AuthService(
            @Value("${app.auth.username}") String username, @Value("${app.auth.password}") String password) {
        this.username = username;
        this.password = password;
    }

    public boolean isEnabled() {
        return password != null && !password.isBlank();
    }

    /** 사용자명·비밀번호 모두 상수 시간 비교 — 응답 시간으로 값을 좁혀가는 것을 막는다. */
    public boolean matches(String inputUsername, String inputPassword) {
        if (!isEnabled() || inputUsername == null || inputPassword == null) {
            return false;
        }
        return constantTimeEquals(username, inputUsername) & constantTimeEquals(password, inputPassword);
    }

    public String getUsername() {
        return username;
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
