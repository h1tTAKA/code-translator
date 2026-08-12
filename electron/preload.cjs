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
  // Claude·Codex 구독 사용 한도(세션/주간/Fable) 조회(#735).
  getProviderUsage: () => ipcRenderer.invoke("provider-usage:get"),
  // 레포 파일 워처(#739) — 변경 시 onChanged 콜백. 활성 레포만 watch.
  repo: {
    watch: (opts) => ipcRenderer.invoke("repo:watch", opts),
    unwatch: (opts) => ipcRenderer.invoke("repo:unwatch", opts),
    onChanged: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("repo:changed", h); return () => ipcRenderer.removeListener("repo:changed", h); },
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
