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

백엔드는 PostgreSQL을 사용합니다. 로컬에서는 Docker로 띄우는 것이 가장 간단합니다.

```bash
cd backend
docker compose up -d     # 로컬 PostgreSQL (localhost:5432, db/user/pw 모두 kanban)
./gradlew bootRun        # http://localhost:8080 (첫 실행은 의존성 다운로드로 수 분)
./gradlew test           # API 테스트 (인메모리 H2로 실행 — Postgres 불요)
```

- 개발 서버(`npm run dev`)가 `/api` 요청을 8080으로 프록시하므로 **백엔드를 먼저(또는 나중에라도) 띄우고 프론트 페이지를 새로고침**하면 서버 모드가 됩니다.
- 데이터는 PostgreSQL의 `workspace_document` 테이블 단일 행에 저장됩니다. 접속 정보는 `application.properties`의 기본값(로컬)이며 `SPRING_DATASOURCE_URL`/`SPRING_DATASOURCE_USERNAME`/`SPRING_DATASOURCE_PASSWORD` 환경변수로 덮어쓸 수 있습니다(배포 환경).
- 서버가 비어 있으면 첫 접속한 브라우저의 localStorage 데이터가 자동으로 서버로 이관됩니다.
- **백엔드 없이 프론트만 실행해도 됩니다** — 자동으로 localStorage 모드로 동작합니다(브라우저 콘솔에 안내 출력).
- 백엔드 종료: 실행 중인 터미널에서 `Ctrl+C`, 또는 `kill $(lsof -t -iTCP:8080 -sTCP:LISTEN)`. PostgreSQL 종료: `docker compose down`(데이터 유지) / `docker compose down -v`(데이터 삭제).

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

### Azure 단일 VM 배포 (Docker Compose)

VM 한 대에 프론트·백엔드·DB를 모두 올리는 구성입니다. `nginx`(프론트 서빙 + `/api` 프록시) → `backend`(Spring Boot) → `postgres` 3개 컨테이너를 `docker-compose.prod.yml` 하나로 띄웁니다. 외부에 열리는 포트는 nginx의 80뿐이고, 백엔드(8080)·DB(5432)는 compose 내부 네트워크 전용이라 인터넷에서 접근할 수 없습니다.

```
                인터넷 :80/:443
                     │
              ┌──────▼──────┐  nginx (frontend 컨테이너)
              │ 정적 서빙 +   │
              │ /api 프록시   │
              └──┬───────────┘
        /api → backend:8080
                 └──► Spring Boot ──► PostgreSQL (둘 다 내부 전용)
```

**1) VM 준비** — Azure Portal에서 Ubuntu 22.04/24.04 VM 생성(B2s 2vCPU/4GB 권장). NSG(방화벽)에서 **22·80·443만** 인바운드 허용. Docker 설치:

```bash
curl -fsSL https://get.docker.com | sh
```

**2) 코드 배포 + 시크릿** — 리포지토리를 VM에 clone(또는 CI로 전송) 후, 저장소 루트에서:

```bash
cp .env.example .env
# .env 를 열어 POSTGRES_PASSWORD 를 강한 값으로 수정 (이 파일은 커밋 금지 — .gitignore 포함됨)
```

**3) 실행**:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

`http://<VM_공인IP>` 로 접속하면 됩니다. 이미지 빌드(gradle·npm)까지 compose가 처리하므로 VM에 Java·Node를 따로 설치할 필요가 없습니다.

**운영 참고**
- **DB URL은 `sslmode` 불필요** — 백엔드와 DB가 같은 내부 네트워크라 SSL이 필요 없습니다(compose가 `jdbc:postgresql://postgres:5432/kanban`로 자동 주입).
- **HTTPS (권장)**: `http://<IP>`처럼 평문 HTTP+IP로 접속하면 브라우저가 **비보안 컨텍스트**로 취급해 `crypto.randomUUID` 등 secure-context 전용 API가 동작하지 않습니다(앱은 폴백으로 우회하지만, 근본 해결은 HTTPS). 도메인을 붙였다면 `frontend`의 nginx에 Let's Encrypt(certbot) 인증서를 추가하거나, 앞단에 Caddy/nginx TLS 종단을 두세요.
- **백업**: 관리형 DB와 달리 자동 백업이 없으므로 `docker exec <postgres컨테이너> pg_dump -U kanban kanban > backup.sql` 을 크론으로 주기 실행하세요. 데이터는 `kanban-pgdata`(DB) + `kanban-uploads`(업로드 파일) 볼륨에 유지되어 `docker compose down`(볼륨 유지) 후 재기동해도 보존됩니다. 업로드 파일까지 백업하려면 `kanban-uploads` 볼륨도 함께 아카이브하세요.
- **스키마**: `ddl-auto=update`라 최초 기동 시 `workspace_document` 테이블이 자동 생성됩니다.

> 관리형 서비스(App Service + Azure Database for PostgreSQL + Static Web Apps)로 분리 배포하는 것도 가능합니다. 그 경우 백엔드에 `SPRING_DATASOURCE_URL`(Azure는 SSL 필수라 `?sslmode=require` 포함)·`SPRING_DATASOURCE_USERNAME`·`SPRING_DATASOURCE_PASSWORD`를 주입하고, 프론트는 정적 호스팅에 `front/dist`를 올린 뒤 `/api`를 백엔드로 프록시하면 됩니다. 비용은 늘지만 OS/DB 관리를 Azure가 대행합니다.

## 4. 테스트 · 린트

```bash
cd front
npm test           # vitest 단위 테스트 (리듀서·유틸)
npm run lint       # oxlint

cd backend
./gradlew test     # 백엔드 API 테스트 (선행조건·동시성 포함)
```

## 5. 데이터 저장과 초기화

**백엔드 실행 시**: 서버(PostgreSQL)가 진실의 원천입니다. 모든 변경이 400ms 디바운스로 서버에 저장되고, 다른 브라우저·기기는 4초 폴링으로 동기화됩니다. localStorage는 미러(오프라인 캐시)로 계속 유지됩니다. 서버 데이터를 비우려면 `docker compose down -v`로 볼륨째 지우거나 `workspace_document` 테이블을 truncate 하세요.

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
