"use client";
// 워크스페이스 터미널(#647) — xterm.js(WebGL) 프론트 + electron 메인의 node-pty 세션.
// pty는 메인에 레포 경로별로 살아있어(A안), 언마운트해도 안 죽고 재마운트 시 scrollback 재생.
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export default function Terminal({ cwd }: { cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nd = window.nunopiDesktop;
    const host = hostRef.current;
    if (!nd?.terminal || !host) return;
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let offData: (() => void) | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }, webgl] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"), import("@xterm/addon-webgl"),
      ]);
      if (disposed) return;
      const dark = document.documentElement.classList.contains("dark");
      term = new XTerm({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        cursorBlink: true,
        theme: dark ? { background: "#0b0c12", foreground: "#e4e4e7" } : { background: "#ffffff", foreground: "#27272a" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      try { term.loadAddon(new webgl.WebglAddon()); } catch { /* WebGL 미지원 → 기본 렌더 폴백 */ }
      fit.fit();

      const r = await nd.terminal.ensure({ cwd, cols: term.cols, rows: term.rows });
      if (disposed || !term) return;
      if (!r.ok) { term.write(`\r\n[터미널 시작 실패${r.reason ? `: ${r.reason}` : ""} — node-pty 재빌드가 필요할 수 있어요]\r\n`); return; }
      if (r.buffer) term.write(r.buffer); // 재접속 시 이전 출력 재생

      offData = nd.terminal.onData(({ cwd: c, data }) => { if (c === cwd && term) term.write(data); });
      term.onData((d) => nd.terminal.input({ cwd, data: d }));
      ro = new ResizeObserver(() => {
        if (!term) return;
        try { fit.fit(); nd.terminal.resize({ cwd, cols: term.cols, rows: term.rows }); } catch { /* ignore */ }
      });
      ro.observe(host);
    })();

    return () => { disposed = true; offData?.(); ro?.disconnect(); term?.dispose(); term = null; };
  }, [cwd]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-white p-1.5 dark:bg-[#0b0c12]" />;
}
