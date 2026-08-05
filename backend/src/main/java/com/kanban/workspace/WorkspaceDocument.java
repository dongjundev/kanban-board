package com.kanban.workspace;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.Length;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 워크스페이스 문서 단일 행 저장 (id는 항상 1).
 * 프론트엔드가 문서(보드 전체 JSON) 단위로 저장/로드하는 구조를 그대로 반영한
 * 문서형 저장소이며, version은 저장마다 1씩 증가해 클라이언트 폴링 동기화에 쓰인다.
 * version 0은 "아직 문서가 저장된 적 없음"을 뜻한다.
 */
@Entity
@Table(name = "workspace_document")
public class WorkspaceDocument {

    public static final long SINGLETON_ID = 1L;

    @Id
    private Long id = SINGLETON_ID;

    // PostgreSQL은 text, H2는 큰 문자 타입으로 매핑 — @Lob의 oid(Large Object) 함정 회피.
    // length=LONG32가 없으면 PostgreSQL이 varchar(32600)을 만들어, 보드가 늘어 payload가
    // 32,600자를 넘는 순간부터 모든 저장이 500으로 실패한다.
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false, length = Length.LONG32)
    private String payload = "";

    @Column(nullable = false)
    private long version = 0;

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getId() {
        return id;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }

    public long getVersion() {
        return version;
    }

    public void setVersion(long version) {
        this.version = version;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
