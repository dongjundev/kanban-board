package com.kanban.workspace;

import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 기동 시 단일 행(id=1, version=0)을 미리 만들어 둔다.
 * PUT 경로에서 "없으면 생성"을 없애 동시 첫-저장의 PK 충돌 경합을 제거하고,
 * findForUpdate가 항상 잠글 행이 있게 한다. version=0은 "문서 없음"을 뜻한다.
 */
@Configuration
public class WorkspaceInitializer {

    @Bean
    ApplicationRunner seedWorkspaceRow(WorkspaceRepository repository) {
        return args -> {
            if (!repository.existsById(WorkspaceDocument.SINGLETON_ID)) {
                WorkspaceDocument doc = new WorkspaceDocument();
                doc.setPayload("null");
                doc.setVersion(0);
                repository.save(doc);
            }
        };
    }
}
