"use client";

import { useEffect, useRef, useState } from "react";
import { IconFolderOpen, IconMessages, IconFileCode, IconFileText, IconChevronRight } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

// "+" 드롭다운 픽커(#769) — 워크스페이스에 새 탭으로 무엇을 열지 고른다(Orca式 컴팩트 메뉴).
// "+" 버튼 아래에 앵커링(fixed). 레포는 폴더 다이얼로그, 모드는 즉시 빈 탭. 실제 추가는 onPick.
// 섹션 라벨 + 키보드 네비(↑↓/Enter) + 활성 chevron으로 다듬음.
export type AddKind = "repo" | "ask" | "code" | "text";

type Row = { kind: AddKind; Icon: typeof IconFolderOpen; labelKey: string; group: "ws" | "modes" };
const ROWS: Row[] = [
  { kind: "repo", Icon: IconFolderOpen, labelKey: "workspace.addRepo", group: "ws" },
  { kind: "ask", Icon: IconMessages, labelKey: "mode.ask", group: "modes" },
  { kind: "code", Icon: IconFileCode, labelKey: "mode.code", group: "modes" },
  { kind: "text", Icon: IconFileText, labelKey: "mode.text", group: "modes" },
];

export default function WorkspaceAddMenu({ anchor, onClose, onPick }: {
  anchor: { left: number; top: number } | null;
  onClose: () => void;
  onPick: (kind: AddKind) => void;
}) {
  const t = useT();
  const [activeIdx, setActiveIdx] = useState(0);
  const open = anchor !== null;
  // 최신 onPick 참조 — Enter 핸들러(effect 안 onKey)가 옛 onPick을 잡지 않게(stale closure 방지).
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  const choose = (i: number) => { onPickRef.current(ROWS[i].kind); onClose(); };

  useEffect(() => {
    if (!open) return;
    setActiveIdx(0); // eslint-disable-line react-hooks/set-state-in-effect -- 열릴 때 첫 항목으로 리셋
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % ROWS.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + ROWS.length) % ROWS.length); }
      else if (e.key === "Enter") { e.preventDefault(); setActiveIdx((i) => { choose(i); return i; }); }
    };
    // 팝오버 바깥 클릭/스크롤/리사이즈 → 닫기. 다음 틱부터 걸어 여는 클릭이 즉시 닫는 것 방지.
    const onDown = () => onClose();
    window.addEventListener("keydown", onKey);
    const id = setTimeout(() => { window.addEventListener("mousedown", onDown); window.addEventListener("resize", onClose); }, 0);
    return () => { clearTimeout(id); window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); window.removeEventListener("resize", onClose); };
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!anchor) return null;

  const label = (g: "ws" | "modes") => (
    <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
      {t(g === "ws" ? "workspace.addGroupWorkspace" : "workspace.addGroupModes")}
    </div>
  );

  return (
    <div role="menu" aria-label={t("workspace.addTitle")} onMouseDown={(e) => e.stopPropagation()}
      style={{ left: anchor.left, top: anchor.top }}
      className="fixed z-50 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5">
      {ROWS.map((row, i) => {
        const on = i === activeIdx;
        const first = i === 0 || ROWS[i - 1].group !== row.group;
        return (
          <div key={row.kind}>
            {first && label(row.group)}
            <button type="button" role="menuitem"
              onMouseMove={() => setActiveIdx(i)} onClick={() => choose(i)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${on ? "bg-zinc-100 text-zinc-900 dark:bg-white/[0.08] dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-200"}`}>
              <row.Icon size={16} stroke={1.75} className={`shrink-0 ${on ? "text-[#3B34E2] dark:text-[#a5a0f8]" : "text-zinc-400 dark:text-zinc-500"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{t(row.labelKey)}</span>
              <IconChevronRight size={14} stroke={2} aria-hidden
                className={`shrink-0 transition ${on ? "translate-x-0 text-zinc-400 opacity-100 dark:text-zinc-400" : "-translate-x-1 text-transparent opacity-0"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
