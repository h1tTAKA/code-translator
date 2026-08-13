// 일렉트론 셸 — nunopi(Next 앱)를 데스크톱 창으로 감싼다.
// dev: ELECTRON_START_URL(예: http://localhost:3000) 로드(next dev 병행, HMR).
// prod: .next/standalone/server.js를 동적 포트로 spawn 후 그 localhost 로드.
const { app, BrowserWindow, shell, ipcMain, Notification, dialog } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const {
  startSnaServer,
  resolveClaudeCli,
  resolveCodexCli,
  resolveOpenCodeCli,
} = require("@sna-sdk/core/electron");
const { spawn } = require("node:child_process");
const { createDaemonClient } = require("./daemon-client.cjs");
const { removeRepoHooks } = require("./agent-hooks.cjs");
const { getProviderUsage } = require("./provider-usage.cjs");
const { startWatch, stopWatch, stopAll: stopAllWatchers } = require("./repo-watcher.cjs");
const { join } = require("node:path");
const net = require("node:net");

// 빈 포트 하나 확보(패키지엔 devDep get-port가 없으므로 노드 net로 자체 구현).
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 특정 포트가 비어 있는지 확인.
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

// Next 서버 포트는 origin(host:port)이 곧 IndexedDB/localStorage 저장소 키라
// 매 실행 같아야 이력·북마크가 유지된다. 첫 실행에 빈 포트를 잡아 userData에
// 영속하고 이후 재사용. (SNA 포트는 origin 무관이라 동적 유지.)
async function getStableAppPort() {
  const file = join(app.getPath("userData"), "app-port.json");
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))?.port;
    if (Number.isInteger(saved) && (await isPortFree(saved))) return saved;
    if (Number.isInteger(saved)) {
      // 점유(외부 앱, 레어) — 새 포트로 갱신. origin이 바뀌어 기존 저장소와 분리되므로 경고.
      console.warn(`[electron] saved app port ${saved} in use — reallocating (stored data origin will change)`);
    }
  } catch { /* 첫 실행 */ }
  const port = await getFreePort();
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(file, JSON.stringify({ port }));
  } catch (e) { console.warn("[electron] app-port persist failed:", String(e)); }
  return port;
}

const DEV_URL = process.env.ELECTRON_START_URL; // 있으면 dev 모드
let serverProc = null;
let snaHandle = null;
let win = null;

// resolver 실패(미설치)를 삼켜 경로만 반환.
function safeResolve(fn) {
  try { const r = fn(); return r?.path; } catch { return undefined; }
}

// 유저가 설정 UI에서 지정한 런타임 CLI 경로 — userData/runtime-paths.json 영속.
// 부팅 시 saved > env(NUNOPI_*_COMMAND) > resolver 우선순위로 반영("재시작 후 적용").
const RUNTIME_PATH_KEYS = ["claudeCode", "codex", "opencode"];
function runtimePathsFile() {
  return join(app.getPath("userData"), "runtime-paths.json");
}
function loadSavedRuntimePaths() {
  try {
    const raw = JSON.parse(readFileSync(runtimePathsFile(), "utf8"));
    const out = {};
    for (const k of RUNTIME_PATH_KEYS) {
      if (typeof raw?.[k] === "string" && raw[k].trim()) out[k] = raw[k].trim();
    }
    return out;
  } catch (e) {
    // 파일 없음(첫 실행)은 정상. 그 외(손상 json 등)는 경고만 남기고 빈 설정으로.
    if (e?.code !== "ENOENT") console.warn("[runtime-paths] load failed:", String(e));
    return {};
  }
}
function saveRuntimePaths(paths) {
  const out = {};
  for (const k of RUNTIME_PATH_KEYS) {
    if (typeof paths?.[k] === "string" && paths[k].trim()) out[k] = paths[k].trim();
  }
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(runtimePathsFile(), JSON.stringify(out, null, 2));
  return out;
}

