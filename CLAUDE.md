# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

칸반 보드 웹 앱. `front/`(React 19 + TypeScript strict + Vite 8)와 선택적 `backend/`(Spring Boot 4, Java 21, PostgreSQL)로 구성. 백엔드가 있으면 서버가 진실의 원천(브라우저·기기 간 폴링 동기화), 없으면 localStorage 단독 모드로 자동 폴백한다. UI 문구·주석·커밋 메시지는 한국어를 사용한다. 상세 설계는 `ARCHITECTURE.md` 참조.

## 명령어

```bash
# 프론트엔드 (front/ 에서)
npm run dev                    # 개발 서버 5173 (/api → 8080 프록시)
npm run dev -- --port 5175     # E2E 스위트는 5175 포트를 가정
npm run build                  # tsc -b && vite build — 타입 체크는 여기서만 됨 (vite는 transpile only)
npm test                       # vitest 단위 테스트 전체
npx vitest run src/state/workspaceReducer.test.ts   # 단일 테스트 파일
npm run lint                   # oxlint

# 백엔드 (backend/ 에서)
docker compose up -d           # 로컬 PostgreSQL (localhost:5432, db/user/pw 모두 kanban)
./gradlew bootRun              # 8080, 데이터: PostgreSQL workspace_document 테이블
./gradlew test                 # API 테스트 (인메모리 H2 — Postgres 불요, 방언 중립 매핑)
./gradlew test --tests 'com.kanban.workspace.WorkspaceApiTests'   # 단일 클래스

# E2E (e2e/ — 프레임워크 없는 단독 실행형 Playwright 스크립트, node smoke*.mjs)
# 전제 조건이 스위트마다 다름 — e2e/README.md 필독:
#  - smoke-backend*.mjs 2개: 백엔드 켬 + 빈 DB (정지 → docker compose down -v && up -d → 기동)
#  - smoke-auth.mjs: 인증 켠 백엔드 단독 (APP_AUTH_PASSWORD=test-pw ./gradlew bootRun)
#  - 나머지 10개: 백엔드 끔 (켜져 있으면 서버 데이터가 localStorage 시나리오를 오염)
#  - Playwright는 프로젝트 의존성이 아님 — 별도 폴더에 npm i playwright 후 실행
```

## 아키텍처 핵심

### 상태: 리듀서 합성 + 정규화

`workspaceReducer`가 워크스페이스 액션(보드 생성/삭제/전환/RESTORE_*)만 직접 처리하고, 나머지 `BoardAction`은 활성 보드의 `boardReducer`로 위임한다. 컴포넌트는 `useBoard()`로 활성 보드 `state`와 `dispatch`만 보므로 다중 보드를 의식하지 않는다. 카드 본문은 `cards` 맵에 한 번만 존재하고 컬럼은 `cardIds`로 순서만 관리(정규화). 리듀서는 순수 함수 — `uid()` 등 부수효과는 dispatch 시점에 만들어 액션에 담는다.

### 영속화: 3계층 동기화 (BoardContext.tsx가 오케스트레이션)

서버(PostgreSQL, version 번호) ↔ localStorage 미러(오프라인 폴백) ↔ 다른 탭(storage 이벤트). 이 코드는 여러 리뷰 사이클에서 실데이터 소실 버그를 잡으며 다듬어진 부분이라 수정 시 각별히 주의:

