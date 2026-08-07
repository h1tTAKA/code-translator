"use client";
// 접기/펴기 슬림 엣지 탭 — 앱 공통 디자인(#695 워크스페이스 챗 토글 표준, #697 통일).
// 모양·아이콘만 담당. 위치/테두리/rounded는 부모가 className·style로(문맥별: 플로팅 absolute vs divider 내장).
import type { CSSProperties } from "react";
import { IconChevronLeft, IconChevronRight, IconChevronUp, IconChevronDown } from "@tabler/icons-react";

type Dir = "left" | "right" | "up" | "down";
const OPP: Record<Dir, Dir> = { left: "right", right: "left", up: "down", down: "up" };
const ICON = { left: IconChevronLeft, right: IconChevronRight, up: IconChevronUp, down: IconChevronDown };

export default function PanelEdgeToggle({ collapsed, onToggle, collapsedDir, orientation = "vertical", title, className = "", style }: {
  collapsed: boolean;
  onToggle?: () => void;      // 없으면 장식 버튼(부모가 클릭 처리, 예: AppShell separator의 클릭 판정).
  collapsedDir: Dir;          // 접힘 상태에서 "펴기" 화살표 방향(= 패널이 들어올 방향). 펼침이면 반대.
  orientation?: "vertical" | "horizontal"; // vertical=세로 탭(좌우 화살표), horizontal=가로 탭(상하)
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const dir = collapsed ? collapsedDir : OPP[collapsedDir];
  const Icon = ICON[dir];
  const size = orientation === "vertical" ? "h-11 w-3.5 hover:w-4" : "h-3.5 w-11 hover:h-4";
  return (
    <button type="button" onClick={onToggle} title={title} aria-label={title} style={style}
      className={`z-30 flex items-center justify-center text-zinc-500 transition hover:text-[#3B34E2] dark:text-zinc-400 dark:hover:text-[#8b86f5] ${size} ${className}`}>
      <Icon size={13} stroke={2.5} aria-hidden />
    </button>
  );
}
