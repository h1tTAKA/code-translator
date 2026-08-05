"use client";
// 워크스페이스 파일트리(#647) — scan이 준 flat 경로 목록을 중첩 트리로. 폴더 접기 + 파일 클릭.
import { useMemo, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { fileGlyph, folderGlyph } from "@/lib/repo/fileIcon";

interface TreeNode { name: string; path: string; children?: TreeNode[] } // children 있으면 폴더

function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = cur.children!.find((c) => c.name === part && !!c.children !== isFile);
      if (!child) { child = isFile ? { name: part, path } : { name: part, path, children: [] }; cur.children!.push(child); }
      cur = child;
    });
  }
  const sortNode = (n: TreeNode) => {
    if (!n.children) return;
    n.children.sort((a, b) => (b.children ? 1 : 0) - (a.children ? 1 : 0) || a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children!;
}

function Node({ node, depth, open, toggle, selected, onSelect }: {
  node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; onSelect: (p: string) => void;
}) {
  const pad = { paddingLeft: `${depth * 12 + 6}px` };
  if (node.children) {
    const isOpen = open.has(node.path);
    return (
      <>
        <button type="button" onClick={() => toggle(node.path)} style={pad}
          className="flex w-full items-center gap-1 py-0.5 pr-1.5 text-left text-[12px] text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <IconChevronRight size={12} stroke={2} className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
          {folderGlyph(node.name, isOpen)}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children.map((c) => <Node key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />)}
      </>
    );
  }
  const on = selected === node.path;
  return (
    <button type="button" onClick={() => onSelect(node.path)} style={pad}
      className={`flex w-full items-center gap-1 py-0.5 pr-1.5 text-left text-[12px] transition ${on ? "bg-[#3B34E2]/10 text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#8b86f5]" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
      <span className="ml-[13px] flex shrink-0">{fileGlyph(node.name)}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default function FileTree({ files, selected, onSelect }: { files: string[]; selected: string | null; onSelect: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  // 최상위 폴더는 펼친 채 시작(바로 탐색 가능), 하위는 접힘.
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.filter((n) => n.children).map((n) => n.path)));
  const toggle = (p: string) => setOpen((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return (
    <div className="nunopi-scroll h-full overflow-auto py-1">
      {tree.map((n) => <Node key={n.path} node={n} depth={0} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />)}
    </div>
  );
}
