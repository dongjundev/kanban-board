# 칸반 보드

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.1-6DB33F?logo=springboot&logoColor=white)
![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

칸반 보드 웹 앱. React 19 + TypeScript + Vite 프론트엔드(`front/`)에 Spring Boot 4(Java 21) + PostgreSQL 백엔드(`backend/`)가 붙어 있습니다. 백엔드를 실행하면 데이터가 서버(PostgreSQL)에 저장되어 브라우저·기기 간 동기화(4초 폴링)가 되고, 백엔드가 없으면 자동으로 localStorage 단독 모드로 동작합니다.

> 설치·실행·배포·데이터 초기화 방법은 [GETTING_STARTED.md](./GETTING_STARTED.md),
> 상세 아키텍처(레이어 구조, 데이터 모델, 상태 흐름, 드래그&드롭 파이프라인)는 [ARCHITECTURE.md](./ARCHITECTURE.md) 참조.

## 실행

```bash
# 프론트엔드
cd front
npm install
npm run dev      # 개발 서버 (http://localhost:5173, /api → 8080 프록시)
npm run build    # 프로덕션 빌드 (tsc + vite)
npm test         # 리듀서 단위 테스트 (vitest)

# 백엔드 (선택 — 없으면 localStorage 모드). PostgreSQL 필요:
cd backend && docker compose up -d   # 로컬 PostgreSQL (localhost:5432)
cd backend && ./gradlew bootRun      # http://localhost:8080
cd backend && ./gradlew test         # API 테스트 (인메모리 H2로 실행)
```

## 기능

- **다중 보드**: 헤더의 '보드' 드롭다운으로 보드 생성·전환·삭제(마지막 1개는 보호)·순서 변경(↑↓). 컬럼/카드/라벨은 보드별로 독립. 기존 단일 보드 데이터는 첫 로드 때 자동 마이그레이션
- **컬럼**: 추가(연속 입력) / 이름 변경(제목 클릭) / 삭제(⋯ 메뉴) / 드래그로 순서 변경(헤더를 잡고 드래그)
- **카드**: 추가(연속 입력, ⋯ 메뉴로 맨 위 추가) / 드래그&드롭으로 컬럼 간·컬럼 내 이동 / 클릭 또는 Enter로 상세 모달 / 설명 있는 카드는 아이콘 표시
- **카드 상세**: 제목, 설명, 라벨(생성·이름/색 편집·삭제), 담당자(기존 이름 자동완성), 마감일(지우기 버튼)
- **마감일 표시**: 지남(빨강) / 임박·2일 이내(노랑) / 여유(회색), 다른 해면 연도 표기
- **필터**: 텍스트 검색(제목+설명+담당자+라벨 이름), 담당자 아바타 토글(5명 초과 시 +N 축약), 라벨 다중 선택 — 조합 가능, 보드별로 기억. 결과 0건이면 안내와 초기화 버튼
- **삭제 확인**: 모든 삭제는 인앱 확인 다이얼로그(수량 안내 포함)를 거침
- **실행 취소**: 카드/컬럼/보드/라벨 삭제 후 토스트의 '실행 취소'(7초)로 복원
- **터치 지원**: 짧은 스와이프는 스크롤, 250ms 길게 누르면 드래그 시작
- **메모 · 파일**: 상단 '메모' 탭에서 텍스트 메모 작성/삭제, 파일 업로드/다운로드/삭제. 서버 저장(메모·메타데이터는 PostgreSQL, 파일 바이트는 백엔드 볼륨) — 백엔드 실행 시에만 동작
- **다이어그램**: 상단 '다이어그램' 탭에서 mermaid 코드를 입력하면 300ms 디바운스로 미리보기가 갱신됨(문법 오류는 메시지로 표시하고 직전 그림 유지). 미리보기는 **휠로 확대/축소(커서 기준), 드래그로 이동**하고 +/−/원래 크기 버튼과 배율 표시 제공. 제목을 붙여 서버(PostgreSQL `diagram` 테이블)에 저장하고 목록에서 불러오기·수정·삭제. 다크 모드 연동. 편집 중 초안은 localStorage(`kanban-mermaid-draft`)에도 보관되며, **백엔드가 없으면 저장 UI만 감춰지고 편집·미리보기는 그대로 동작**
- **다크 모드**: 상단 탭 바 오른쪽의 달/해 버튼으로 토글 — 보드·메모·다이어그램 어느 탭에서나 접근 가능. 첫 방문 시 OS 설정(`prefers-color-scheme`)을 따르고, 토글하면 localStorage(`kanban-board-theme`)에 저장
- **영속성**: 백엔드 실행 시 서버(PostgreSQL)에 저장(디바운스 400ms) + 브라우저·기기 간 4초 폴링 동기화. localStorage는 미러/오프라인 폴백. 서버가 비어 있으면 첫 접속 때 로컬 데이터 자동 마이그레이션

## 구조

```
kanban-board/
├── front/                     # React 프론트엔드 (아래 src/ 트리)
├── backend/                   # Spring Boot 4 (Java 21) — 문서형 워크스페이스 API + PostgreSQL
└── *.md                       # 프로젝트 문서

front/src/
├── types.ts               # Label / Card / Column / BoardState / Workspace 도메인 타입
├── seed.ts                # 첫 방문 시 샘플 보드, 새 보드 템플릿
├── storage.ts             # localStorage 로드/저장 (스키마 검증, 레거시 마이그레이션)
├── filtering.ts           # 카드 필터 매칭 로직
├── utils.ts               # id 생성, 아바타 색상/이니셜, 마감일 상태
├── state/
│   ├── boardReducer.ts    # 순수 리듀서 — 보드 내부 조작 액션
│   ├── workspaceReducer.ts # 보드 생성/삭제/전환 + 보드 액션을 활성 보드에 위임
│   ├── *.test.ts
│   └── BoardContext.tsx   # useReducer + localStorage 자동 저장 + 탭 간 동기화 Provider
└── components/
    ├── BoardSwitcher.tsx  # 보드 목록/전환/생성/삭제 드롭다운
    ├── Board.tsx          # @dnd-kit DndContext, 드래그 오케스트레이션
    ├── Column.tsx         # 컬럼 (sortable, 인라인 이름 변경, 메뉴)
    ├── CardItem.tsx       # 카드 (sortable) + DragOverlay용 CardOverlay
    ├── CardModal.tsx      # 카드 상세 모달
    ├── LabelPicker.tsx    # 라벨 지정/생성/삭제 팝오버
    ├── BoardHeader.tsx    # 보드 제목, 검색, 담당자/라벨 필터
    ├── AddCardComposer.tsx
    ├── AddColumnButton.tsx
    ├── MemoPage.tsx       # 메모·파일 업로드 페이지 (서버 저장)
    ├── MermaidPage.tsx    # mermaid 실시간 편집·미리보기 (mermaid는 동적 import로 청크 분리)
    └── Avatar.tsx
```

## 설계 노트

- **정규화 상태**: 카드 본문은 `cards` 맵에 한 번만 존재하고, 컬럼은 `cardIds` 배열로 순서만 관리합니다. 드래그 이동은 id 이동일 뿐이라 안전합니다.
- **드래그&드롭**: `@dnd-kit`의 multiple-containers 패턴 — `onDragOver`에서 컬럼 간 이동을 실시간 반영(라이브 프리뷰)하고, `onDragEnd`에서 같은 컬럼 내 최종 순서를 확정합니다.
- **한글 IME**: 모든 Enter 제출 입력에 `isComposing` 가드가 있어 한글 조합 중 Enter로 인한 중복 제출이 없습니다.
- **필터 중 드래그**: 화면에 보이는(필터된) 카드 기준으로 드롭 위치를 잡되, 실제 삽입 인덱스는 전체 `cardIds`에서 계산하므로 필터가 걸린 상태에서도 순서가 깨지지 않습니다.
