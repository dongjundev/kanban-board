package com.kanban.workspace;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/workspace")
public class WorkspaceController {

    private final WorkspaceRepository repository;
    private final ObjectMapper objectMapper;

    public WorkspaceController(WorkspaceRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    /** 저장된 워크스페이스 문서. 아직 저장된 적이 없으면(version 0) 404. */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> get() {
        return repository.findById(WorkspaceDocument.SINGLETON_ID)
                .filter(doc -> doc.getVersion() > 0)
                .map(doc -> ResponseEntity.ok(
                        "{\"version\":" + doc.getVersion() + ",\"workspace\":" + doc.getPayload() + "}"))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** 폴링·백엔드 감지용 경량 엔드포인트 — 문서가 없으면 version 0. */
    @GetMapping("/version")
    public Map<String, Long> version() {
        long version = repository.findById(WorkspaceDocument.SINGLETON_ID)
                .map(WorkspaceDocument::getVersion)
                .orElse(0L);
        return Map.of("version", version);
    }

    /**
     * 워크스페이스 전체 저장. body: {"workspace": {...}, "baseVersion": n?}
     * - baseVersion이 있으면 현재 버전과 일치할 때만 저장(낙관적 선행조건) — 불일치 시
     *   409와 현재 버전을 돌려줘 stale 클라이언트가 남의 확정 저장분을 덮지 못하게 한다.
     * - 행 잠금(findForUpdate)으로 version 증가를 직렬화한다.
     * - 깊은 검증은 프론트엔드(parseWorkspace)가 수행하므로 여기서는 최상위 형태만 확인한다.
     */
    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Transactional
    public ResponseEntity<Map<String, Long>> put(@RequestBody Map<String, Object> body) {
        if (!(body.get("workspace") instanceof Map<?, ?> workspace)) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT).build();
        }
        boolean hasShape = workspace.get("boards") instanceof Map<?, ?>
                && workspace.get("boardOrder") instanceof List<?>
                && workspace.get("activeBoardId") instanceof String;
        if (!hasShape) {
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_CONTENT).build();
        }

        WorkspaceDocument doc = repository.findForUpdate(WorkspaceDocument.SINGLETON_ID).orElse(null);
        if (doc == null) {
            return ResponseEntity.internalServerError().build(); // 기동 시드가 보장 — 방어적
        }

        if (body.get("baseVersion") instanceof Number baseVersion
                && baseVersion.longValue() != doc.getVersion()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("version", doc.getVersion()));
        }

        doc.setPayload(objectMapper.writeValueAsString(workspace));
        doc.setVersion(doc.getVersion() + 1);
        doc.setUpdatedAt(Instant.now());
        repository.save(doc);
        return ResponseEntity.ok(Map.of("version", doc.getVersion()));
    }
}
