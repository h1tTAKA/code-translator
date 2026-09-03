// 일렉트론 셸 — nunopi(Next 앱)를 데스크톱 창으로 감싼다.
// dev: ELECTRON_START_URL(예: http://localhost:3000) 로드(next dev 병행, HMR).
// prod: .next/standalone/server.js를 동적 포트로 spawn 후 그 localhost 로드.
const { app, BrowserWindow, shell, ipcMain, Notification, dialog, clipboard, safeStorage } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } = require("node:fs");
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
const githubBridge = require("./github-bridge.cjs"); // GitHub 패널(#809/#810) gh CLI 브릿지
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
const RUNTIME_PATH_KEYS = ["claudeCode", "codex", "opencode", "gh"]; // gh=GitHub CLI(#810), 설정서 경로 지정 가능(없으면 PATH의 gh)
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

// 창 공통 배선 — 외부 링크 처리 + 전체화면 통지(#779). 메인 창·모드 전용 창(#789) 공유.
function wireWindowCommon(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  w.on("enter-full-screen", () => w.webContents.send("window:fullscreen", true));
  w.on("leave-full-screen", () => w.webContents.send("window:fullscreen", false));
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
  wireWindowCommon(win);
  win.on("closed", () => { win = null; });
}

// 모드 전용 창(#789) — 그 모드만 보이는 별도 창. appBase에 ?win=<kind> 를 붙여 로드.
// 렌더러(page.tsx)가 win 파라미터를 읽어 windowMode로 렌더한다. 반환된 창을 호출부가 추적.
function createModeWindow(kind) {
  const sep = appBase.includes("?") ? "&" : "?";
  const w = new BrowserWindow({
    width: 1100,
    height: 820,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.loadURL(`${appBase}${sep}win=${encodeURIComponent(kind)}`);
  wireWindowCommon(w);
  return w;
}

// 크로스창 모드 중복 레지스트리(#789) — 한 모드(ask/code/text)는 탭으로든 창으로든 한 번만.
// 탭은 메인 창 렌더러 메모리, 창은 별도 프로세스라 서로 못 보므로 main이 단일 소스로 든다.
// 창 닫힘은 아래 mode-window:open에서 release로 자동 해제(크래시에도 누수 없음).
const openModes = new Map(); // kind -> "tab" | "window"
function broadcastModes() {
  const kinds = [...openModes.keys()];
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send("modes:changed", kinds); } catch { /* 창 파괴 중 무시 */ }
  }
}
function claimMode(kind, where) {
  if (openModes.has(kind)) return false;
  openModes.set(kind, where);
  broadcastModes();
  return true;
}
function releaseMode(kind) {
  if (openModes.delete(kind)) broadcastModes();
}

