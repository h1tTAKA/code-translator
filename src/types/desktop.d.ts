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
  // 터미널(pty) — 레포 경로별 세션(#647). ensure는 세션 확보 + 재생용 scrollback 반환.
  terminal: {
    ensure(opts: { cwd: string; cols: number; rows: number }): Promise<{ ok: boolean; buffer?: string; reason?: string }>;
    input(payload: { cwd: string; data: string }): void;
    resize(payload: { cwd: string; cols: number; rows: number }): void;
    onData(cb: (p: { cwd: string; data: string }) => void): () => void;
    onExit(cb: (p: { cwd: string }) => void): () => void;
  };
}

interface Window {
  nunopiDesktop?: NunopiDesktopApi;
}
