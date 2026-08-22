// preload — renderer에 최소 데스크톱 API 노출(contextIsolation 유지).
// 런타임 CLI 경로 설정(재시작 후 적용)과 재시작만.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nunopiDesktop", {
  isDesktop: true,
  getRuntimePaths: () => ipcRenderer.invoke("runtime-paths:get"),
  setRuntimePaths: (paths) => ipcRenderer.invoke("runtime-paths:set", paths),
  relaunch: () => ipcRenderer.invoke("app:relaunch"),
  notify: (payload) => ipcRenderer.invoke("notify", payload),
  pickRepoFolder: () => ipcRenderer.invoke("repo:pickFolder"),
  // 클립보드 이미지를 임시 PNG로 저장하고 경로 반환(#799) — 터미널 Cmd+V 이미지 붙여넣기용. 이미지 없으면 ok:false.
  saveClipboardImage: () => ipcRenderer.invoke("clipboard:save-image"),
  // 학습 모드를 별도 창으로 열기(#789) — 멀티모니터. {ok} 반환(exists면 ok:false).
  openModeWindow: (kind) => ipcRenderer.invoke("mode-window:open", kind),
  // 탭·창 통합 모드 중복 레지스트리(#789). claim 성공 시에만 탭 추가, 닫을 때 release.
  modeClaim: (kind) => ipcRenderer.invoke("mode:claim", kind),
  modeRelease: (kind) => ipcRenderer.invoke("mode:release", kind),
  modeIsOpen: (kind) => ipcRenderer.invoke("mode:isOpen", kind),
  listOpenModes: () => ipcRenderer.invoke("mode:list"),
  onModesChanged: (cb) => { const h = (_e, kinds) => cb(kinds); ipcRenderer.on("modes:changed", h); return () => ipcRenderer.removeListener("modes:changed", h); },
  // 창 전체화면 상태(#779) — 신호등 자리 좌측 패딩 토글용. 초기 상태 조회 + 변경 구독(해제 함수 반환).
  window: {
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
    onFullscreen: (cb) => { const h = (_e, v) => cb(v); ipcRenderer.on("window:fullscreen", h); return () => ipcRenderer.removeListener("window:fullscreen", h); },
  },
  // Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735).
  getProviderUsage: () => ipcRenderer.invoke("provider-usage:get"),
  // 레포 파일 워처(#739) — 변경 시 onChanged 콜백. 활성 레포만 watch.
  repo: {
    watch: (opts) => ipcRenderer.invoke("repo:watch", opts),
    unwatch: (opts) => ipcRenderer.invoke("repo:unwatch", opts),
    onChanged: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("repo:changed", h); return () => ipcRenderer.removeListener("repo:changed", h); },
  },
  // GitHub 패널(#809/#810) — gh CLI 브릿지. auth=인증 상태 진단(서브3~5서 데이터 메서드 추가).
  github: {
    auth: (cwd) => ipcRenderer.invoke("github:auth", { cwd }),
    issueList: (cwd, state, limit) => ipcRenderer.invoke("github:issue-list", { cwd, state, limit }),  // #813
    issueView: (cwd, number) => ipcRenderer.invoke("github:issue-view", { cwd, number }),
    prList: (cwd, state, limit) => ipcRenderer.invoke("github:pr-list", { cwd, state, limit }),  // #814
    prView: (cwd, number) => ipcRenderer.invoke("github:pr-view", { cwd, number }),
    checks: (cwd) => ipcRenderer.invoke("github:checks", { cwd }),  // #812 현재 브랜치 CI
    checkAnnotations: (cwd, checkRunId) => ipcRenderer.invoke("github:check-annotations", { cwd, checkRunId }),  // #812
    jobSteps: (cwd, jobId) => ipcRenderer.invoke("github:job-steps", { cwd, jobId }),  // #812
    addComment: (cwd, kind, number, body) => ipcRenderer.invoke("github:add-comment", { cwd, kind, number, body }),  // #820
    editComment: (cwd, commentId, body) => ipcRenderer.invoke("github:edit-comment", { cwd, commentId, body }),  // #820
    deleteComment: (cwd, commentId) => ipcRenderer.invoke("github:delete-comment", { cwd, commentId }),
    react: (cwd, commentId, content) => ipcRenderer.invoke("github:react", { cwd, commentId, content }),  // #820 리액션 토글
    bodyReact: (cwd, number, content) => ipcRenderer.invoke("github:body-react", { cwd, number, content }),  // #822 본문 리액션
    editItem: (cwd, kind, number, title, body) => ipcRenderer.invoke("github:edit-item", { cwd, kind, number, title, body }),  // #822 제목·본문
    setState: (cwd, kind, number, action) => ipcRenderer.invoke("github:set-state", { cwd, kind, number, action }),
    merge: (cwd, number) => ipcRenderer.invoke("github:merge", { cwd, number }),  // #822 PR 머지(--merge --delete-branch)
  },
  // 터미널(pty) 브릿지 — 레포별 세션(#647).
  terminal: {
    ensure: (opts) => ipcRenderer.invoke("terminal:ensure", opts),
    input: (payload) => ipcRenderer.send("terminal:input", payload),
    resize: (payload) => ipcRenderer.send("terminal:resize", payload),
    kill: (payload) => ipcRenderer.send("terminal:kill", payload),
    list: () => ipcRenderer.invoke("terminal:list"),
    onData: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("terminal:data", h); return () => ipcRenderer.removeListener("terminal:data", h); },
    onExit: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("terminal:exit", h); return () => ipcRenderer.removeListener("terminal:exit", h); },
  },
});