async function boot() {
  try { loadRegistry(); } catch { /* #864 재시작 생존 세션 신원 복원 */ }
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
// 클립보드 이미지 → 임시 PNG 저장(#799) — 터미널 Cmd+V 이미지 붙여넣기. 경로를 렌더러가 터미널에 주입.
ipcMain.handle("clipboard:save-image", () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return { ok: false };
    const p = join(app.getPath("temp"), `nunopi-paste-${Date.now()}.png`);
    writeFileSync(p, img.toPNG());
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
// 모드 전용 창 열기(#789) — 유효 kind + 아직 어디에도 안 떠 있을 때만. 창 닫히면 자동 해제.
ipcMain.handle("mode-window:open", (_e, kind) => {
  if (kind !== "ask" && kind !== "code" && kind !== "text" && kind !== "memorize") return { ok: false, reason: "invalid" };
  if (!appBase) return { ok: false, reason: "not-ready" }; // boot() 전엔 URL 없음(가드; 실제론 렌더러 IPC가 항상 이후)
  if (!claimMode(kind, "window")) return { ok: false, reason: "exists" };
  try {
    const w = createModeWindow(kind);
    w.on("closed", () => releaseMode(kind));
  } catch (e) {
    releaseMode(kind); // 창 생성 실패 시 점유 해제 — 안 하면 영구 점유로 영영 못 엶.
    return { ok: false, reason: "error", error: String(e?.message || e) };
  }
  return { ok: true };
});
// 탭 쪽 모드 점유/해제/조회(#789) — 메인 창 렌더러가 모드 탭 추가·닫기·복원 시 호출.
ipcMain.handle("mode:claim", (_e, kind) => ({ ok: claimMode(kind, "tab") }));
ipcMain.handle("mode:release", (_e, kind) => { releaseMode(kind); return { ok: true }; });
ipcMain.handle("mode:isOpen", (_e, kind) => openModes.has(kind));
ipcMain.handle("mode:list", () => [...openModes.keys()]);
ipcMain.handle("runtime-paths:get", () => loadSavedRuntimePaths());
ipcMain.handle("runtime-paths:set", (_e, paths) => ({ ok: true, saved: saveRuntimePaths(paths) }));
// GitHub 패널(#810) — gh 경로는 설정값 우선, 없으면 PATH의 gh. IPC로 인증 상태 진단(서브3~5가 데이터 IPC 추가).
const ghExe = () => loadSavedRuntimePaths().gh || "gh";

// 토큰(PAT) 폴백(#826, 서브6) — gh auth login 없이 PAT를 GH_TOKEN으로 주입.
// safeStorage(OS 키체인)로 암호화 저장. 값은 렌더러 비노출(존재 여부만).
function ghTokenFile() { return join(app.getPath("userData"), "gh-token.json"); }
function loadGhToken() {
  try {
    const { enc } = JSON.parse(readFileSync(ghTokenFile(), "utf8"));
    if (!enc || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(enc, "base64")) || null;
  } catch { return null; } // 파일 없음/복호화 실패 → 토큰 없음
}
function saveGhToken(token) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, detail: "이 환경은 안전한 토큰 저장을 지원하지 않음(safeStorage 불가)" };
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    const enc = safeStorage.encryptString(String(token)).toString("base64");
    writeFileSync(ghTokenFile(), JSON.stringify({ enc }));
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e?.message || e).slice(0, 300) }; // 디스크 풀·권한 등 → reject 대신 에러 객체
  }
}
function clearGhToken() { try { rmSync(ghTokenFile()); } catch { /* 없으면 무시 */ } }
// gh 실행 env — 저장된 토큰 있으면 GH_TOKEN 주입, 없으면 기본 env(undefined → 브릿지가 process.env).
function ghEnv() { const tok = loadGhToken(); return tok ? { ...process.env, GH_TOKEN: tok } : undefined; }

// 토큰 IPC(#826) — set(저장)/status(존재 여부만)/clear(삭제).
ipcMain.handle("github:set-token", (_e, { token }) => {
  if (typeof token !== "string" || !token.trim()) return { ok: false, detail: "빈 토큰" };
  return saveGhToken(token.trim());
});
ipcMain.handle("github:token-status", () => ({ hasToken: loadGhToken() != null }));
ipcMain.handle("github:clear-token", () => { clearGhToken(); return { ok: true }; });

