// 일렉트론 preload가 노출하는 데스크톱 API(웹에선 undefined).
interface NunopiDesktopApi {
  isDesktop: true;
  getRuntimePaths(): Promise<{ claudeCode?: string; codex?: string; opencode?: string }>;
  setRuntimePaths(paths: { claudeCode?: string; codex?: string; opencode?: string }): Promise<{ ok: boolean; saved: Record<string, string> }>;
  relaunch(): Promise<void>;
  // 데스크톱 네이티브 알림. 창 포커스 중이면 스킵(reason:"focused").
  notify(payload: { title: string; body?: string }): Promise<{ ok: boolean; reason?: string }>;
  // 레포 폴더 선택(OS 네이티브 창). 취소 시 { canceled: true }.
  pickRepoFolder(): Promise<{ canceled: boolean; path?: string }>;
  // 클립보드 이미지를 임시 PNG로 저장하고 경로 반환(#799) — 터미널 Cmd+V 이미지 붙여넣기. 이미지 없으면 ok:false.
  saveClipboardImage?(): Promise<{ ok: boolean; path?: string; error?: string }>;
  // 학습 모드를 별도 창으로 열기(#789) — 멀티모니터. ok:false(reason:"exists")면 이미 떠 있음.
  openModeWindow?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean; reason?: string }>;
  // 탭·창 통합 모드 중복 레지스트리(#789). 탭 점유/해제/조회 + 변경 구독(해제 함수 반환).
  modeClaim?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean }>;
  modeRelease?(kind: "ask" | "code" | "text" | "memorize"): Promise<{ ok: boolean }>;
  modeIsOpen?(kind: "ask" | "code" | "text" | "memorize"): Promise<boolean>;
  listOpenModes?(): Promise<Array<"ask" | "code" | "text" | "memorize">>;
  onModesChanged?(cb: (kinds: Array<"ask" | "code" | "text" | "memorize">) => void): () => void;
  // 창 전체화면 상태(#779) — 신호등 자리 좌측 패딩 토글용. onFullscreen은 해제 함수 반환.
  window?: {
    isFullscreen(): Promise<boolean>;
    onFullscreen(cb: (v: boolean) => void): () => void;
  };
  // Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735). 상세 타입은 @/lib/usage/types.
  getProviderUsage?(): Promise<import("@/lib/usage/types").ProviderUsageResult>;
  // 레포 파일 워처(#739) — 활성 레포 변경 감지. recursive 미지원 플랫폼은 supported:false → 폴백.
  repo?: {
    watch(opts: { id: string; root: string }): Promise<{ ok: boolean; supported: boolean; error?: string }>;
    unwatch(opts: { id: string }): Promise<void>;
    onChanged(cb: (p: { id: string }) => void): () => void;
  };
  // 터미널(pty) — id별 세션(#647·#678 멀티탭). cwd는 spawn 작업 디렉터리. ensure는 세션 확보 + 재생용 scrollback 반환.
  terminal: {
    ensure(opts: { id: string; cwd: string; cols: number; rows: number }): Promise<{ ok: boolean; buffer?: string; reason?: string }>;
    input(payload: { id: string; data: string }): void;
    resize(payload: { id: string; cols: number; rows: number }): void;
    kill(payload: { id: string }): void;
    // 세션 목록(#764) — 레포탭 호버 카드용. process=foreground 프로세스명(claude/codex/zsh…), cwd=spawn 디렉터리.
    // agent(#803)=실행 중 에이전트 id | null(버퍼 파싱 우선 → node 래퍼 CLI도 감지). 탭 자동 이름·아이콘용.
    list(): Promise<{ id: string; cwd: string; process: string; pid: number; agent: string | null }[]>;
    onData(cb: (p: { id: string; data: string }) => void): () => void;
    onExit(cb: (p: { id: string }) => void): () => void;
  };
}

interface Window {
  nunopiDesktop?: NunopiDesktopApi;
}