- **서버 PUT은 직렬화 체인(`flushChain`)을 반드시 거친다.** PUT이 느린 동안(배포 VM 실측 0.1~1.4초) 다음 디바운스가 만료되면 두 PUT이 같은 baseVersion으로 동시에 나가고, 뒤엣것이 자기 자신과 409로 충돌해 방금 한 변경이 "다른 기기 충돌"로 둔갑해 되돌려진다(혼자 써도 유실 — smoke-syncrace.mjs가 회귀 방어).
- **PUT은 `baseVersion` 선행조건** 포함 — 서버가 불일치 시 409, 클라이언트는 pull + 충돌 토스트(`window` CustomEvent `kanban:sync-conflict` → AppInner가 수신). 실패 시 dirty 복구 + 3초 재시도.
- **에코 억제**(`skipNextPersist`: 'all' | 'remote'): 동기화로 받은 상태를 되저장하면 탭 간 무한 쓰기 루프가 생긴다 (두 탭의 activeBoardId가 달라 저장 문자열이 영원히 수렴하지 않음).
- **재조정**: 미러의 기반 버전(`kanban-workspace-base-version`)이 서버 버전과 같은데 내용이 다르면 미전송 변경으로 판단해 서버로 밀어올린다 — 탭 강제 종료·keepalive 64KiB 한도로 유실된 저장의 복구 경로.
- **검증(`isValidWorkspace`)은 `id in obj`가 아니라 own 속성으로 확인한다** — `in`은 프로토타입 체인까지 봐서 `constructor`·`toString` 같은 id가 존재하는 키로 통과하고, 렌더에서 `undefined.cardIds`를 읽어 흰 화면이 된다. 반대로 검증에 실패한 서버 문서는 'offline'로 처리되어 앱이 **조용히 localStorage 모드**로 빠지므로(사용자는 동기화되는 줄 안다) 콘솔 경고를 남긴다.
- 미러 저장은 leading(첫 변경 즉시) + trailing(400ms) — 드래그 중 매 dispatch 직렬화 방지. 테스트에서 localStorage를 clear한 직후 reload하면 대기 중이던 trailing 쓰기가 키를 되살릴 수 있으니 600ms 정착 대기.
- 백엔드 감지는 `/api/workspace/version`(항상 200 JSON)으로 — `/api/workspace`의 404는 정적 호스팅 폴백과 구분 불가.
- **`/api/**` 응답은 `NoCacheFilter`가 `Cache-Control: no-store`를 붙인다.** 캐시 지시자가 없으면 중간 캐시가 응답을 임의로 재사용해도 규격 위반이 아니다 — 평문 HTTP에서는 경로상의 프록시가 그대로 캐시해, 한 PC의 변경이 다른 PC의 새로고침에 간헐적으로 안 보이는 형태로 나타난다(네트워크마다 달라 재현이 어렵다).
- 폴링은 `document.hidden`이면 건너뛴다(배터리). 대신 **다시 보일 때 즉시 한 번 확인**한다 — 없으면 탭을 되돌아왔을 때 최대 폴링 주기만큼 늦게 반영된다.

### 실행 취소: 대상 지정 복원 (스냅샷 교체 아님)

삭제 undo는 `RESTORE_CARD/COLUMN/LABEL/BOARD` 액션으로 삭제된 것만 원위치에 되살린다. 전체 스냅샷 `REPLACE_WORKSPACE`로 복원하면 confirm 대기·토스트 표시 중의 다른 변경을 덮어쓴다(과거 critical 버그). 캡처는 렌더 클로저가 아닌 최신 상태 ref에서 dispatch 시점에 수행(`useUndoableDelete`) — 비동기 confirm 때문에 렌더 시점 캡처는 낡은 상태가 된다.

### 드래그&드롭 (dnd-kit multiple-containers)

`onDragOver`가 컬럼 간 이동을 실시간 dispatch(라이브 프리뷰)하므로 취소 시 복원이 필수. 스냅샷은 **보드 id에 바인딩 + 레이아웃(columns/columnOrder)만** 담는다 — 드래그 중 활성 보드가 바뀌거나 다른 탭이 편집해도 오염되지 않게. `RESTORE_BOARD_LAYOUT`의 병합은 세 가지를 동시에 지켜야 한다: ①스냅샷 이후 생긴 컬럼/카드를 보존해 고아를 만들지 않고, ②그 컬럼의 cardIds에서 **스냅샷이 이미 갖고 있는 카드를 빼며**(안 그러면 드래그 중 옮겨진 카드가 두 컬럼에 동시에 존재해 유령 카드가 영구히 남는다), ③현재 보드에 **없는 컬럼은 되살리지 않는다**(다른 탭이 삭제한 컬럼이 부활한다). cards 맵에 없는 참조도 걸러 검증 무결성을 지킨다. 센서: Mouse 4px / Touch 250ms 길게누름(CSS `touch-action: manipulation`과 세트) / Keyboard(카드에서 Enter=모달 열기, Space=드래그).

### UI 레이어링 규약 (깨지기 쉬움)