ipcMain.handle("github:auth", (_e, { cwd }) => githubBridge.authDiagnose({ gh: ghExe(), cwd, env: ghEnv() }));
// 이슈 목록·상세(#813) — gh issue list/view --json. state=open|closed|all(기본 open).
ipcMain.handle("github:issue-list", (_e, { cwd, state, limit }) => {
  const st = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000); // 1..1000 클램프(더 보기 페이지네이션)
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["issue", "list", "--json", "number,title,state,labels,author,createdAt,updatedAt", "--state", st, "--limit", String(lim)] });
});
ipcMain.handle("github:issue-view", (_e, { cwd, number }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid issue number" }; // 숫자만(플래그 오인 방지)
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["issue", "view", String(n), "--json", "number,title,state,labels,author,assignees,milestone,body,comments,createdAt,url,reactionGroups"] });
});
// PR 목록·상세(#814) — gh pr list/view --json. statusCheckRollup=CI 체크(서브3 재사용).
ipcMain.handle("github:pr-list", (_e, { cwd, state, limit }) => {
  const st = state === "closed" ? "closed" : state === "all" ? "all" : "open";
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 1000);
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "list", "--json", "number,title,state,isDraft,author,createdAt,updatedAt,statusCheckRollup", "--state", st, "--limit", String(lim)] });
});
ipcMain.handle("github:pr-view", (_e, { cwd, number }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid pr number" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "view", String(n), "--json", "number,title,state,isDraft,author,createdAt,assignees,body,comments,statusCheckRollup,mergeStateStatus,url,reactionGroups"] });
});
// 현재 브랜치 CI(#812) — gh pr view(번호 없이 = 현재 브랜치 PR)로 statusCheckRollup. PR 없으면 {noPr:true}.
ipcMain.handle("github:checks", async (_e, { cwd }) => {
  const r = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "view", "--json", "number,title,state,statusCheckRollup,url,headRefName"] });
  if (!r.ok && /no pull requests found|no default remote|not found/i.test(r.detail || "")) return { ok: true, data: { noPr: true } };
  return r;
});
// 체크 주석(#812) — gh api로 check-run annotations(경고/에러). id는 detailsUrl서 파싱한 job id.
ipcMain.handle("github:check-annotations", (_e, { cwd, checkRunId }) => {
  const id = Number(checkRunId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid check id" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/check-runs/${id}/annotations`] });
});
// 작업(job) 스텝 흐름(#812) — Actions job의 steps(Set up job…Complete job). job id=detailsUrl의 job id.
ipcMain.handle("github:job-steps", (_e, { cwd, jobId }) => {
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid job id" };
  return githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/actions/jobs/${id}`, "--jq", "{steps: .steps}"] });
});
// 이슈·PR 코멘트 작성(#820, 첫 write) — gh issue/pr comment. number 정수·body 비어있지 않음 검증.
ipcMain.handle("github:add-comment", (_e, { cwd, kind, number, body }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  if (typeof body !== "string" || !body.trim()) return { ok: false, kind: "error", detail: "empty body" };
  const sub = kind === "pr" ? "pr" : "issue";
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "comment", String(n), "--body", body] }); // no-shell, body는 인자(개행·특수문자 안전)
});
// 코멘트 수정/삭제(#820) — issue·PR 대화 코멘트는 공통 issues/comments 엔드포인트. commentId=url의 issuecomment id.
ipcMain.handle("github:edit-comment", (_e, { cwd, commentId, body }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  if (typeof body !== "string" || !body.trim()) return { ok: false, kind: "error", detail: "empty body" };
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${id}`, "-f", `body=${body}`] });
});
ipcMain.handle("github:delete-comment", (_e, { cwd, commentId }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${id}`] });
});
// 코멘트 리액션 토글(#820) — 이미 내가 단 리액션이면 삭제, 아니면 추가. content=REST명(+1,-1,laugh…).
const REACTION_CONTENT = new Set(["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"]);
// 캐시 안 함 — gh 계정 전환 시 옛 로그인으로 남의 리액션을 지우는 사고 방지(리뷰 🔴). 토글마다 조회(클릭 액션, 지연 무해).
async function viewerLogin(cwd) {
  const r = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "user", "--jq", "{login: .login}"] });
  return r.ok ? (r.data?.login || null) : null;
}
ipcMain.handle("github:react", async (_e, { cwd, commentId, content }) => {
  const id = Number(commentId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, kind: "error", detail: "invalid comment id" };
  if (!REACTION_CONTENT.has(content)) return { ok: false, kind: "error", detail: "invalid reaction" };
  const login = await viewerLogin(cwd);
  const list = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/issues/comments/${id}/reactions`] });
  const mine = list.ok && Array.isArray(list.data) ? list.data.find((r) => r.content === content && r.user?.login === login) : null;
  if (mine) return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${id}/reactions/${mine.id}`] });
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "POST", `repos/{owner}/{repo}/issues/comments/${id}/reactions`, "-f", `content=${content}`] });
});
// 이슈·PR 본문 리액션 토글(#822) — issues/{n}/reactions(PR도 공통). 코멘트 토글과 동일 로직.
ipcMain.handle("github:body-react", async (_e, { cwd, number, content }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  if (!REACTION_CONTENT.has(content)) return { ok: false, kind: "error", detail: "invalid reaction" };
  const login = await viewerLogin(cwd);
  const list = await githubBridge.ghJson({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", `repos/{owner}/{repo}/issues/${n}/reactions`] });
  const mine = list.ok && Array.isArray(list.data) ? list.data.find((r) => r.content === content && r.user?.login === login) : null;
  if (mine) return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/${n}/reactions/${mine.id}`] });
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/reactions`, "-f", `content=${content}`] });
});
// 이슈·PR 제목·본문 편집(#822) — gh issue/pr edit <n> --title/--body. 준 것만 반영.
ipcMain.handle("github:edit-item", (_e, { cwd, kind, number, title, body }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const sub = kind === "pr" ? "pr" : "issue";
  const args = [sub, "edit", String(n)];
  if (typeof title === "string" && title.trim()) args.push("--title", title);
  if (typeof body === "string" && body.trim()) args.push("--body", body);
  if (args.length === 3) return Promise.resolve({ ok: false, kind: "error", detail: "nothing to edit" });
  return githubBridge.ghRun({ gh: ghExe(), cwd, args });
});
// 이슈·PR 상태 전환(#822) — close/reopen, PR draft↔ready. 화이트리스트로 안전.
ipcMain.handle("github:set-state", (_e, { cwd, kind, number, action }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const sub = kind === "pr" ? "pr" : "issue";
  if (action === "close") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "close", String(n)] });
  if (action === "reopen") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: [sub, "reopen", String(n)] });
  if (sub === "pr" && action === "ready") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "ready", String(n)] });
  if (sub === "pr" && action === "draft") return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "ready", String(n), "--undo"] });
  return Promise.resolve({ ok: false, kind: "error", detail: "invalid action" });
});
// PR 머지(#822 추가) — method별 플래그 + 병합 후 브랜치 삭제. 되돌릴 수 없음(렌더러서 확인).
ipcMain.handle("github:merge", (_e, { cwd, number, method }) => {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, kind: "error", detail: "invalid number" };
  const flag = { merge: "--merge", squash: "--squash", rebase: "--rebase" }[method] || "--merge";
  return githubBridge.ghRun({ gh: ghExe(), cwd, env: ghEnv(), args: ["pr", "merge", String(n), flag, "--delete-branch"] });
});
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
const { parseAgentScreen, agentFromProcess, stripAnsi } = require("./agent-screen.cjs");
let appBase = null;              // Next 서버 베이스 URL(boot서 설정)
const cwdById = new Map();       // id → cwd(레포 매핑)
const procById = new Map();      // id → foreground 프로세스명(데몬 list) — 에이전트 종료(셸 복귀) 게이트
const lastScreen = new Map();    // id → { state, agent, at }(변화·keep-alive 판단)
const screenTimers = new Map();  // id → 디바운스 타이머
const mapScreenState = (s) => (s === "idle" ? "done" : s); // 파서 idle → 스토어 done(present/ready)
// 포그라운드가 셸이면 에이전트 종료로 간주(버퍼에 옛 화면이 남아도 무시). herdr도 포그라운드 프로세스로 게이트.
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "pwsh", "powershell", "cmd", "login", "screen", "tmux"]);
const isShellProc = (p) => SHELLS.has(String(p || "").trim().toLowerCase().replace(/^-+/, ""));

// #864 orca식 신원 확정 — 우리가 탭에서 직접 실행한 에이전트를 기록(tabId→agent). 스크레이프 추측 대신
// 이 기록이 신원의 진실(오판 원천 소멸). 셸 복귀(종료) 시 해제. 유저가 손으로 실행하면 기록 없음 → 스크레이프 fallback.
const launchRegistry = new Map(); // id → agent id
// 에이전트 id → 실행 셸 커맨드. runtime 경로 설정 있으면 그걸, 없으면 기본 커맨드명.
const AGENT_DEFAULT_CMD = { claude: "claude", codex: "codex", gemini: "gemini", antigravity: "agy", opencode: "opencode", aider: "aider", cursor: "cursor-agent", copilot: "copilot", amp: "amp", grok: "grok", hermes: "hermes", omp: "omp" };
function agentCommand(agent) {
  const rp = loadSavedRuntimePaths();
  if (agent === "claude") return rp.claudeCode || "claude";
  if (agent === "codex") return rp.codex || "codex";
  if (agent === "opencode") return rp.opencode || "opencode";
  return AGENT_DEFAULT_CMD[agent] || null;
}
// launchRegistry 디스크 영속(#864) — pty는 앱 재시작에도 생존(#682)하는데 registry는 메모리라 재시작 시 날아가
// 살아남은 세션이 스크레이프 fallback으로 오판된다(codex→claude). {id:agent}를 파일에 저장하고 부팅 시 복원.
const registryFile = () => join(app.getPath("userData"), "agent-registry.json");
function saveRegistry() {
  try { const out = {}; for (const [id, reg] of launchRegistry) out[id] = reg.agent; writeFileSync(registryFile(), JSON.stringify(out)); }
  catch { /* 영속 실패 무시 */ }
}
function loadRegistry() {
  try {
    const o = JSON.parse(readFileSync(registryFile(), "utf8"));
    for (const [id, agent] of Object.entries(o)) if (typeof agent === "string" && agent) launchRegistry.set(id, { agent, confirmed: true, at: Date.now() }); // 재시작 전 실행 중이었으니 confirmed
  } catch { /* 파일 없음 등 무시 */ }
}

// 실행 기록 신원 해석 + confirm/clear 관리. reg={agent,confirmed,at}.
// 핵심: 실행 직후엔 foreground가 아직 셸(에이전트 부팅 전)이라, 그때 셸이라고 registry를 지우면 codex가
// 막 떠서 스크레이프 fallback→claude로 오판됨. 그래서 "에이전트가 실제 foreground 점유(non-shell)"를
// 본 뒤에만 confirmed=true, 확정 후 셸 복귀만 종료로 간주(삭제). 미확정+셸=부팅 중이라 신원 유지.
function registryAgent(id, proc) {
  const reg = launchRegistry.get(id);
  if (!reg) return null;
  const shell = proc !== undefined && isShellProc(proc);
  if (!shell) { reg.confirmed = true; return reg.agent; }        // 에이전트 실행 중(확정)
  if (reg.confirmed) { launchRegistry.delete(id); return null; } // 확정 후 셸 = 종료
  if (Date.now() - reg.at > 20000) { launchRegistry.delete(id); return null; } // 20s 내 안 뜨면 포기(오실행)
  return reg.agent;                                              // 부팅 중(미확정 셸) — 신원 유지
}
// 커맨드 basename → agent id. 유저가 셸에 직접 친 실행 커맨드도 잡아 신원 확정(피커 안 써도 정확).
// gemini 제외 — 구글 에이전트는 antigravity(agy)로 통일(#864). agy 커맨드가 antigravity로 매핑.
const CMD_TO_AGENT = { claude: "claude", codex: "codex", agy: "antigravity", antigravity: "antigravity", opencode: "opencode", grok: "grok", omp: "omp", aider: "aider", amp: "amp", copilot: "copilot", hermes: "hermes", "cursor-agent": "cursor", cursor: "cursor" };
const inputBuf = new Map(); // id → 현재 타이핑 중인 라인(개행 전까지 누적)
// pty 입력 스트림을 감시해 "에이전트 실행 커맨드 + Enter"를 감지 → launchRegistry 갱신. 수동 실행도 신원 확정(#864).
// (셸 복귀 시 registry는 이미 해제되므로, 이전 stale 신원이 남아도 새 커맨드가 덮어씀 → codex→claude 오판 소멸.)
function detectLaunchFromInput(id, data) {
  let s = inputBuf.get(id) || "";
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    if (ch === "\r" || ch === "\n") {
      const line = s.trim(); s = "";
      const tok = line.split(/\s+/).filter((tk) => !/^\w+=/.test(tk))[0] || ""; // FOO=bar 같은 env 할당 스킵
      const base = tok.split("/").pop().toLowerCase();
      const agent = CMD_TO_AGENT[base];
      if (agent) launchRegistry.set(id, { agent, confirmed: false, at: Date.now() });
    } else if (code === 0x7f || code === 0x08) { s = s.slice(0, -1); } // backspace
    else if (code === 0x03 || code === 0x15) { s = ""; }               // Ctrl-C / Ctrl-U → 라인 취소
    else if (code >= 0x20) { s += ch; }
  }
  inputBuf.set(id, s.slice(-500)); // 상한(장문 붙여넣기 대비)
}

async function postStatus(body) {
  if (!appBase) return;
  try { await fetch(`${appBase}/api/agent/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { /* 서버 미준비 등 — 다음 틱에 재시도 */ }
}

