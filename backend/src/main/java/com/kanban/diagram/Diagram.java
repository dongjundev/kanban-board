package com.kanban.diagram;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.Length;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 저장된 mermaid 차트 한 건. */
@Entity
@Table(name = "diagram")
public class Diagram {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title = "";

    // 길이 제한 없는 text 매핑. LONGVARCHAR만 쓰면 PostgreSQL이 varchar(32600)으로
    // 잘라내 큰 차트 저장이 500으로 실패한다 — length=LONG32라야 text가 된다.
    // (@Lob은 oid(Large Object)가 되는 별개의 함정이라 여전히 피한다.)
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false, length = Length.LONG32)
    private String code = "";

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
