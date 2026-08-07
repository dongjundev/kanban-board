package com.kanban.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 로그인하지 않은 요청에서 /api/** 를 막는다. 로그인 화면만 붙이고 API를 열어두면
 * 주소를 아는 사람이 /api/notes 등으로 데이터를 그대로 가져갈 수 있으므로,
 * 실제 차단은 반드시 서버에서 한다.
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    private final AuthService authService;

    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!authService.isEnabled() || !isProtected(request)) {
            chain.doFilter(request, response);
            return;
        }
        HttpSession session = request.getSession(false);
        if (session != null && Boolean.TRUE.equals(session.getAttribute(AuthService.SESSION_KEY))) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"message\":\"로그인이 필요합니다\"}");
    }

    private boolean isProtected(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (!path.startsWith("/api/")) {
            return false;
        }
        // 로그인 절차 자체와 프리플라이트는 열어둔다
        return !path.startsWith("/api/auth/") && !HttpMethod.OPTIONS.matches(request.getMethod());
    }
}