// #870 터미널 활동 실시간 내레이션 — 에이전트 세션의 버퍼 델타(새 활동)를 관찰해 observe로 보내면
// SNA가 "지금 뭘 하는지 + 개념/용어"를 학습 스트림에 뿜는다. 레포별(cwd 귀속) + 스로틀 + 유의미 델타만.
const narrOffset = new Map(); // id → 마지막 관찰한 버퍼 길이
const lastNarr = new Map();   // id → 마지막 내레이션 시각
const narrInFlight = new Set(); // 관찰 요청 진행 중인 id(느린 analyze 중복 호출 방지)
const NARR_INTERVAL = 18000;  // 세션당 최소 간격(비용·스팸 방지)
const NARR_MIN_DELTA = 120;   // 이만큼 새 내용 쌓여야 내레이션(잡음 스킵)
async function observeActivity(id) {
  const cwd = cwdById.get(id);
  if (!cwd || !appBase) return;
  const agent = registryAgent(id, procById.get(id)); // 신원 있는(에이전트 실행 중) 세션만 — 셸/미실행 제외
  if (!agent) { narrOffset.delete(id); return; }
  const buf = liveBuffers.get(id) || "";
  if (narrOffset.get(id) === undefined) { narrOffset.set(id, buf.length); return; } // 최초엔 기준만(과거 백로그 폭탄 방지)
  const now = Date.now();
  if (narrInFlight.has(id)) return;                                                 // 이전 관찰 진행 중 — 중복 호출 방지
  if (now - (lastNarr.get(id) || 0) < NARR_INTERVAL) return;                        // 스로틀
  const off = narrOffset.get(id);
  if (buf.length <= off) return;                                                    // 새 내용 없음
  const delta = stripAnsi(buf.slice(off)).replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean).join("\n").trim();
  narrOffset.set(id, buf.length);
  if (delta.length < NARR_MIN_DELTA || !/[a-zA-Z가-힣]/.test(delta)) return;         // 유의미 델타만(글자 없는 순수 기호·스피너 프레임 스킵)
  lastNarr.set(id, now);
  narrInFlight.add(id);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000); // analyze 행 방지 — 초과 시 중단(다음 델타서 재시도)
  try {
    await fetch(`${appBase}/api/repo/learn/observe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, agent, delta: delta.slice(-5000) }), signal: ctrl.signal });
  } catch { /* 서버 미준비·타임아웃 등 — 다음 델타서 재시도 */ }
  finally { clearTimeout(to); narrInFlight.delete(id); }
}
async function pushScreenState(id, screen) {
  const cwd = cwdById.get(id);
  if (!cwd || !appBase) return;
  const proc = procById.get(id);
  const ra = registryAgent(id, proc);                           // #864 실행 기록 신원(부팅 중 셸 유지, 확정 후 종료 해제)
  const shell = proc !== undefined && isShellProc(proc);
  // 활성=liveBuffers(full/fresh), 비활성=데몬 screen 힌트(#840). liveBuffers는 안 건드림(영속 안전).
  const parsed = shell ? null : parseAgentScreen(liveBuffers.get(id) ?? screen); // {agent,state}|null
  const procAgent = shell ? null : agentFromProcess(proc);      // 프로세스명으로 "존재" 판정(버퍼 미판정 대비)
  let agent, state;
  if (ra) { agent = ra; agentSticky.set(id, ra); state = parsed ? mapScreenState(parsed.state) : "done"; } // #864 신원=실행기록(sticky도 동기화 — agentForId와 일관), 상태만 스크레이프
  else if (parsed) { agent = parsed.agent; state = mapScreenState(parsed.state); agentSticky.set(id, agent); } // 버퍼가 상태 잡음(working/waiting/유휴→done)
  else if (procAgent) { agent = procAgent; state = "done"; agentSticky.set(id, agent); }    // 프로세스는 에이전트인데 버퍼 미판정 → 존재
  // 배너 스크롤아웃 등으로 버퍼 미판정이어도, 셸이 아니고 이미 신원이 있으면 유지(#805) — 탭(agentForId)과 동일 sticky.
  // hermes처럼 프로세스명이 python(래퍼 exec)이라 폴백도 안 되는 에이전트가 카드서 사라지던 문제.
  else if (!shell && agentSticky.has(id)) { agent = agentSticky.get(id); state = "done"; }
  else {
    // 에이전트 없음(종료/셸/미인식) — 이전에 보고했으면 스토어에서 제거해 카드서 사라지게.
    agentSticky.delete(id);
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
// 중앙 검출(#840) — 데몬 전 세션(비활성 포함)을 순회해 스크레이핑. 렌더러 마운트/클릭 무관하게 탭바·호버카드·도트 반영.
// 매 틱 list 한 번(기존 refreshProcs가 하던 것) → procById·cwdById 보강 + screen을 pushScreenState 힌트로.
setInterval(async () => {
  let ss;
  try { ss = await termClient.list(); } catch { return; } // 데몬 미응답 — 다음 틱
  procById.clear();
  for (const s of ss) {
    procById.set(s.id, s.process);
    if (s.cwd && !cwdById.has(s.id)) cwdById.set(s.id, s.cwd); // 비활성(ensure 안 됨) 세션 레포 매핑 보강 — 상태 POST용
  }
  for (const s of ss) void pushScreenState(s.id, s.screen); // liveBuffers.keys()가 아니라 전 세션
  for (const s of ss) void observeActivity(s.id);            // #870 활동 델타 → 실시간 내레이션(내부 스로틀)
}, 1200);

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
    cwdById.delete(id); lastScreen.delete(id); agentSticky.delete(id); launchRegistry.delete(id); inputBuf.delete(id); ensuredIds.delete(id); narrOffset.delete(id); lastNarr.delete(id); narrInFlight.delete(id); // #765·#803·#864·#870 정리
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
setInterval(saveRegistry, 3000);   // #864 실행 기록 영속(재시작 생존 세션 신원 복원용)

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
  ensuredIds.add(id); // #864 pty 준비 완료 — launchAgent가 새 탭에 커맨드 주입 전 이걸 대기
  return { ok: true, buffer };
});
ipcMain.on("terminal:input", (_e, { id, data }) => { termClient.input({ id, data }); try { detectLaunchFromInput(id, data); } catch { /* 감지 실패가 입력 막지 않게 */ } });
// #864 에이전트 직접 실행 — 신원을 실행 기록에 확정하고 pty 셸에 실행 커맨드 주입. 반환 후 탭 아이콘/이름=이 에이전트.
// 새 탭은 렌더러가 Terminal 마운트→ensure까지 시간차가 있어, pty 준비(ensuredIds)를 최대 3s 대기 후 주입.
const ensuredIds = new Set(); // ensure 완료된 세션 id
ipcMain.handle("terminal:launchAgent", async (_e, { id, agent }) => {
  if (!id || typeof agent !== "string") return { ok: false, reason: "bad args" };
  const cmd = agentCommand(agent);
  if (!cmd) return { ok: false, reason: "unknown agent" };
  launchRegistry.set(id, { agent, confirmed: false, at: Date.now() }); // 즉시 신원(아이콘). 부팅 중 셸이어도 유지.
  let ready = false;
  for (let i = 0; i < 60; i++) { if (ensuredIds.has(id)) { ready = true; break; } await new Promise((r) => setTimeout(r, 50)); } // 최대 3s pty 대기
  if (!ready) { launchRegistry.delete(id); return { ok: false, reason: "pty not ready" }; } // 준비 실패 → 신원 취소(오아이콘 방지)
  try { termClient.input({ id, data: cmd + "\r" }); }
  catch (e) { launchRegistry.delete(id); return { ok: false, reason: String((e && e.message) || e) }; }
  return { ok: true };
});
ipcMain.on("terminal:resize", (_e, { id, cols, rows }) => termClient.resize({ id, cols, rows }));
ipcMain.on("terminal:kill", (_e, { id }) => { termClient.kill({ id }); liveBuffers.delete(id); delete savedBuffers[id]; cwdById.delete(id); lastScreen.delete(id); agentSticky.delete(id); launchRegistry.delete(id); inputBuf.delete(id); ensuredIds.delete(id); narrOffset.delete(id); lastNarr.delete(id); narrInFlight.delete(id); }); // 탭 닫기 시 데몬 pty·저장분·상태·실행기록 정리
// 세션의 실행 중 에이전트 id | null(#803) — 터미널 탭 자동 이름·아이콘용.
// 프로세스명만으론 node 래퍼 CLI(codex 등: 네이티브 자식을 spawn해 foreground pgrp 리더가 "node")를 못 잡아,
// 버퍼 스크레이핑(parseAgentScreen)을 1순위로. 셸이면 종료로 간주(null). 버퍼 미판정이면 프로세스명 폴백.
// 세션 신원 고정(#803) — 한번 에이전트로 잡히면 셸 복귀(종료)까지 그 신원 유지.
// codex는 작업 중 배너가 스크롤아웃되면 버퍼 판정이 흔들려(claude 공유 스피너로 오판정) 탭이 깜빡일 수 있어,
// 최초 판정을 셸 복귀까지 붙들어 안정화. 셸이면 해제해 다음 에이전트를 새로 잡음.
// 탭(agentForId)과 카드(pushScreenState) 두 표면이 공유(#805) — 신원이 표면마다 갈리지 않게.
const agentSticky = new Map(); // id → agent id
// screen(#840): 데몬 list가 실어 준 buffer tail을 "파싱 힌트"로 받음. 활성 세션은 liveBuffers(full/fresh) 우선,
// 비활성(ensure 안 됨)은 screen 힌트로 검출. liveBuffers는 절대 안 건드림 — 16KB tail로 덮으면 스크롤백 영속(#680) 손실.
// 신원 판정은 pushScreenState(카드)와 동일 우선순위(#841): 현재 화면 파싱 > 프로세스명 > sticky(폴백).
// 예전엔 sticky를 파싱보다 먼저 return해서, 이전 세션(예: claude) 신원이 고정되면 새 에이전트(codex)를 켜도
// 탭이 claude로 남았다(카드는 파싱 우선이라 codex로 바뀌어 표면 불일치). 현재 파싱을 우선해 신선한 배너가 stale sticky를 덮게.
function agentForId(id, proc, screen) {
  const ra = registryAgent(id, proc);                          // #864 실행 기록 신원(부팅 중 셸도 유지, 확정 후 종료 시 해제)
  if (ra) { agentSticky.set(id, ra); return ra; }
  if (proc !== undefined && isShellProc(proc)) { agentSticky.delete(id); return null; }
  const parsed = parseAgentScreen(liveBuffers.get(id) ?? screen);
  if (parsed && parsed.agent) { agentSticky.set(id, parsed.agent); return parsed.agent; } // 현재 화면이 잡은 에이전트 우선
  const procAgent = agentFromProcess(proc);
  if (procAgent) { agentSticky.set(id, procAgent); return procAgent; }
  if (agentSticky.has(id)) return agentSticky.get(id); // 배너 스크롤아웃 등 transient null → 마지막 신원 유지
  return null;
}
ipcMain.handle("terminal:list", async () => {
  const ss = await termClient.list(); // 세션 목록(#764) — 레포탭 호버 카드 + 탭 이름(#803)
  // 비활성 탭도 검출: 데몬 screen(buffer tail)을 힌트로 agentForId에 전달(#836/#840). screen은 검출용, 렌더러 미전송(누출 방지).
  return ss.map(({ screen, ...s }) => ({ ...s, agent: agentForId(s.id, s.process, screen) }));
});

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
