package com.kanban.file;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** 업로드 바이트를 지정 디렉토리에 UUID 이름으로 저장/조회/삭제. */
@Service
public class FileStorageService {

    private final Path root;

    public FileStorageService(@Value("${app.upload-dir}") String uploadDir) throws IOException {
        this.root = Paths.get(uploadDir).toAbsolutePath().normalize();
        Files.createDirectories(this.root);
    }

    /** 저장 후 storageKey(UUID) 반환. */
    public String store(MultipartFile file) throws IOException {
        String key = UUID.randomUUID().toString();
        Path target = resolve(key);
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
        return key;
    }

    public Resource load(String key) {
        return new FileSystemResource(resolve(key));
    }

    public void delete(String key) throws IOException {
        Files.deleteIfExists(resolve(key));
    }

    /** root 밖으로 벗어나는 경로를 방어. */
    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) {
            throw new IllegalArgumentException("잘못된 저장 키: " + key);
        }
        return p;
    }
}
