package com.kanban.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * 현재 로그인 상태. 인증이 꺼져 있는 배포와 "로그인 필요"를 구분해야 하므로
     * 401이 아니라 항상 200으로 답한다 — 백엔드가 아예 없는 정적 호스팅(404)과도
     * 구분되어, 프론트가 localStorage 단독 모드로 갈지 로그인 화면을 띄울지 판단할 수 있다.
     */
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        boolean authenticated = session != null && Boolean.TRUE.equals(session.getAttribute(AuthService.SESSION_KEY));
        return Map.of(
                "required", authService.isEnabled(),
                "authenticated", !authService.isEnabled() || authenticated,
                "username", authenticated ? authService.getUsername() : "");
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody(required = false) LoginRequest body, HttpServletRequest request) {
        if (!authService.isEnabled()) {
            return ResponseEntity.ok(Map.of("required", false, "authenticated", true));
        }
        if (body == null || !authService.matches(body.username(), body.password())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("message", "아이디 또는 비밀번호가 올바르지 않습니다"));
        }
        // 세션 고정 공격 방지 — 로그인 시점에 세션 id를 새로 발급한다
        HttpSession old = request.getSession(false);
        if (old != null) {
            old.invalidate();
        }
        request.getSession(true).setAttribute(AuthService.SESSION_KEY, Boolean.TRUE);
        return ResponseEntity.ok(Map.of("required", true, "authenticated", true, "username", authService.getUsername()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        return ResponseEntity.noContent().build();
    }

    public record LoginRequest(String username, String password) {}
}
