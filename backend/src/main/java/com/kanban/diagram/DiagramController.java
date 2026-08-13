package com.kanban.diagram;

import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/diagrams")
public class DiagramController {

    private final DiagramRepository repository;

    public DiagramController(DiagramRepository repository) {
        this.repository = repository;
    }

    /** 차트는 길어야 수 KB라 목록에 code까지 실어 보낸다 — 개별 조회 왕복이 없어진다. */
    @GetMapping
    public List<DiagramResponse> list() {
        return repository.findAllByOrderByUpdatedAtDesc().stream().map(DiagramResponse::from).toList();
    }

    @PostMapping
    public ResponseEntity<DiagramResponse> create(@RequestBody DiagramRequest request) {
        if (isInvalid(request)) {
            return ResponseEntity.badRequest().build();
        }
        Diagram diagram = new Diagram();
        diagram.setTitle(clean(request.title()).trim());
        diagram.setCode(clean(request.code()));
        repository.save(diagram);
        return ResponseEntity.status(HttpStatus.CREATED).body(DiagramResponse.from(diagram));
    }

    @PutMapping("/{id}")
    public ResponseEntity<DiagramResponse> update(@PathVariable Long id, @RequestBody DiagramRequest request) {
        if (isInvalid(request)) {
            return ResponseEntity.badRequest().build();
        }
        return repository
                .findById(id)
                .map(diagram -> {
                    diagram.setTitle(clean(request.title()).trim());
                    diagram.setCode(clean(request.code()));
                    diagram.setUpdatedAt(Instant.now());
                    repository.save(diagram);
                    return ResponseEntity.ok(DiagramResponse.from(diagram));
                })
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!repository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    /** NUL(U+0000)은 PostgreSQL text에 저장할 수 없어 500이 된다 — 조용히 제거. */
    private static String clean(String value) {
        return value.replace("\u0000", "");
    }

    /** 제목 컬럼은 varchar(255) — 검증 없이 넘기면 DB 제약 위반이 500으로 새어 나간다. */
    static final int MAX_TITLE_LENGTH = 200;

    private static boolean isInvalid(DiagramRequest request) {
        return request == null
                || request.title() == null
                || request.title().isBlank()
                || request.title().trim().length() > MAX_TITLE_LENGTH
                || request.code() == null
                || request.code().isBlank();
    }

    public record DiagramRequest(String title, String code) {}

    public record DiagramResponse(Long id, String title, String code, String updatedAt) {
        static DiagramResponse from(Diagram d) {
            return new DiagramResponse(d.getId(), d.getTitle(), d.getCode(), d.getUpdatedAt().toString());
        }
    }
}
