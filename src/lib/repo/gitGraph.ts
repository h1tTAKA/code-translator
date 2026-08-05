// 깃 커밋 그래프 레인 모델(#649) — 순수 로직. git log 파싱 결과를 DAG 레인(세로줄)으로 배정.
// UI(GitGraph.tsx)는 이 결과로 점·선을 그린다. self-check로 직선·분기·머지·결정성 고정.

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  ts: number;      // author time (unix seconds)
  refs: string[];  // 브랜치/태그 라벨(정리됨)
  subject: string;
}

// git log --pretty=format:'%H|%P|%an|%at|%D|%s' 출력 → 커밋 배열(최신순).
export function parseGitLog(text: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [hash, parents, author, at, decor, ...subj] = line.split("|");
    if (!hash) continue;
    out.push({
      hash,
      parents: (parents ?? "").split(" ").filter(Boolean),
      author: author ?? "",
      ts: Number(at) || 0,
      refs: parseRefs(decor ?? ""),
      subject: subj.join("|"), // subject에 '|'가 있어도 보존
    });
  }
  return out;
}

// "%D" (예: "HEAD -> main, origin/main, tag: v1") → ["main", "origin/main", "v1"].
function parseRefs(decor: string): string[] {
  return decor.split(",").map((s) => s.trim()).filter(Boolean)
    .map((r) => r.replace(/^HEAD -> /, "").replace(/^tag: /, ""))
    .filter((r) => r && r !== "HEAD");
}

export interface GraphRow {
  commit: GitCommit;
  lane: number;                // 점(dot) 레인
  before: (string | null)[];   // 이 행 진입 시 활성 레인(위 경계) — 각 원소=그 레인이 기다리는 해시
  after: (string | null)[];    // 이 행 이탈 시 활성 레인(아래 경계)
}
export interface GitGraphModel { rows: GraphRow[]; laneCount: number; }

// 커밋 배열(최신순) → 레인 배정. 활성 레인에 "다음에 올 커밋 해시"를 담아 내려가며 배치.
export function assignLanes(commits: GitCommit[]): GitGraphModel {
  const lanes: (string | null)[] = []; // 각 레인이 기다리는 커밋 해시
  const rows: GraphRow[] = [];
  const firstNull = () => { const i = lanes.indexOf(null); return i === -1 ? lanes.length : i; };

  for (const c of commits) {
    const before = [...lanes];
    // 점 레인 = 이 커밋을 기다리는 첫 레인. 없으면(브랜치 tip) 빈 레인.
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) { lane = firstNull(); lanes[lane] = c.hash; }
    // 이 커밋을 기다리던 다른 레인들(머지 수렴)은 비운다 — 점 레인 하나로 모임.
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i] === c.hash) lanes[i] = null;

    // 부모 라우팅: 첫 부모는 점 레인 계속(이미 다른 레인에 있으면 점 레인 비움), 나머지는 새 레인(분기).
    const [p0, ...rest] = c.parents;
    if (p0 !== undefined) {
      if (lanes.indexOf(p0) === -1) lanes[lane] = p0; // 점 레인이 첫 부모를 이어감
      else lanes[lane] = null;                        // 첫 부모가 이미 다른 레인 → 점 레인 종료
    } else {
      lanes[lane] = null; // 루트 커밋(부모 없음) → 레인 종료
    }
    for (const p of rest) {
      if (lanes.indexOf(p) === -1) { const e = firstNull(); lanes[e] = p; }
    }
    // 꼬리 null 정리.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ commit: c, lane, before, after: [...lanes] });
  }
  const laneCount = Math.max(1, ...rows.map((r) => Math.max(r.before.length, r.after.length, r.lane + 1)));
  return { rows, laneCount };
}
