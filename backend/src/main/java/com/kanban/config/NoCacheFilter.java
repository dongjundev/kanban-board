package com.kanban.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * /api/** 응답에 캐시 금지를 명시한다.
 *
 * 이 API는 "항상 최신"이 존재 이유인데(폴링·새로고침 동기화), 응답에 캐시 지시자가
 * 전혀 없으면 중간 캐시가 임의로 재사용해도 규격상 위반이 아니다. 특히 평문 HTTP는
 * 경로상의 프록시가 그대로 캐시할 수 있어, 한 PC에서 저장한 변경이 다른 PC의
 * 새로고침에 간헐적으로 안 보이는 형태로 나타난다(네트워크마다 달라 재현이 어렵다).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class NoCacheFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/")) {
            response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            response.setHeader("Pragma", "no-cache"); // HTTP/1.0 프록시 대응
            response.setHeader("Expires", "0");
        }
        chain.doFilter(request, response);
    }
}
