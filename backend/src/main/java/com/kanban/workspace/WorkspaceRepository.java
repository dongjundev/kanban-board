package com.kanban.workspace;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WorkspaceRepository extends JpaRepository<WorkspaceDocument, Long> {

    /**
     * 갱신용 잠금 조회 — 동시 PUT의 read-modify-write 경합(잃어버린 version 증가,
     * 중복/역행 버전)을 행 잠금으로 직렬화한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from WorkspaceDocument d where d.id = :id")
    Optional<WorkspaceDocument> findForUpdate(@Param("id") long id);
}
