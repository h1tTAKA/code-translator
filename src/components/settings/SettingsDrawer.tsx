import { useState } from "react";
import type { AgentProviderKind, AnalyzeMode, ProviderSettings } from "@/lib/agent";
import { PROVIDER_CATALOG } from "@/lib/agent/catalog";
import { XIcon } from "@/components/learning/icons";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { LOCALES, type Locale } from "@/lib/i18n/messages";

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ProviderSettings;
  onSave: (next: ProviderSettings) => void;
  excludedTerms?: string[];
  onRemoveExclusion?: (mode: AnalyzeMode, text: string) => void;
  theme: "light" | "dark";
  onThemeChange: (next: "light" | "dark") => void;
  // 카드보기 날아오는 애니메이션 on/off (#641).
  cardFlyAnimation: boolean;
  onCardFlyAnimationChange: (next: boolean) => void;
  // 암기모드 카드 기본 설명 생성에 쓸 provider(분석 provider와 별개).
  memorizeProviderId: AgentProviderKind;
  onMemorizeProviderChange: (id: AgentProviderKind) => void;
}

// 제외 그룹 1개(코드 토큰 / IT 용어) — 칩 + ✕ 해제.
function ExclusionGroup({
  label,
  items,
  onRemove,
}: {
  label: string;
  items: string[];
  onRemove: (text: string) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label} ({items.length})
      </span>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.excludeEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((text) => (
            <span
              key={text}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <code className="font-mono">{text}</code>
              <button
                type="button"
                onClick={() => onRemove(text)}
                className="text-zinc-400 transition hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                title="제외 해제"
                aria-label={`${text} 제외 해제`}
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsDrawer({
  isOpen,
  onClose,
  settings,
  onSave,
  excludedTerms = [],
  onRemoveExclusion,
  theme,
  onThemeChange,
  cardFlyAnimation,
  onCardFlyAnimationChange,
  memorizeProviderId,
  onMemorizeProviderChange,
}: SettingsDrawerProps) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(
    settings["openai-compatible"]?.baseUrl ?? "http://localhost:11434/v1",
  );
  const [model, setModel] = useState(
    settings["openai-compatible"]?.model ?? "hermes-3",
  );
  const [apiKey, setApiKey] = useState(
    settings["openai-compatible"]?.apiKey ?? "",
  );
  const [claudeCliPath, setClaudeCliPath] = useState(
    settings["claude-agent"]?.cliPath ?? "",
  );
  const [codexCliPath, setCodexCliPath] = useState(
    settings["codex-agent"]?.cliPath ?? "",
  );
  const [openCodeCliPath, setOpenCodeCliPath] = useState(
    settings["opencode-agent"]?.cliPath ?? "",
  );
  const desktop = typeof window !== "undefined" ? window.nunopiDesktop : undefined;

  if (!isOpen) return null;

  function handleSave() {
    onSave({
      "openai-compatible": {
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      },
      "claude-agent": {
        cliPath: claudeCliPath.trim() || undefined,
      },
      "codex-agent": {
        cliPath: codexCliPath.trim() || undefined,
      },
      "opencode-agent": {
        cliPath: openCodeCliPath.trim() || undefined,
      },
    });
    // 데스크톱: 런타임 서버(main 소유)가 재시작 시 읽는 userData에도 영속(재시작 후 적용).
    desktop?.setRuntimePaths({
      claudeCode: claudeCliPath.trim() || undefined,
      codex: codexCliPath.trim() || undefined,
      opencode: openCodeCliPath.trim() || undefined,
    }).catch((e) => console.warn("[settings] desktop runtime-paths save failed:", e));
    onClose();
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/30 dark:bg-black/50"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-sm flex-col bg-white shadow-xl dark:bg-[#111219]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t("settings.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label={t("settings.close")}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* 화면 카드 */}
          <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.screen")}
            </h3>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.theme")}</span>
              <div
                role="radiogroup"
                aria-label="테마"
                className="inline-flex w-full rounded-xl border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {([
                  { value: "dark", label: t("settings.dark") },
                  { value: "light", label: t("settings.light") },
                ] as const).map((opt) => {
                  const selected = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onThemeChange(opt.value)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        selected
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 카드보기 날아오는 애니메이션 on/off (#641) */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("settings.cardFlyAnimation")}</span>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.cardFlyAnimationDesc")}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={cardFlyAnimation}
                aria-label={t("settings.cardFlyAnimation")}
                onClick={() => onCardFlyAnimationChange(!cardFlyAnimation)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${cardFlyAnimation ? "bg-[#3B34E2] dark:bg-[#8b86f5]" : "bg-zinc-300 dark:bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${cardFlyAnimation ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
          </section>

          {/* 언어 카드 */}
          <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.language")}
            </h3>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label="언어 선택"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </section>

          {/* 프로바이더 카드 — OpenAI-Compatible / Claude / Codex 소제목+구분선으로 */}
          <section className="space-y-5 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.provider")}
            </h3>

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("provider.openai-compatible")}
            </h4>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("provider.localLlmHint")}</p>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Endpoint URL
              </span>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Ollama: http://localhost:11434/v1
              </p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.model")}
              </span>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="hermes-3"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                API Key{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Claude Agent
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={claudeCliPath}
                onChange={(e) => setClaudeCliPath(e.target.value)}
                placeholder="/usr/local/bin/claude"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Codex Agent
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={codexCliPath}
                onChange={(e) => setCodexCliPath(e.target.value)}
                placeholder="/usr/local/bin/codex"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800" />

            <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("provider.opencode-agent")}
            </h4>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.cliPath")}{" "}
                <span className="text-zinc-400 dark:text-zinc-500">{t("settings.optional")}</span>
              </span>
              <input
                type="text"
                value={openCodeCliPath}
                onChange={(e) => setOpenCodeCliPath(e.target.value)}
                placeholder="/opt/homebrew/bin/opencode"
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-mono text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {t("settings.cliHint")}
              </p>
            </label>
            </div>

            {/* 데스크톱 앱: 경로 변경은 런타임 서버 재기동이 필요 → 재시작 후 적용. */}
            {desktop && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t("settings.cliPathRestartHint")}
                </p>
                <button
                  type="button"
                  onClick={() => { void desktop.relaunch(); }}
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  {t("settings.relaunchNow")}
                </button>
              </div>
            )}
          </section>

          {/* 암기모드 카드 설명 provider — 프로바이더 설정 바로 밑 */}
          <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.memorizeProvider")}
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("settings.memorizeProviderHint")}</p>
            <select
              value={memorizeProviderId}
              onChange={(e) => onMemorizeProviderChange(e.target.value as AgentProviderKind)}
              aria-label={t("settings.memorizeProvider")}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
            >
              {PROVIDER_CATALOG.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`provider.${p.id}`)}
                </option>
              ))}
            </select>
          </section>

          {/* 제외 목록 카드 */}
          <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {t("settings.exclude")}
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {t("settings.excludeHint")}
            </p>
            <ExclusionGroup
              label={t("settings.excludeTerm")}
              items={excludedTerms}
              onRemove={(text) => onRemoveExclusion?.("text", text)}
            />
          </section>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {t("settings.storageNote")}
          </p>
        </div>

        <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleSave}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-50 transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {t("settings.save")}
          </button>
        </div>
      </div>
    </>
  );
}
