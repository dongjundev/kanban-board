package com.kanban.note;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NoteRepository extends JpaRepository<Note, Long> {

    /** 최신순 목록. */
    List<Note> findAllByOrderByCreatedAtDesc();
}
