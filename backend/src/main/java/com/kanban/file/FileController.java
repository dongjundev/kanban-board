package com.kanban.file;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/files")
public class FileController {

    private final StoredFileRepository repository;
    private final FileStorageService storage;

    public FileController(StoredFileRepository repository, FileStorageService storage) {
        this.repository = repository;
        this.storage = storage;
    }

    @GetMapping
    public List<FileResponse> list() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(FileResponse::from).toList();
    }

    @PostMapping
    public ResponseEntity<FileResponse> upload(@RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        String key = storage.store(file);
        StoredFile stored = new StoredFile();
        String name = file.getOriginalFilename();
        stored.setFilename(fit(name == null || name.isBlank() ? "unnamed" : name));
        String type = file.getContentType();
        stored.setContentType(fit(type == null || type.isBlank() ? "application/octet-stream" : type));
        stored.setSize(file.getSize());
        stored.setStorageKey(key);
        repository.save(stored);
        return ResponseEntity.status(HttpStatus.CREATED).body(FileResponse.from(stored));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Resource> download(@PathVariable Long id) {
        StoredFile stored = repository.findById(id).orElse(null);
        if (stored == null) {
            return ResponseEntity.notFound().build();
        }
        Resource resource = storage.load(stored.getStorageKey());
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        MediaType mediaType;
        try {
            mediaType = MediaType.parseMediaType(stored.getContentType());
        } catch (Exception e) {
            mediaType = MediaType.APPLICATION_OCTET_STREAM;
        }
        // 한글 등 비ASCII 파일명은 RFC 5987 방식으로 인코딩
        String encoded = URLEncoder.encode(stored.getFilename(), StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                .body(resource);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) throws IOException {
        StoredFile stored = repository.findById(id).orElse(null);
        if (stored == null) {
            return ResponseEntity.notFound().build();
        }
        storage.delete(stored.getStorageKey());
        repository.delete(stored);
        return ResponseEntity.noContent().build();
    }

    /**
     * filename·contentType 컬럼은 varchar(255)다. 그대로 넘기면 DB 제약 위반이 500으로
     * 새어 나가고, 바이트는 이미 디스크에 쓰인 뒤라 아무도 참조하지 않는 파일이 남는다.
     */
    private static String fit(String value) {
        // NUL은 PostgreSQL text에 저장 불가 — 제거 후 컬럼 길이에 맞춰 자른다
        String cleaned = value.replace("\u0000", "");
        return cleaned.length() <= 255 ? cleaned : cleaned.substring(0, 255);
    }

    public record FileResponse(Long id, String filename, String contentType, long size, String createdAt) {
        static FileResponse from(StoredFile f) {
            return new FileResponse(f.getId(), f.getFilename(), f.getContentType(), f.getSize(), f.getCreatedAt().toString());
        }
    }
}
