package com.kanban.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * {@code Content-Encoding: gzip}으로 온 /api/** 요청 본문을 풀어서 뒤로 넘긴다.
 *
 * 프론트(http.ts의 gzipJsonRequest)가 메모·차트 저장 본문을 gzip으로 보낸다 — 회사망
 * 보안장비가 일정 크기를 넘는 요청 본문을 막는 환경에서 본문을 줄이기 위한 것이다
 * (텍스트는 70~90% 감소). 응답 gzip과 달리 서블릿 컨테이너와 Spring은 요청 본문의
 * 압축 해제를 자동으로 해주지 않으므로, 이 필터가 빠지면 컨트롤러가 gzip 바이트를
 * JSON으로 읽다 실패해 저장이 전부 400이 된다(프론트와 반드시 짝으로 유지할 것).
 *
 * 헤더가 없는 평문 요청은 손대지 않는다 — CompressionStream이 없는 브라우저의 폴백 경로.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1) // 본문을 읽는 어떤 필터·컨트롤러보다 앞에서 감싼다
public class GzipRequestFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/api/") && isGzip(request)) {
            chain.doFilter(new GzipRequest(request), response);
        } else {
            chain.doFilter(request, response);
        }
    }

    private static boolean isGzip(HttpServletRequest request) {
        String encoding = request.getHeader("Content-Encoding");
        return encoding != null && encoding.trim().equalsIgnoreCase("gzip");
    }

    private static final class GzipRequest extends HttpServletRequestWrapper {

        private ServletInputStream inflated;

        GzipRequest(HttpServletRequest request) {
            super(request);
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (inflated == null) {
                inflated = new GzipServletInputStream(super.getInputStream());
            }
            return inflated;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding();
            Charset charset = encoding != null ? Charset.forName(encoding) : StandardCharsets.UTF_8;
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        // 헤더의 Content-Length는 압축된 길이다. 그대로 노출하면 뒤쪽 코드가 "그만큼만
        // 읽으면 끝"으로 오판할 수 있으므로, 풀린 길이는 미리 알 수 없다(-1)고 답한다.
        @Override
        public int getContentLength() {
            return -1;
        }

        @Override
        public long getContentLengthLong() {
            return -1;
        }
    }

    private static final class GzipServletInputStream extends ServletInputStream {

        /**
         * 풀린 본문 상한 — 수십 KB의 gzip이 수 GB로 풀리는 gzip 폭탄이 힙을 태우지 않게 한다.
         * nginx의 client_max_body_size 55m·multipart 50MB와 같은 자리수로 맞췄다.
         */
        private static final long MAX_INFLATED_BYTES = 50L * 1024 * 1024;

        private final GZIPInputStream in;
        private long inflatedBytes;
        private boolean finished;

        GzipServletInputStream(ServletInputStream raw) throws IOException {
            // gzip 헤더 검사는 여기서 일어난다 — gzip이 아니면 IOException이 나고 Spring이 400으로 답한다
            this.in = new GZIPInputStream(raw);
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b < 0) {
                finished = true;
            } else {
                count(1);
            }
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            int n = in.read(buf, off, len);
            if (n < 0) {
                finished = true;
            } else {
                count(n);
            }
            return n;
        }

        private void count(int n) throws IOException {
            inflatedBytes += n;
            if (inflatedBytes > MAX_INFLATED_BYTES) {
                throw new IOException("압축 해제 크기가 한도(" + MAX_INFLATED_BYTES + " bytes)를 넘었습니다");
            }
        }

        @Override
        public boolean isFinished() {
            return finished;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException("비동기 읽기는 지원하지 않습니다");
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
