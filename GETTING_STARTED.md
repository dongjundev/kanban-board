# 기동 가이드

칸반 보드 앱을 설치하고 실행하는 방법입니다. 프론트엔드만 실행하면 localStorage 모드로, Spring Boot 백엔드까지 실행하면 서버 저장 + 브라우저·기기 간 동기화 모드로 동작합니다.

## 요구 사항

| 항목 | 버전 |
|---|---|
| Node.js | `20.19` 이상 또는 `22.12` 이상 (Vite 8 요구사항) |
| npm | Node.js에 포함된 버전 |
| JDK | 21 이상 (백엔드는 Java 21 — Gradle은 wrapper 포함) |
| 브라우저 | Chrome / Edge / Safari / Firefox 최신 버전 |

버전 확인:

```bash
node --version
npm --version
```

## 1. 설치

```bash
cd kanban-board/front
npm install
```

## 2. 개발 서버 실행

```bash
cd front
npm run dev
```

- 기본 주소: **http://localhost:5173**
- 다른 포트를 쓰려면: `npm run dev -- --port 5175`
- 같은 네트워크의 다른 기기(휴대폰 등)에서 접속하려면: `npm run dev -- --host`
- 코드 수정 시 HMR로 즉시 반영됩니다. 종료는 `Ctrl+C`.

첫 접속 시 샘플 데이터가 담긴 시드 보드("팀 칸반 보드")가 자동 생성됩니다.

## 2.5 백엔드 실행 (선택)

```bash
cd backend
./gradlew bootRun        # http://localhost:8080 (첫 실행은 의존성 다운로드로 수 분)
./gradlew test           # API 테스트
```

- 개발 서버(`npm run dev`)가 `/api` 요청을 8080으로 프록시하므로 **백엔드를 먼저(또는 나중에라도) 띄우고 프론트 페이지를 새로고침**하면 서버 모드가 됩니다.
- 데이터는 `backend/data/kanban.mv.db`(H2 파일)에 저장됩니다. 서버 데이터 초기화는 백엔드를 끈 상태에서 `rm backend/data/kanban*`.
- 서버가 비어 있으면 첫 접속한 브라우저의 localStorage 데이터가 자동으로 서버로 이관됩니다.
- **백엔드 없이 프론트만 실행해도 됩니다** — 자동으로 localStorage 모드로 동작합니다(브라우저 콘솔에 안내 출력).
- 백엔드 종료: 실행 중인 터미널에서 `Ctrl+C`, 또는 `kill $(lsof -t -iTCP:8080 -sTCP:LISTEN)`

## 3. 프로덕션 빌드

```bash
cd front
npm run build      # 타입 체크(tsc) + 번들 → dist/ 생성
npm run preview    # 빌드 결과물을 로컬에서 미리보기 (http://localhost:4173)
```

`front/dist/` 폴더는 순수 정적 파일이므로 Nginx, GitHub Pages, S3 등 아무 정적 호스팅에나 올리면 됩니다. 별도 서버 설정이 필요 없습니다.

```nginx
# Nginx 예시
location / {
    root /var/www/kanban-board/front/dist;
    try_files $uri $uri/ /index.html;
}
```

## 4. 테스트 · 린트

```bash
cd front
npm test           # vitest 단위 테스트 (리듀서·유틸)
npm run lint       # oxlint

cd backend
./gradlew test     # 백엔드 API 테스트 (선행조건·동시성 포함)
```

## 5. 데이터 저장과 초기화

**백엔드 실행 시**: 서버(H2 파일 DB)가 진실의 원천입니다. 모든 변경이 400ms 디바운스로 서버에 저장되고, 다른 브라우저·기기는 4초 폴링으로 동기화됩니다. localStorage는 미러(오프라인 캐시)로 계속 유지됩니다.

**백엔드 미실행 시**: 브라우저 localStorage에만 저장됩니다. 브라우저·기기마다 데이터가 독립적입니다 (같은 브라우저의 탭 간에는 실시간 동기화됨).

| 키 | 내용 |
|---|---|
| `kanban-workspace-v1` | 보드·컬럼·카드·라벨 전체 |
| `kanban-board-theme` | 다크/라이트 테마 선택 |
| `kanban-board-state-v1` | (레거시) 구버전 단일 보드 — 있으면 첫 로드 때 자동 마이그레이션 |

**데이터 전체 초기화** — 브라우저 DevTools(F12) 콘솔에서:

```js
localStorage.removeItem('kanban-workspace-v1')
location.reload()   // 시드 보드로 초기화됨
```

**백업/복원** — 콘솔에서 값을 복사해 두었다가 다시 넣으면 됩니다:

```js
// 백업
copy(localStorage.getItem('kanban-workspace-v1'))
// 복원 (붙여넣은 JSON 문자열로)
localStorage.setItem('kanban-workspace-v1', '<백업한 JSON>')
location.reload()
```

## 6. 문제 해결

| 증상 | 조치 |
|---|---|
| `npm run dev`가 포트 충돌로 실패 | `npm run dev -- --port 5175` 등 다른 포트 지정 |
| `npm install` 실패 | Node 버전 확인(위 요구 사항). `node_modules`와 `package-lock.json` 삭제 후 재설치 |
| 화면이 흰 화면 | 저장 데이터가 손상되면 자동으로 시드로 폴백하도록 검증이 있으나, 문제가 지속되면 §5의 데이터 초기화 수행 |
| 빌드 시 타입 에러 | `npm run build`는 `tsc -b`를 먼저 실행합니다. 에러 메시지의 파일/라인을 수정 후 재시도 |

## 참고 문서

- 기능 목록·프로젝트 구조: [README.md](./README.md)
- 아키텍처(상태 흐름·데이터 모델·DnD 파이프라인): [ARCHITECTURE.md](./ARCHITECTURE.md)