// 런타임 서버를 electron main이 소유(전체 node_modules + asar/native 자동 처리).
// standalone Next는 이 서버에 env로 연결(자체 임베드는 트레이스 누락으로 불가).
async function startRuntimeServer() {
  const saved = loadSavedRuntimePaths();
  const runtimePaths = {
    claudeCode: saved.claudeCode || process.env.NUNOPI_CLAUDE_COMMAND?.trim() || safeResolve(resolveClaudeCli),
    codex: saved.codex || process.env.NUNOPI_CODEX_COMMAND?.trim() || safeResolve(resolveCodexCli),
    opencode: saved.opencode || process.env.NUNOPI_OPENCODE_COMMAND?.trim() || safeResolve(resolveOpenCodeCli),
  };
  for (const k of Object.keys(runtimePaths)) if (!runtimePaths[k]) delete runtimePaths[k];
  console.log("[sna] runtimePaths:", JSON.stringify(runtimePaths));
  // 주의: forked 런타임 서버는 better-sqlite3(네이티브)를 로드한다. 패키징(③)에서
  // electron ABI로 rebuild한 뒤 { nativeBinding } 경로를 넘겨야 electron-owned 실행이 됨
  // (미rebuild면 "compiled for a different Node.js version"). ③에서 nativeBinding 추가.
  return startSnaServer({
    appId: "nunopi",
    port: await getFreePort(), // 3099 고정 대신 빈 포트(충돌 방지)
    dbPath: join(app.getPath("userData"), "sna.db"),
    runtimePaths,
    onLog: (l) => { if (/ready|error|fail/i.test(l)) console.log("[sna]", l); },
  });
}

// standalone 서버 spawn(prod). extraEnv(런타임 커넥션)를 주입. 준비되면 baseUrl 반환.
async function startStandaloneServer(extraEnv) {
  const port = await getStableAppPort();
  // 패키지: standalone은 extraResources로 process.resourcesPath/standalone.
  // 미패키지(electron electron/main.cjs): <appRoot>/.next/standalone.
  const serverJs = app.isPackaged
    ? join(process.resourcesPath, "standalone", "server.js")
    : join(__dirname, "..", ".next", "standalone", "server.js");
  serverProc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ...extraEnv,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ELECTRON_RUN_AS_NODE: "1", // electron 바이너리를 순수 node로 실행
    },
    stdio: "inherit",
  });
  serverProc.on("exit", (code) => { if (code) console.error("[electron] standalone server exited", code); });

  const base = `http://127.0.0.1:${port}`;
  await waitReady(`${base}/api/sna/status`);
  return base;
}

