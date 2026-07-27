import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 데스크톱(Electron) 패키징용 자족 서버 산출 — .next/standalone/server.js.
  output: "standalone",
  // 에이전트 런타임 SDK는 별도 node 프로세스를 fork로 띄운다(네이티브 better-sqlite3 포함).
  // 번들에 넣지 않고 런타임에 node_modules에서 require하도록 외부화.
  // tree-sitter(WASM 심볼 추출)는 런타임에 node_modules서 .wasm 로드 — 번들 시 grammar wasm 파싱 실패.
  serverExternalPackages: ["@sna-sdk/core", "@sna-sdk/client", "better-sqlite3", "web-tree-sitter", "tree-sitter-wasms"],
};

export default nextConfig;
