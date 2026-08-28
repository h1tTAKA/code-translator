"use client";
// 워크스페이스 터미널(#647) — xterm.js(WebGL) 프론트 + detached pty 데몬 세션(#682).
// pty는 앱과 분리된 데몬이 소유해 앱 종료에도 생존, 재마운트/재실행 시 scrollback 재생 + live reattach.
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useT } from "@/lib/i18n/I18nProvider";

// 재접속 스크롤백 재생 시 xterm이 버퍼 속 터미널 질의(DA/DSR/OSC 색 등)에 "다시" 응답해
// 입력창에 에코되는 문제(#807) 방지 — 질의는 화면 출력이 없어 재생 전 제거(라이브 스트림엔 미적용).
// xterm.write는 비동기 파싱이라, 재생 시점에 term.onData(→pty)가 연결된 뒤 질의가 파싱돼 응답이 pty로 새 나감.
function stripTermQueries(s: string): string {
  return s
    .replace(/\x1b\[[?>=]?[0-9;]*[cn]/g, "")             // Primary/Secondary/Tertiary DA(c) · DSR 커서/상태(n)
    .replace(/\x1b\](?:4;\d+|1[0-9]);\?(?:\x07|\x1b\\)/g, "")  // OSC 색/팔레트 질의만(]4;n;? · ]1x;?) — ]0;제목? 등은 보존
    .replace(/\x1b\[\?[0-9;]*\$p/g, "")                  // DECRQM 모드 질의
    .replace(/\x1b\[>[0-9;]*q/g, "");                    // XTVERSION
}

export default function Terminal({ id, cwd, onSubmitLine }: { id: string; cwd: string; onSubmitLine?: (line: string) => void }) {
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]); // 최신 t 유지 — locale 바뀌어도 터미널 remount 없이 exit 안내 언어 반영
  const hostRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef(onSubmitLine); // 최신 콜백(effect 재실행 없이)
  useEffect(() => { submitRef.current = onSubmitLine; }, [onSubmitLine]);
  const lineRef = useRef(""); // 현재 입력 줄 누적(Enter서 제출 = 프롬프트 후보)

  useEffect(() => {
    const nd = window.nunopiDesktop;
    const host = hostRef.current;
    if (!nd?.terminal || !host) return;
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let onPaste: ((ev: ClipboardEvent) => void | Promise<void>) | undefined;

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

      // Shift+Enter(#799) — CSI-u(kitty/fixterms)로 인코딩된 "Shift+Enter" 키 이벤트를 전송.
      // \x1b[13;2u = Enter(13) + Shift 수정자(2). 에이전트 CLI(Claude Code 등)가 이를 진짜 개행 키로
      // 파싱해 멀티라인·백스페이스 정상(생 \n/ESC+CR은 리터럴로 오처리돼 1줄만/백스페이스 깨짐). false로 CR 제출 차단.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
          e.preventDefault(); // 브라우저가 Enter를 textarea에 넣어 xterm이 CR을 또 보내는 것 차단(개행 후 CR 제출로 되돌아가던 원인)
          nd.terminal.input({ id, data: "\x1b[13;2u" });
          return false;
        }
        return true;
      });

      // Cmd+V 이미지 붙여넣기(#799) — 클립보드에 이미지가 있으면 임시 PNG로 저장 후 그 경로를 터미널에
      // 주입(에이전트 CLI가 파일 경로로 첨부 인식). 텍스트 붙여넣기는 가로채지 않고 xterm 기본 처리.
      // capture 단계 — xterm textarea 핸들러보다 먼저 이미지만 preventDefault.
      onPaste = async (ev: ClipboardEvent) => {
        const items = ev.clipboardData?.items;
        if (!items || !Array.from(items).some((it) => it.type.startsWith("image/"))) return; // 텍스트는 통과
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const r = await nd.saveClipboardImage?.();
          // bracketed paste(ESC[200~ … ESC[201~)로 경로를 "붙여넣기"로 전달 → Claude Code 등이 이미지
          // 파일 경로로 인식해 [Image #N]으로 표시(생 키입력이면 경로 텍스트 그대로 남음).
          if (r?.ok && r.path && term) nd.terminal.input({ id, data: `\x1b[200~${r.path}\x1b[201~` });
        } catch { /* ignore */ }
      };
      host.addEventListener("paste", onPaste, true);

      // host 폭이 확정된 뒤에만 fit/ensure(#832). open 직후·tab mount·독 분할 애니메이션 중엔 host 폭이 0~극소로
      // 측정돼 cols가 2~10으로 잡히고, 그 폭으로 재생된 scrollback 줄바꿈이 굳어 세로로 깨진다(#682). 단일 rAF는
      // 레이아웃 확정을 보장 못 함 → ResizeObserver가 "실제 폭"을 보고할 때 최초 ensure를 한 번 실행, 이후엔 live resize.
      const MIN_W = 40; // 이보다 좁으면(≈5 cols 미만) 아직 레이아웃 미확정으로 보고 대기
      let ensured = false;
      const firstEnsure = async () => {
        if (disposed || !term) return;
        try {
          const r = await nd.terminal.ensure({ id, cwd, cols: term.cols, rows: term.rows });
          if (disposed || !term) return;
          if (!r.ok) { term.write(`\r\n[터미널 시작 실패${r.reason ? `: ${r.reason}` : ""} — node-pty 재빌드가 필요할 수 있어요]\r\n`); return; }
          if (r.buffer) term.write(stripTermQueries(r.buffer)); // 정확한 cols 확보 후 재생(줄바꿈 안 굳음). 질의 시퀀스 제거(에코 방지 #807)
          offData = nd.terminal.onData(({ id: i, data }) => { if (i === id && term) term.write(data); });
          // 셸 종료 시 빈 화면 방치 대신 안내(+로 새 터미널).
          offExit = nd.terminal.onExit(({ id: i }) => { if (i === id && term) term.write(`\r\n\x1b[2m${tRef.current("workspace.terminalExited")}\x1b[0m\r\n`); });
          term.onData((d) => {
            nd.terminal.input({ id, data: d });
            // 첫 프롬프트 캡처(#861) — 유저가 친 줄을 Enter서 제출. 이스케이프(화살표·CSI-u·붙여넣기 마커)는 무시.
            if (d === "\r" || d === "\n") { const l = lineRef.current.trim(); lineRef.current = ""; if (l) submitRef.current?.(l); }
            else if (d === "\x7f" || d === "\b") lineRef.current = lineRef.current.slice(0, -1);
            else if (!d.startsWith("\x1b") && !d.includes("\x1b")) lineRef.current += d;
          });
        } catch {
          // 핸들러 미등록(옛 메인) 등 — 크래시 대신 안내.
          if (term && !disposed) term.write("\r\n[터미널 연결 실패 — electron:dev를 완전히 껐다 재시작해 주세요]\r\n");
        }
      };
      // 폭이 잡혔을 때만 fit → 최초 1회 ensure, 이후 resize. 폭 미확정이면 스킵(다음 콜백/폴백서 처리).
      const sync = () => {
        if (disposed || !term || host.clientWidth < MIN_W) return;
        try { fit.fit(); } catch { /* ignore */ }
        if (!ensured) { ensured = true; void firstEnsure(); }
        else { try { nd.terminal.resize({ id, cols: term.cols, rows: term.rows }); } catch { /* ignore */ } }
      };
      ro = new ResizeObserver(sync);
      ro.observe(host);
      requestAnimationFrame(sync); // 이미 폭이 잡혀 있으면 즉시 진행
      // 폭이 끝내 안 잡혀도(희귀) 터미널이 빈 채 방치되지 않게 폴백 — 최후엔 강제 ensure(데몬이 cols 하한 클램프).
      fallback = setTimeout(() => { if (!ensured && !disposed && term) { ensured = true; void firstEnsure(); } }, 1500);
    })();

    return () => { disposed = true; if (fallback) clearTimeout(fallback); if (onPaste) host.removeEventListener("paste", onPaste, true); offData?.(); offExit?.(); ro?.disconnect(); term?.dispose(); term = null; };
  }, [id, cwd]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden bg-white p-1.5 dark:bg-[#0b0c12]" />;
}
