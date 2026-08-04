package com.kanban.file;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * 업로드된 파일의 메타데이터. 실제 바이트는 파일시스템(FileStorageService)에
 * storageKey 이름으로 저장되고, 여기엔 원본 파일명·타입·크기만 둔다.
 */
@Entity
@Table(name = "stored_file")
public class StoredFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String filename;

    @Column(nullable = false)
    private String contentType;

    @Column(nullable = false)
    private long size;

    /** 디스크상의 파일 이름(UUID) — 원본 파일명과 분리해 충돌·경로탈출 방지. */
    @Column(nullable = false, unique = true)
    private String storageKey;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() {
        return id;
    }

    public String getFilename() {
        return filename;
    }

    public void setFilename(String filename) {
        this.filename = filename;
    }

    public String getContentType() {
        return contentType;
    }

    public void setContentType(String contentType) {
        this.contentType = contentType;
    }

    public long getSize() {
        return size;
    }

    public void setSize(long size) {
        this.size = size;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public void setStorageKey(String storageKey) {
        this.storageKey = storageKey;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
