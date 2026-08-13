# E2E 스모크 테스트 스위트

개발 과정에서 기능·회귀 검증에 사용한 Playwright 스크립트 모음입니다. 테스트 프레임워크 없이
단독 실행형(.mjs)으로 작성되어 있고, 각 항목을 `PASS`/`FAIL`로 출력한 뒤 실패가 있으면 종료 코드 1로 끝납니다.

## 사전 준비

```bash
# Playwright 설치 (임의 폴더 — 프로젝트 의존성에 포함하지 않음)
mkdir -p /tmp/kanban-e2e && cd /tmp/kanban-e2e
npm init -y && npm i playwright && npx playwright install chromium

# 프론트 개발 서버 (모든 스위트가 5175 포트를 가정)
cd <repo>/front && npm run dev -- --port 5175
```

## 실행

```bash
cd <repo>/e2e
node --experimental-default-type=module smoke.mjs   # 또는 그냥 node smoke.mjs
```

| 스위트 | 검증 내용 | 백엔드 |
|---|---|---|
| `smoke.mjs` | 기본 기능 20항목 (시드, 모달, 카드/컬럼 추가, 드래그, 필터, 영속성) | 끔 |
| `smoke-fixes.mjs` | 1차 코드리뷰 수정 17항목 (드래그 취소 롤백, 키보드 접근, IME 등) | 끔 |
| `smoke-theme.mjs` | 다크모드 (OS 연동, 토글, 영속성) | 끔 |
| `smoke-boards.mjs` | 다중 보드 (생성/전환/삭제, 레거시 마이그레이션) | 끔 |
| `smoke-multitab.mjs` | 탭 간 동기화, 무한 쓰기 루프 방지 | 끔 |
| `smoke-confirm.mjs` | 카드 모달 확인 버튼 커밋 | 끔 |
| `smoke-ux.mjs` | UX 개선 1차 (undo 토스트, 필터 중 추가, 터치 드래그) | 끔 |
| `smoke-ux2.mjs` | UX 개선 2차 (라벨 편집, 보드별 필터, 인앱 confirm 등) | 끔 |
| `smoke-undo2.mjs` | 대상 지정 복원 undo, confirm 레이어링 | 끔 |
| `smoke-diagram.mjs` | mermaid 렌더·테마 연동·글자 대비(확대/이동 후 유지) | 끔 |
| `smoke-auth.mjs` | 로그인·세션 만료 감지·API 차단 | **켬**(APP_AUTH_PASSWORD=test-pw) |
| `smoke-backend.mjs` | 서버 마이그레이션·복원·브라우저 간 동기화 | **켬** |
| `smoke-backend2.mjs` | 동기화 강화 (재시도, 재조정, 409 충돌, 오프라인 승격) | **켬** |
| `smoke-syncrace.mjs` | 느린 PUT 중 연속 편집 유실(자기-409) 회귀 | **켬**(빈 DB 불필요) |

주의:

- 각 스위트는 시작 시 `localStorage`를 초기화하므로 개발용 브라우저 데이터가 아닌 전용 dev 서버(5175)에서 돌리세요.
- `smoke-auth.mjs`는 인증을 켠 백엔드를 전제로 합니다: `cd backend && APP_AUTH_PASSWORD=test-pw ./gradlew bootRun`. 다른 스위트와 함께 돌리지 말고 단독 실행하세요(인증이 켜져 있으면 나머지가 401로 깨집니다).
- 백엔드 스위트 2개는 **빈 서버 DB**를 전제로 정확 개수 검증을 합니다. 실행 전:
  `백엔드 정지 → docker compose down -v && docker compose up -d(backend/에서, DB 초기화) → 백엔드 기동` 후 두 스위트를 순서대로 1회씩 실행.
- 나머지 10개는 백엔드가 꺼져 있어야 합니다(켜져 있으면 서버 데이터가 localStorage 시나리오를 오염).
- 스크린샷은 스크립트가 있는 폴더에 저장됩니다.
