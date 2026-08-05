package com.kanban.diagram;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiagramRepository extends JpaRepository<Diagram, Long> {

    /** 최근 수정순 목록. */
    List<Diagram> findAllByOrderByUpdatedAtDesc();
}