async function waitReady(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 503) return; // 503=SNA 미기동이어도 서버 자체는 살아있음
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready: ${url}`);
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    // 타이틀바 숨기고 신호등만 — 콘텐츠(탭 바)가 최상단까지(#779, Orca·옵시디언式).
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 }, // 탭 바 높이 세로 중앙에 신호등
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(url);
  // 외부 링크는 기본 브라우저로.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  // 전체화면(확대) 진입/이탈 통지(#779) — 렌더러가 신호등 자리 좌측 패딩을 토글.
  win.on("enter-full-screen", () => win?.webContents.send("window:fullscreen", true));
  win.on("leave-full-screen", () => win?.webContents.send("window:fullscreen", false));
  win.on("closed", () => { win = null; });
}

async function boot() {
  if (DEV_URL) {
    // dev: next dev가 자체 임베드(간섭 방지) → main은 SNA 안 띄움.
    appBase = DEV_URL; // #765 버퍼 드라이버 POST 대상
    createWindow(DEV_URL);
    return;
  }
  // prod: main이 런타임 서버 소유 → 커넥션을 standalone Next에 env로 주입.
  snaHandle = await startRuntimeServer();
  const base = await startStandaloneServer({
    SNA_BASE_URL: snaHandle.connection.baseUrl,
    SNA_AUTH_TOKEN: snaHandle.connection.authToken,
  });
  appBase = base; // #765 버퍼 드라이버 POST 대상
  createWindow(base);
}

// 설정 UI(renderer) ↔ main IPC — 런타임 CLI 경로 저장/조회 + 재시작.
ipcMain.handle("window:isFullscreen", () => win?.isFullScreen() ?? false); // 초기 전체화면 상태(#779)
ipcMain.handle("runtime-paths:get", () => loadSavedRuntimePaths());
ipcMain.handle("runtime-paths:set", (_e, paths) => ({ ok: true, saved: saveRuntimePaths(paths) }));
ipcMain.handle("app:relaunch", () => { app.relaunch(); app.quit(); });
// Claude·Codex 구독 사용 한도 조회(#735) — 로컬 크레덴셜로 각 provider usage 엔드포인트 호출.
ipcMain.handle("provider-usage:get", () => getProviderUsage());
// 레포 파일 워처(#739) — 변경 시 렌더러에 repo:changed push. 활성 레포당 하나(렌더러가 전환 관리).
ipcMain.handle("repo:watch", (e, { id, root }) => startWatch(id, root, () => { try { e.sender.send("repo:changed", { id }); } catch { /* ignore */ } }));
ipcMain.handle("repo:unwatch", (_e, { id }) => { stopWatch(id); });

// 알림 아이콘 경로 — dev=public, 패키지=standalone/public(존재하는 첫 후보).
function notifyIconPath() {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "standalone", "public", "brand", "nunopi-appicon-512.png"),
        join(process.resourcesPath, "public", "brand", "nunopi-appicon-512.png"),
      ]
    : [join(__dirname, "..", "public", "brand", "nunopi-appicon-512.png")];
  for (const c of candidates) { try { if (existsSync(c)) return c; } catch { /* ignore */ } }
  return undefined;
}

// 데스크톱 네이티브 알림(분석 완료 등). 창을 보고 있으면(포커스) 스킵 — 안 보고 있을 때만 알림.
ipcMain.handle("notify", (_e, payload) => {
  const { title, body } = payload ?? {};
  if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
  if (win && win.isFocused()) return { ok: false, reason: "focused" };
  const n = new Notification({ title: title || "nunopi", body: body || "", icon: notifyIconPath() });
  n.on("click", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  n.show();
  return { ok: true };
});

// 레포 폴더 선택 — OS 네이티브 폴더 창. { canceled, path }.
ipcMain.handle("repo:pickFolder", async () => {
  const res = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  return { canceled: false, path: res.filePaths[0] };
});

// ── 터미널 — pty를 detached 데몬(terminal-daemon.cjs)이 소유(#682). 앱 종료에도 세션(프로세스) 생존.
// 메인은 데몬에 소켓 프록시만. terminal:* IPC 계약(ensure/input/resize/kill/data/exit)은 그대로.
const PTY_BUFFER_MAX = 200_000; // 재생용 스크롤백 상한(문자)
const broadcast = (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch { /* ignore */ } } };

// 데몬 스크립트 경로 — 패키지는 extraResources(커밋 4), dev는 electron 폴더.
function daemonScriptPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "electron", "terminal-daemon.cjs")
    : join(__dirname, "terminal-daemon.cjs");
}

// 스크롤백 디스크 영속(#680) — 데몬이 유휴 reap된 뒤(콜드 스타트) 이전 내용 재생용. { id: buffer }.
// 데몬이 살아있는 재접속(warm)이면 데몬 buffer가 진실이라 시드 안 함(중복 재생 방지).
const bufFile = () => join(app.getPath("userData"), "terminal-buffers.json");
let savedBuffers = {};
try { savedBuffers = JSON.parse(readFileSync(bufFile(), "utf8")) || {}; } catch { savedBuffers = {}; }
const liveBuffers = new Map(); // id → buffer  — 데몬 data 미러(디스크 영속용)

// #765 버퍼 스크레이핑 상태 드라이버 — liveBuffers를 파싱해 에이전트 상태를 상태 스토어로 POST(훅 대체).
// 데몬 data 미러라 낡은 데몬·서버 재시작·훅 로드 타이밍과 무관하게 동작.
const { parseAgentScreen, agentFromProcess } = require("./agent-screen.cjs");
let appBase = null;              // Next 서버 베이스 URL(boot서 설정)
const cwdById = new Map();       // id → cwd(레포 매핑)
const procById = new Map();      // id → foreground 프로세스명(데몬 list) — 에이전트 종료(셸 복귀) 게이트
const lastScreen = new Map();    // id → { state, agent, at }(변화·keep-alive 판단)
const screenTimers = new Map();  // id → 디바운스 타이머
const mapScreenState = (s) => (s === "idle" ? "done" : s); // 파서 idle → 스토어 done(present/ready)
// 포그라운드가 셸이면 에이전트 종료로 간주(버퍼에 옛 화면이 남아도 무시). herdr도 포그라운드 프로세스로 게이트.
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "pwsh", "powershell", "cmd", "login", "screen", "tmux"]);
const isShellProc = (p) => SHELLS.has(String(p || "").trim().toLowerCase().replace(/^-+/, ""));
async function refreshProcs() {
  try { const ss = await termClient.list(); procById.clear(); for (const s of ss) procById.set(s.id, s.process); }
  catch { /* 데몬 미응답 — procById 유지 */ }
}
async function postStatus(body) {
  if (!appBase) return;
  try { await fetch(`${appBase}/api/agent/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { /* 서버 미준비 등 — 다음 틱에 재시도 */ }
}
async function pushScreenState(id) {
  const cwd = cwdById.get(id);
  if (!cwd || !appBase) return;
  const proc = procById.get(id);
  const gone = proc !== undefined && isShellProc(proc);         // 포그라운드가 셸 = 에이전트 종료
  const parsed = gone ? null : parseAgentScreen(liveBuffers.get(id)); // {agent,state}|null
  const procAgent = gone ? null : agentFromProcess(proc);       // 프로세스명으로 "존재" 판정(버퍼 미판정 대비)
  let agent, state;
  if (parsed) { agent = parsed.agent; state = mapScreenState(parsed.state); } // 버퍼가 상태 잡음(working/waiting/유휴→done)
  else if (procAgent) { agent = procAgent; state = "done"; }    // 프로세스는 에이전트인데 버퍼 미판정 → 존재(유휴/체크), 스피너 아님
  else {
    // 에이전트 없음(종료/셸/미인식) — 이전에 보고했으면 스토어에서 제거해 카드서 사라지게.
    if (lastScreen.has(id)) { lastScreen.delete(id); await postStatus({ cwd, sessionId: id, clear: true }); }
    return;
  }
  const prev = lastScreen.get(id);
  const now = Date.now();
  const changed = !prev || prev.state !== state || prev.agent !== agent;
  if (!changed && prev && now - prev.at < 30000) return; // 같은 상태면 30s마다만 재POST(TTL 유지, 과POST 억제)
  lastScreen.set(id, { state, agent, at: now });
  // 서브라인은 안 붙인다 — OSC 타이틀은 세션 이름(첫 프롬프트 요약)이지 현재 활동이 아니라 오해 소지. 활동은 워크트리 커밋라인이 담당.
  await postStatus({ cwd, agent, state, sessionId: id, source: "screen" });
}
function scheduleScreenParse(id) {
  if (screenTimers.has(id)) return; // 코얼레스(버스트 억제)
  screenTimers.set(id, setTimeout(() => { screenTimers.delete(id); void pushScreenState(id); }, 150));
}
setInterval(async () => { await refreshProcs(); for (const id of liveBuffers.keys()) void pushScreenState(id); }, 1200); // 프로세스 갱신 + 파싱(종료 감지·keep-alive)

