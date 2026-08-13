package com.kanban.note;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteRepository repository;

    public NoteController(NoteRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<NoteResponse> list() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(NoteResponse::from).toList();
    }

    @PostMapping
    public ResponseEntity<NoteResponse> create(@RequestBody CreateNoteRequest request) {
        if (request == null || request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        Note note = new Note();
        // NUL(U+0000)은 PostgreSQL text에 저장할 수 없어 500이 된다 — 조용히 제거
        note.setContent(request.content().replace("\u0000", ""));
        repository.save(note);
        return ResponseEntity.status(HttpStatus.CREATED).body(NoteResponse.from(note));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (!repository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }
        repository.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    public record CreateNoteRequest(String content) {}

    public record NoteResponse(Long id, String content, String createdAt) {
        static NoteResponse from(Note n) {
            return new NoteResponse(n.getId(), n.getContent(), n.getCreatedAt().toString());
        }
    }
}
