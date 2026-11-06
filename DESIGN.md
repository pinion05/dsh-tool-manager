# dsh-tools-toggle 설계

내장 도구(프리셋/글로벌 플레인에 등록된 모델 도구)를 Web UI에서 스위치로 끄고 켜는 번들.
작업 디렉터리: `~/dsh-tools-toggle` → `plugin_manager install_bundle`로 web 프로필에 설치.

## 1. 핵심 메커니즘 (검증 완료)

**끄기 = `agent.ctx.tools.restrict({ deny: [...] })`**
- dsh-tools 타입 정의 확인: restrict는 "상속 표면(global + 모든 조상 레이어)"을 필터한다.
  프리셋 플레인에 등록된 내장 도구(bash/read/write/…)도 각 에이전트 입장에선 조상 기여 → deny로 숨겨짐.
- 숨김 = 스키마·조회·실행 정렬(practices.md: "가장 약한 메커니즘" 원칙 부합).
  즉 끈 도구의 스키마/description이 모델 요청(tools 배열 / PTC 프롬프트)에서 아예 제외되어
  에이전트가 도구의 존재 자체를 모르고, 토큰도 절감됨. 이름 추측 호출은 UNKNOWN_TOOL 거부.
- 안전장치 내장: scope-local 도구(서브에이전트 구조화 출력 등 기계류)는 필터 안 됨,
  PTC `run_code` 예약 전송은 제거 불가 → 토글로 서브에이전트/워크플로 망가뜨릴 수 없음.
- 제약: unknown name은 throw → deny 목록을 해당 스코프 가시 이름으로 교집합 필터 후 호출.

**켜기 = restrict disposer 폐기.** 제거 즉시 `tools/change` 발행 → 다음 스텝부터 프롬프트/실행 반영.

**v1 제외 (사용자 전용 원칙, user-actions.md)**: 에이전트용 토글 도구.
재활성화는 정책 완화라 UI 전용. UI가 도구를 다 꺼도 UI 자체는 살아있어 잠금 불가능.

## 2. 상태 저장 = 플러그인 Config (settings 서비스)

- 호스트 절반에 `export const Config = Schema.object({ disabledTools: Schema.array(Schema.string()).default([]) })`.
- ns = Loader entry id(`tools-toggle`). 쓰기는 호스트가 `ctx.settings.update('tools-toggle', { disabledTools })` —
  프로필 패치(사용자 레이어)에 영속 → 업그레이드 생존, Loader 즉시 적용 → 플러그인 config 갱신 → 재적용.
- 별도 스토리지/파일 없음. 단일 writer(호스트 핸들러)라 revision 충돌 없음.

## 3. 아키텍처

```
[Client 반쪽]                     [Host 반쪽 (index.js, cordis 플러그인)]
settings.section 페이지           apply(ctx):
  도구 목록 + 검색 + 스위치         1) restrict 적용기
  fetch ↕ (동일 origin)             - ctx.agents.list() 기존 에이전트 전부
                                   - ctx.on('agent/created') 신규 에이전트
                                   - 등록은 agent.ctx.effect + plugin effect에 disposer 이중 소유
                                     (practices.md: agent dispose / plugin unload 양쪽 철거 보장)
                                  2) HTTP 라우트 (webServer.register, skills-manager 검증 패턴)
                                   GET  /tools-toggle/catalog  → [{name, description, disabled}]
                                   POST /tools-toggle/set      → {name, disabled} → settings.update
                                  3) 카탈로그 캐시: agent/created 시점 agent.ctx.tools.schemas()
                                     스냅샷(이름+설명) — 프리셋 플레인 도구 포함 보장
```

- 클라이언트 반쪽은 ModuleLoader 포맷(`window.__ModuleLoader__.load`, 데코레이션 템플릿 동일).
  React는 `require('react')`, 자체 스위치 컴포넌트(토큰만 공유, primitives 의존 없음).
- 설정 변경(토글) → Loader가 entry 재적용 → 플러그인 fiber 재시작 → 기존 에이전트 재제한.
  짧은 전환 창 허용(다음 스텝부터 반영이라 어차피 무해).

## 4. UI (Settings 전용 페이지)

- 슬롯: `settings.section` (id: `tools-toggle`, "도구" 라벨, KO/EN locale).
  실패 시 폴백: `plugins.item` 카드(agent-loop 패턴, 커스텀 컴포넌트 검증됨).
- 행: 스위치(`role="switch"` `aria-checked`) + 도구명 + 설명 1줄. 검색 박스 + 비활성 필터 칩.
- 토글 = 즉시 적용(스위치별 POST 1회). 낙관적 UI, 실패 시 되돌림 + 에러 표시.
- 그룹핑 v1 없음(가나다/알파벳). 원천 구분(내장 vs 플러그인)은 ToolDefinition에 출처 정보 없어 v2 과제.
- 스타일: `--dsw-alias-*` 토큰만. Plugin Manager 페이지 행 패턴 참조.
- 리소스: locale/ko.json + en.json, 자작 icon.svg (배포 체크리스트 준수).

## 5. 엣지 케이스

| 경우 | 처리 |
|---|---|
| deny 이름이 해당 스코프에 없음 | schemas(scope) 교집합 필터, 없으면 스킵 |
| 세션 없는 부팅 직후 카탈로그 요청 | 빈 목록 + "세션 시작 후 구성" 안내 (스냅샷은 agent/created에서 채움) |
| 도구 전부 끔 | 허용. UI는 살아있어 복구 가능. 핵심 도구(bash/read/write/edit) 끌 때 확인 다이얼로그 1회 |
| 서브에이전트/워크플로/팀 | agent/created에 전원 동일 적용. scope-local 기계류는 원천 면제 |
| 프로필 패치 수동 편집 | settings 서비스가 같은 필드 소유 — 단일 진실 원천 유지 |
| 업그레이드로 도구 이름 변경 | 교집합 필터가 자동 정리, 죽은 이름 무시 |

