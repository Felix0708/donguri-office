# stock-briefing Phase 2-2 오늘 작업 계획 및 통합 보고

## 오늘의 목표

질문 → 공시 검색 → 근거 기반 답변 → DART 출처 링크까지 동작하는 Next.js 웹앱 MVP를 완성하고 로컬 통합 검증을 통과시킨다.

현재 구현은 완료됐으나, 네트워크 제한으로 실제 의존성 설치·프로덕션 빌드·외부 API 통합 검증이 남아 있어 상태는 **조건부 미완료**다.

## 작업 계획

1. Next.js 기반 구성과 환경변수 체계를 확정한다.
2. `POST /api/ask`에서 질문 검증, 임베딩 생성, Supabase 검색, Gemini 답변 생성을 연결한다.
3. 질문 입력, 로딩·오류·빈 결과, 답변, DART 출처 UI를 구현한다.
4. Secret 노출, 출처 URL, RLS, 중복 출처 및 검색 임계값을 점검한다.
5. 네트워크 가능한 환경에서 설치·빌드·로컬 통합 테스트를 수행한다.
6. 모든 검증 통과 후 Vercel 배포를 별도 진행한다.

## 구현 결과

### 웹 기반 구성

- `web/`에 Next.js 15.5.20, TypeScript strict, ESLint 구성을 추가했다.
- Gemini·Supabase Secret은 서버 환경변수로만 사용한다.
- `.env.local`, `.vercel`, 빌드 산출물은 Git에서 제외한다.
- 설치·실행·검증 절차와 Secret 관리 기준을 문서화했다.

### 백엔드 API

- `POST /api/ask` 요청 검증과 구조화된 오류 응답을 구현했다.
- Gemini `embedding-001`로 768차원 질문 임베딩을 생성한다.
- Supabase `match_filings` RPC를 호출하고 유사도 임계값 미달 결과를 제외한다.
- 검색 결과가 없으면 Gemini를 호출하지 않는다.
- 검색된 공시만 문맥으로 사용해 근거 기반 답변과 `[S1]` 형식의 출처를 생성한다.
- 동일 공시의 여러 청크는 하나의 출처로 중복 제거한다.
- 429·5xx 재시도와 타임아웃을 처리한다.
- Supabase Secret Key는 `apikey` 헤더로만 전달한다.

### 프론트엔드 및 UX

- 단일 화면에서 종목 필터, 질문 입력, 예시 질문, 답변 및 출처를 제공한다.
- 예시 질문은 선택 즉시 실행한다.
- 제출 중 입력과 필터를 잠가 중복 요청을 방지한다.
- 로딩, 입력 오류, 빈 결과, 답변 생성 실패, 요청·네트워크·제한 초과 상태를 구분한다.
- 근거가 없으면 일반 지식 기반 답변을 표시하지 않는다.
- 출처 카드는 기업명, 접수일, 공시명, 원문 일부와 DART 링크를 표시한다.
- 출처 링크는 HTTPS DART 호스트만 허용하고 새 탭에서 연다.
- 기존 대시보드의 카드형 UI, 파란색 포인트, 다크모드를 계승한다.
- 360px 모바일 대응, 키보드 탐색, 포커스 이동, `aria-live`, `role="alert"`, reduced-motion을 반영했다.

### 보안 및 운영

- `filings` 테이블에 RLS를 활성화하도록 스키마를 보완했다.
- Client Component와 `NEXT_PUBLIC_` 변수에서 Secret 참조가 없음을 확인했다.
- 운영 Supabase에는 변경된 `db/schema.sql`을 다시 실행해야 RLS가 실제 적용된다.
- Git push와 Vercel 배포는 수행하지 않았다.

## 검증 결과

통과:

- TypeScript strict 검사
- 모킹 기반 API 스모크 테스트
- 빈 질문 400 응답
- 출처 중복 제거
- 유사도 미달 시 Gemini 호출 생략
- Secret 응답·클라이언트 노출 검사
- DART 출처 호스트 제한
- JSON·ESLint·셸 구문 검사
- Git ignore 적용
- `git diff --check`
- QA 정적 검사 실패 0건

남은 검증:

- 정상 `npm install`
- ESLint 전체 실행
- Next.js production build
- 실제 Gemini·Supabase 연동 질문
- 외부 API 오류 주입
- 브라우저 화면 및 모바일 실기동
- 배포 번들의 Secret 노출 검사

## 다음 실행 명령

```bash
npm --prefix web install
npm --prefix web run lint
npm --prefix web run typecheck
RUN_BUILD=1 scripts/phase2-2-qa.sh
npm --prefix web run dev
BASE_URL=http://localhost:3000 scripts/phase2-2-qa.sh
```

검증 전에 `web/.env.local`에 Gemini·Supabase 값을 설정하고, 운영 Supabase에서 최신 `db/schema.sql`을 적용해야 한다.

## 수정·생성된 파일

- `/.env.example`
- `/.gitignore`
- `/db/schema.sql`
- `/docs/PHASE2_2_QA.md`
- `/scripts/phase2-2-qa.sh`
- `/web/.env.local.example`
- `/web/.gitignore`
- `/web/README.md`
- `/web/eslint.config.mjs`
- `/web/next-env.d.ts`
- `/web/next.config.ts`
- `/web/package.json`
- `/web/tsconfig.json`
- `/web/app/api/ask/route.ts`
- `/web/app/globals.css`
- `/web/app/layout.tsx`
- `/web/app/page.tsx`
- `/web/components/ask-panel.tsx`
- `/web/lib/ask-types.ts`
- `/web/lib/server/ask.ts`
- `/web/lib/server/config.ts`
- `/web/lib/server/gemini.ts`
- `/web/lib/server/http.ts`
- `/web/lib/server/supabase.ts`

## 완료 판정

오늘의 구현 범위는 충족했다. 다만 **프로덕션 빌드와 실제 외부 서비스 기반 로컬 통합 검증이 통과해야 Phase 2-2 완료로 확정**한다. 해당 검증 전에는 Vercel 배포를 진행하지 않는다.

--- 참여: 김팀장, 오차장, 박주임, 강대리, 이대리, 정사원