// 데몬 소켓 클라이언트 — 죽어있으면 fork(detached,unref)로 스폰. data/exit는 렌더러로 브로드캐스트.
// 소켓 주소 — Windows는 파일 경로 리슨 불가라 네임드 파이프(net이 자동 인식).
// ponytail: 파이프명 고정(단일 유저 가정). 멀티유저 격리 필요 시 userData 해시 접미.
const termSock = process.platform === "win32"
  ? "\\\\.\\pipe\\nunopi-terminal-daemon"
  : join(app.getPath("userData"), "terminal-daemon.sock");
const termClient = createDaemonClient({
  sock: termSock,
  metaFile: join(app.getPath("userData"), "terminal-daemon.json"),
  daemonScript: daemonScriptPath(),
  // fork는 process.execPath(=electron)로 실행 → ELECTRON_RUN_AS_NODE로 순수 node처럼 데몬 구동.
  spawnEnvExtra: { ELECTRON_RUN_AS_NODE: "1", NUNOPI_TERM_SHELL: process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/bash") },
  onData: (id, data) => {
    let b = (liveBuffers.get(id) || "") + data;
    if (b.length > PTY_BUFFER_MAX) b = b.slice(-PTY_BUFFER_MAX);
    liveBuffers.set(id, b);
    broadcast("terminal:data", { id, data });
    scheduleScreenParse(id); // #765 버퍼 변화 → 상태 파싱(디바운스)
  },
  onExit: (id) => {
    liveBuffers.delete(id); delete savedBuffers[id];
    cwdById.delete(id); lastScreen.delete(id); // #765 정리
    const tm = screenTimers.get(id); if (tm) { clearTimeout(tm); screenTimers.delete(id); }
    broadcast("terminal:exit", { id });
  },
});

function persistBuffers() {
  const out = { ...savedBuffers }; // 아직 재접속 안 한 id의 저장분 보존
  for (const [id, b] of liveBuffers) out[id] = b.slice(-PTY_BUFFER_MAX);
  try { mkdirSync(app.getPath("userData"), { recursive: true }); writeFileSync(bufFile(), JSON.stringify(out)); } catch { /* ignore */ }
}
setInterval(persistBuffers, 5000); // 크래시 대비 주기 저장(before-quit은 아래 quit 훅서)

ipcMain.handle("terminal:ensure", async (_e, { id, cwd, cols, rows }) => {
  cwdById.set(id, cwd); // #765 버퍼 파서 상태를 이 레포에 매핑
  try { removeRepoHooks(cwd, app.getPath("userData")); } catch { /* 무시 */ } // #765 예전 #764 훅 주입분 정리(버퍼 스크레이핑이 대체)
  const r = await termClient.ensure({ id, cwd, cols, rows });
  if (!r.ok) return { ok: false, reason: r.reason || "daemon unavailable" };
  let buffer = r.buffer || "";
  // 콜드 스타트(데몬 buffer 빔)인데 디스크 저장분 있으면 이전 내용 재생 시드(#680). warm 재접속이면 skip.
  if (!buffer && savedBuffers[id]) buffer = savedBuffers[id] + "\r\n\x1b[2m── 이전 세션 내용(재시작 전) ──\x1b[0m\r\n";
  delete savedBuffers[id]; // 재생 1회 소비(중복 방지)
  liveBuffers.set(id, buffer);
  return { ok: true, buffer };
});
ipcMain.on("terminal:input", (_e, { id, data }) => termClient.input({ id, data }));
ipcMain.on("terminal:resize", (_e, { id, cols, rows }) => termClient.resize({ id, cols, rows }));
ipcMain.on("terminal:kill", (_e, { id }) => { termClient.kill({ id }); liveBuffers.delete(id); delete savedBuffers[id]; cwdById.delete(id); lastScreen.delete(id); }); // 탭 닫기 시 데몬 pty·저장분·상태 정리
ipcMain.handle("terminal:list", () => termClient.list()); // 세션 목록(#764) — 레포탭 호버 카드용

// 단일 인스턴스.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(boot).catch((e) => { console.error("[electron] boot failed", e); app.quit(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => {
    try { stopAllWatchers(); } catch { /* ignore */ } // 레포 워처 정리(#739)
    try { persistBuffers(); } catch { /* ignore */ } // 터미널 스크롤백 저장(#680)
    try { serverProc?.kill(); } catch { /* ignore */ }
    try { snaHandle?.stop(); } catch { /* ignore */ }
    // 터미널 데몬은 안 죽임 — 세션(프로세스) 생존(#682). 유휴 reap로만 종료.
  });
}