- **Esc 우선순위**: confirm > 팝오버·인라인 편집 > 모달. ConfirmDialog와 LabelPicker는 document **캡처** keydown 리스너 — 같은 노드·같은 단계의 리스너끼리는 stopPropagation이 통하지 않으므로, LabelPicker는 `.confirm-backdrop` 존재 시 스스로 양보한다.
- `useClickOutside`는 캡처 단계 + confirm 레이어 내부 클릭 무시. composer들은 `'click'` 이벤트 모드 사용 — pointerdown에 닫으면 dnd 측정 전에 레이아웃이 변형되어 드래그 오버레이가 어긋난다.
- 컬럼 헤더에 dnd `{...listeners}`가 스프레드되므로 내부 컨트롤은 `stopDndSensorEvents`(pointer/mouse/touch 3종)로 버블 차단 — 센서마다 듣는 이벤트가 다르다.
- 모든 Enter/Esc 처리 입력에 `e.nativeEvent.isComposing` 가드 필수 (한글 IME — 조합 확정 Enter가 중복 제출됨).
- **키보드로 제출되는 저장은 `saving` state가 아니라 ref로 중복을 막는다** — 연타(키 자동반복 포함)는 리렌더 사이에 연달아 들어와 state가 아직 true가 아니므로 같은 것이 여러 벌 저장된다. 버튼 `disabled`는 키보드 경로를 막지 못한다.
- 팝오버는 Esc로 닫혀야 한다. `onKeyDown`으로 키를 밖으로 내보내지 않는 팝오버(컬럼 ⋯ 메뉴)는 **자기 자신이 Esc를 처리**해야 한다.
- CardModal의 닫기 경로는 반드시 `closeWithCommit` 경유 — Safari는 버튼 클릭이 포커스를 옮기지 않아 자연 blur 커밋이 없다.

### 프로덕션 nginx + HTTPS(Caddy)

운영 요청 경로는 `caddy(TLS 종단, 루트 Caddyfile) → nginx(frontend) → backend`다. caddy는 `.env`의 `CADDY_DOMAIN`으로 Let's Encrypt 인증서를 자동 발급·갱신하는데, **HTTP-01 챌린지가 80 포트를 쓰므로 NSG에서 80을 닫으면 갱신이 조용히 실패한다**(만료 시점에야 드러남). caddy에는 요청 본문 크기 제한이 없어 업로드 한도는 여전히 nginx가 결정한다. nginx의 realip 설정(X-Forwarded-For 신뢰)은 접근 로그에 실제 클라이언트 IP를 남기기 위한 것 — 지우면 로그에 caddy 내부 IP만 찍혀 "어느 PC의 요청인지"를 추적하는 장애 분석이 불가능해진다(2026-08 저장 타임아웃 분석이 이 로그로 이뤄졌다).

`front/nginx.conf`가 `/api`를 백엔드로 프록시한다. **`client_max_body_size`를 지정하지 않으면 nginx 기본값 1MB가 적용되어, 백엔드가 50MB를 허용해도 1MB 넘는 업로드가 백엔드에 닿기 전에 413으로 막힌다.** 개발 서버(Vite 프록시)에는 이 제한이 없어 로컬에서는 재현되지 않는다 — 업로드 한도를 바꾸면 `application.properties`와 nginx 양쪽을 함께 고쳐야 한다.

정적 캐시 헤더도 지우면 안 된다: **index.html은 `no-cache`, 해시 파일명인 `/assets/`는 장기 `immutable`.** 헤더가 없으면 브라우저 휴리스틱 캐시가 이전 index.html을 계속 써서, 재배포가 캐시 만료 시점까지 반영되지 않은 것처럼 보인다(실제 발생 — "배포했는데 변화가 없다"로 나타난다). **gzip도 명시적으로 켜둔 것이다** — 공식 nginx 이미지 기본값은 꺼짐이라, 설정을 지우면 mermaid 코어 663KB·elkjs 1.4MB 같은 청크가 무압축으로 전송된다.

### 백엔드 (문서형 API)

단일 행(id=1) 문서 저장. version 0 시드 행 = "문서 없음"(GET 404). PUT은 `findForUpdate`(PESSIMISTIC_WRITE)로 version 증가를 직렬화 — 평범한 read-modify-write는 동시 저장에서 version이 유실/역행해 폴링이 변경을 영영 못 본다. GET은 payload 문자열을 재파싱 없이 그대로 이어붙여 응답한다. 깊은 검증은 프론트(`parseWorkspace`)의 책임.