## 6. 패키지

- 이름: `@npmc_5/dsh-tools-toggle`, row id `tools-toggle`, 영문 설명 + KO locale.
- 구조: `package.json`(dsh.bundle.patch + dsh.client{platform:web, inject:[dsh-client-ui-settings]}),
  `index.js`(호스트), `client.js`(ModuleLoader), `cordis.patch.yml`(insert 1행), `locale/{ko,en}.json`, `icon.svg`.
- 빌드 없음(plain ESM). peerDeps: cordis, dsh-tools, dsh-host-webserver.

## 7. 구현 순서

1. 번들 스캐폴드 + 호스트: Config/restrict 적용기/카탈로그 캐시 (UI 없이 동작 확인 가능)
2. HTTP 라우트 2개 + settings.update 쓰기
3. 클라이언트: settings.section 페이지(스위치/검색/즉시적용)
4. install_bundle → 검증:
   - `application: applied` 확인
   - catalog 라우트 응답 (curl)
   - 도구 끄기 → 새 세션/현 세션 listTools에서 해당 도구 소실 확인, 켜기 → 복귀
   - 페이지 렌더(리프레시 후), 토글 → 프로필 패치에 disabledTools 기록 확인
   - 테스트 후 원복
5. 표시 메타데이터(제목/설명/아이콘) host-plugin 체크리스트 점검

## 8. 열린 결정 (기본값으로 진행, 이견 시 수정)

1. UI 위치 — Settings 전용 페이지(기본) / Plugins 페이지 카드
2. 적용 시점 — **새 세션(새 에이전트) 생성 시점 스냅샷(확정, 2026-11-04)**. 라이브 에이전트에는 절대 적용 안 함:
   도구 배열은 요청 prefix의 일부라 라이브 적용이 순간 프리픽스 캐시를 통째로 무효화함
   (dsh-tools: "scoped restriction may invalidate reuse from the first changed schema token").
   호스트 재시작 후 세션 resume은 새 agent/created로 간주 — 부팅 사이에 설정이 바뀌었으면 그때 1회 재프리필.
3. 범위 — 프로필 전체 공통(기본). 세션별 오버라이드는 v2
4. 에이전트 도구 — v1 제외(기본). 나중에 "끄기 전용" 도구만 추가 고려

## 9. 구현 검증 결과 (2026-11-04, v0.1.0)

전 항목 실호스트(dsh-web.service) 검증 완료:

- **은닉 메커니즘**: web_fetch/web_search 끔 → 차일드 서브에이전트(=새 에이전트)의 가용 도구 목록에서 해당 도구 완전 소실(스키마 제외). 재활성화 → 이후 생성분 복귀.
- **캐시 보호(섹션 8-2 확정 검증)**: web_search 끈 상태에서 라이브 세션(토글 전 생성)은 web_search 여전히 실행 가능, 같은 순간 생성된 서브에이전트는 소실 — 생성 시점 스냅샷 정상 동작.
- **영속**: 토글 → 프로필 패치(`profiles/web/cordis.patch.yml`) `tools-toggle.config.disabledTools` 기록, 이후 생성 에이전트에 자동 적용. 연속 토글 경쟁은 쓰기 큐 직렬화 + GET read-your-writes(쓰기 정착 후 응답)로 해결.
- **카탈로그**: 프리셋 플레인 도구 포함 37개. 이름은 `view(agent).restrictableNames`(상속 표면), 설명은 `view(agent).visible` — 무인자 `schemas()`는 **전역 뷰**만 반환(프리셋 플레인 누락)하므로 쓰면 안 됨.
- **클라이언트**: 모듈 그래프 등록 확인(앱 HTML 콤보 URL에 `@npmc_5/dsh-tools-toggle/client.js` 포함).

### 구현 중 발견한 제약 (재발 방지)

1. **volatile Config 필드는 참조 객체** — `Schema.array(...).volatile()` 필드는 파이버에 `{get()}` 참조로 전달(배열 아님). 매 사용 시 `get()`으로 재판독해야 하며, volatile이 아니면 settings 서비스가 쓰기를 거부("no volatile fields"). 갱신은 파이버 리마운트 없이 참조 스왑으로 일어남.
2. **pnpm `link:` 설치는 peer 해석 불가** — 번들 디렉터리에 `node_modules` 심볼릭 링크(→ dsh 설치 트리 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules`) 필요. 프로필 `profiles/node_modules`의 schemastery는 구버전(volatile 미지원)이라 dsh 트리를 직접 가리켜야 함.
3. **pnpm 12.16 `skills.dirs`는 워크스페이스 루트 기준 상대 경로만 헹택** — 프로필의 절대 경로(`/home/pinion/.dsh/skills`) 지정 시 `ERR_PNPM_NO_AGENT_SKILLS_DIR`로 install 자체가 실패. 워크스페이스 내 상대 경로(`agent-skills`)로 우회(기존 `~/.dsh/skills/honcho-memory` 심볼릭 링크는 직결이라 영향 없음).
4. **번들 패치는 dump-config와 런타임 모두 정상 병합** — insert 엔트리 + 사용자 레이어 config 오버라이드 조합 동작.
5. **라이브 쓰기 = 참조 스왑**: volatile 필드 갱신은 파이버 리마운트 없이 일어나 세션/에이전트 생존. 단 도구 표면 변경 자체는 프리픽스 캐시 무효화(섹션 8-2)라 생성 시점 스냅샷으로 회피.
