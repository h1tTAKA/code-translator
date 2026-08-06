// 터미널 데몬 소켓 클라이언트(#682) — electron 메인이 데몬에 연결·인증·RPC + data/exit 수신.
// 데몬이 죽어있으면 spawn 콜백으로 띄운 뒤 재연결(재시도). 연결 끊기면 자동 재접속.
const net = require("node:net");
const fs = require("node:fs");
const { fork } = require("node:child_process");
const crypto = require("node:crypto");

// opts: { sock, metaFile, daemonScript, spawnEnvExtra, onData(id,data), onExit(id), onStatus(connected) }
function createDaemonClient(opts) {
  const { sock, metaFile, daemonScript, onData, onExit } = opts;
  let socket = null;
  let ready = false;
  let buf = "";
  let token = "";
  let spawning = false;
  const ensured = new Map(); // id → {resolve} 대기 중 ensure

  // 기존 데몬 메타(토큰) 로드 or 새 토큰 생성.
  function loadOrMakeToken() {
    try { const m = JSON.parse(fs.readFileSync(metaFile, "utf8")); if (m && m.token) return m.token; } catch { /* ignore */ }
    const tk = crypto.randomBytes(24).toString("hex");
    try { fs.writeFileSync(metaFile, JSON.stringify({ token: tk, sock })); } catch { /* ignore */ }
    return tk;
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.t === "ready") { ready = true; return; }
    if (m.t === "ensured") { const w = ensured.get(m.id); if (w) { ensured.delete(m.id); w({ ok: m.ok, buffer: m.buffer, reason: m.reason }); } return; }
    if (m.t === "data") { onData && onData(m.id, m.data); return; }
    if (m.t === "exit") { onExit && onExit(m.id); return; }
  }

  function connect() {
    return new Promise((resolve) => {
      const s = net.connect(sock);
      let done = false;
      s.on("connect", () => { s.write(JSON.stringify({ t: "attach", token }) + "\n"); });
      s.on("data", (chunk) => {
        buf += chunk.toString(); let nl;
        while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(line); if (!done && ready) { done = true; socket = s; resolve(true); } }
      });
      s.on("error", () => { if (!done) { done = true; resolve(false); } });
      s.on("close", () => { if (socket === s) { socket = null; ready = false; } });
    });
  }

  function spawnDaemon() {
    if (spawning) return;
    spawning = true;
    try { fs.unlinkSync(sock); } catch { /* stale */ }
    const child = fork(daemonScript, [], {
      detached: true, // electron과 분리 — 앱 종료에도 생존
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, ...(opts.spawnEnvExtra || {}), NUNOPI_TERM_SOCK: sock, NUNOPI_TERM_TOKEN: token },
    });
    child.on("message", () => {}); // ready 신호는 소켓 연결로 확인
    child.unref();
    try { child.disconnect(); } catch { /* ignore */ } // IPC 분리 — 완전 detach
    spawning = false;
  }

  // 연결 확보 — 있으면 재사용, 없으면 데몬 스폰 후 재시도.
  // single-flight: 동시 ensure가 몰려도 connect/spawn은 한 번만(중복 데몬 spawn·소켓 unlink 경쟁 방지).
  let connecting = null;
  function ensureConnected() {
    if (socket && ready) return Promise.resolve(true);
    if (connecting) return connecting;
    connecting = (async () => {
      token = token || loadOrMakeToken();
      if (await connect()) return true;
      spawnDaemon();
      for (let i = 0; i < 40; i++) { // 최대 ~4s 재시도(데몬 리슨 대기)
        await new Promise((r) => setTimeout(r, 100));
        if (await connect()) return true;
      }
      return false;
    })().finally(() => { connecting = null; });
    return connecting;
  }

  return {
    async ensure({ id, cwd, cols, rows }) {
      if (!(await ensureConnected())) return { ok: false, reason: "daemon unavailable" };
      return await new Promise((resolve) => {
        ensured.set(id, resolve);
        socket.write(JSON.stringify({ t: "ensure", id, cwd, cols, rows }) + "\n");
        setTimeout(() => { if (ensured.has(id)) { ensured.delete(id); resolve({ ok: false, reason: "ensure timeout" }); } }, 5000);
      });
    },
    input({ id, data }) { if (socket && ready) { try { socket.write(JSON.stringify({ t: "input", id, data }) + "\n"); } catch { /* ignore */ } } },
    resize({ id, cols, rows }) { if (socket && ready) { try { socket.write(JSON.stringify({ t: "resize", id, cols, rows }) + "\n"); } catch { /* ignore */ } } },
    kill({ id }) { if (socket && ready) { try { socket.write(JSON.stringify({ t: "kill", id }) + "\n"); } catch { /* ignore */ } } },
  };
}

module.exports = { createDaemonClient };
