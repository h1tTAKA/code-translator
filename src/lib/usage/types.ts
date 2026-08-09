// Claude·Codex 구독 사용 한도 조회 결과(#735) — main의 provider-usage.cjs가 반환하는 형태.
export type UsageWindow = {
  usedPercent: number; // 0-100
  windowMinutes: number; // 300(5h) | 10080(7d)
  resetsAt: number | null; // unix ms
  resetLabel: string | null; // "2:30 PM" | "Thu 2:30 PM"
};

export type ProviderUsage = {
  provider: "claude" | "codex";
  status: "ok" | "unavailable" | "error"; // unavailable=크레덴셜 없음(로그인 안 함), error=네트워크/서버
  session?: UsageWindow | null;
  weekly?: UsageWindow | null;
  fableWeekly?: UsageWindow | null; // Claude 전용
};

export type ProviderUsageResult = { claude: ProviderUsage; codex: ProviderUsage };