**긴 문자열 컬럼(payload/content/code)은 `@JdbcTypeCode(LONGVARCHAR)` + `@Column(length = Length.LONG32)` 세트로만 쓸 것.** 둘 중 하나만 빠져도 조용히 망가진다:
- `@Lob`을 쓰면 PostgreSQL에서 `oid`(Large Object)가 되어 `open-in-view=false`와 함께 GET이 깨진다.
- **NUL(U+0000)은 PostgreSQL `text`에 저장할 수 없다** — 컨트롤러가 U+0000을 제거하지 않으면 삽입이 500으로 새어 나간다(Note·Diagram·File 컨트롤러에서 제거함. 워크스페이스 payload는 직렬화된 JSON 텍스트로 저장되어 NUL이 이스케이프 시퀀스로 남으므로 안전).
- `length`를 빼면 `varchar(32600)`이 되어, 데이터가 32,600자를 넘는 순간부터 **모든 저장이 500으로 실패**한다(보드가 쌓인 워크스페이스, 긴 메모, 큰 다이어그램에서 실제로 도달하는 크기). 새 엔티티를 추가할 때 특히 조심.
- `ddl-auto=update`는 **기존 컬럼 타입을 바꾸지 않는다** — 매핑을 고쳐도 이미 배포된 DB는 `ALTER TABLE ... TYPE text`를 수동 실행해야 한다.

**길이를 지정하지 않은 문자열 컬럼은 varchar(255)다.** 컨트롤러에서 길이를 검증하거나 잘라 넣지 않으면 DB 제약 위반이 **500으로 새어 나간다**(전역 예외 핸들러가 없다). 파일처럼 바이트를 먼저 디스크에 쓰는 경로에서는 저장 실패가 참조 없는 고아 파일까지 남긴다.

### 로그인 (선택 — 환경변수로 켜짐)

`app.auth.password`(env `APP_AUTH_PASSWORD`)가 **비어 있으면 인증 자체가 꺼진다** — 로컬 개발과 E2E 스위트가 환경변수 없이 그대로 돌아가게 하려는 의도적 설계다. 운영은 `docker-compose.prod.yml`이 `:?` 가드로 값을 강제해 "깜빡 잊고 공개 배포"를 막는다. 저장소가 공개이므로 실제 비밀번호는 `.env`에만 둔다.

- 차단은 반드시 서버(`AuthFilter`)에서 한다. 프론트 화면만 잠그면 `/api/notes` 직접 호출로 데이터가 그대로 나간다.
- `GET /api/auth/me`는 401이 아니라 **항상 200 + `{required, authenticated}`**. 백엔드 없음(정적 호스팅 404·네트워크 실패)과 "로그인 필요"를 프론트가 구분해야 localStorage 단독 모드가 로그인 화면에 갇히지 않는다. 이 조회에는 타임아웃이 걸려 있다 — 응답을 기다리는 동안 화면이 비기 때문.
- `AuthGate`는 `BoardProvider` **바깥**에 둔다. 안쪽에 두면 로그인 화면 뒤에서 워크스페이스를 불러오고 4초 폴링이 돈다.
- **`apiFetch`에는 기본 20초 타임아웃이 있다.** 없으면 연결이 멎었을 때 OS의 TCP 타임아웃(수 분)까지 버튼이 비활성인 채 아무 안내도 없어 "저장이 오래 걸린다"로 보인다. 파일 업로드·다운로드는 크기에 따라 더 걸릴 수 있어 `apiFetchNoTimeout`으로 제한을 끈다. 타임아웃을 너무 짧게 잡으면 서버는 저장했는데 클라이언트만 실패로 보고, 재시도로 같은 것이 두 벌 저장될 수 있다.
- **데이터 API는 반드시 `http.ts`의 `apiFetch`를 거친다.** 401을 평범한 실패로 흘리면 앱이 "백엔드 없음"과 구분하지 못해 조용히 localStorage 모드로 동작한다 — 세션이 끊긴 뒤(재배포·만료) 사용자는 저장된 줄 알지만 서버·다른 기기에는 반영되지 않는다. `apiFetch`가 401에 `kanban:unauthorized`를 쏘면 `AuthGate`가 로그인 화면으로 되돌리고, 재로그인 시 재조정이 미전송 변경을 밀어올린다. `/api/auth/*`는 401이 정상 응답이므로 이 래퍼를 쓰지 않는다.

## 저장소 관례

- 커밋 메시지는 한국어, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러 사용.
- 문서 갱신 대상: 기능 변경 시 `README.md`(기능 목록), 아키텍처 변경 시 `ARCHITECTURE.md`, 실행 방법 변경 시 `GETTING_STARTED.md`.
- 기능·수정 후에는 해당 영역의 E2E 스위트로 회귀 확인하는 것이 이 저장소의 검증 관행이다.
