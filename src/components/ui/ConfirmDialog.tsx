"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconHelpCircle } from "@tabler/icons-react";
import { useT } from "@/lib/i18n/I18nProvider";

export interface ConfirmOptions {
  title?: string;
  message: string;
  // 메시지 아래 작은 회색 보조 설명(선택) — 안심 문구 등.
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  // true면 확인 버튼을 위험(빨강)으로 — 삭제 등 되돌릴 수 없는 동작.
  danger?: boolean;
  // 톤 — "danger"=로즈(삭제), "warn"=앰버(주의, 데이터 안 지워짐), 없으면 인디고(기본). danger 우선 하위호환.
  tone?: "danger" | "warn";
  // 선택 체크박스 — 토글 시 onChange로 값 전달(호출부가 클로저 변수에 보관).
  checkbox?: { label: string; defaultChecked?: boolean; onChange?: (checked: boolean) => void };
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

// 네이티브 window.confirm 대신 앱 자체 모달. `const confirm = useConfirm()` 후
// `if (await confirm({ message, danger }))` 형태로 사용.
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // 이전 confirm이 아직 열려 있으면 취소로 정리(promise 누수 방지).
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmModal
          options={options}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [checked, setChecked] = useState(options.checkbox?.defaultChecked ?? false);
  // 톤 — 명시 tone 우선, 없으면 danger(하위호환)→"danger", 그 외 "default".
  const tone: "danger" | "warn" | "default" = options.tone ?? (options.danger ? "danger" : "default");
  // Esc=취소, Enter=확인.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/50" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative z-[81] w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-[#14151c] dark:ring-white/5"
      >
        {/* 본문 — 좌측 아이콘 칩(danger=로즈 경고 / warn=앰버 경고 / 일반=인디고 물음) + 제목·메시지. */}
        <div className="flex gap-3.5 px-5 pt-5 pb-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            tone === "danger" ? "bg-rose-500/10 text-rose-500 dark:bg-rose-500/15 dark:text-rose-400"
            : tone === "warn" ? "bg-amber-500/10 text-amber-500 dark:bg-amber-500/15 dark:text-amber-400"
            : "bg-[#3B34E2]/10 text-[#3B34E2] dark:bg-[#8b86f5]/15 dark:text-[#a5a0f8]"}`}>
            {tone === "default" ? <IconHelpCircle size={20} stroke={2} aria-hidden /> : <IconAlertTriangle size={20} stroke={2} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            {options.title && (
              <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{options.title}</h2>
            )}
            <p className={`whitespace-pre-line text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300 ${options.title ? "mt-1" : ""}`}>
              {options.message}
            </p>
            {options.detail && (
              <p className="mt-1.5 whitespace-pre-line text-[11.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                {options.detail}
              </p>
            )}
            {options.checkbox && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-zinc-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => { setChecked(e.target.checked); options.checkbox?.onChange?.(e.target.checked); }}
                  className="h-4 w-4 accent-[#3B34E2]"
                />
                {options.checkbox.label}
              </label>
            )}
          </div>
        </div>
        {/* 푸터 — 구분선·옅은 배경으로 액션 영역 분리. */}
        <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-white/5 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            {options.cancelText ?? t("confirm.cancel")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold shadow-sm transition ${
              tone === "danger" ? "bg-rose-600 text-white hover:bg-rose-700"
              : "bg-[#3B34E2] text-white hover:bg-[#322bc9] dark:bg-[#8b86f5] dark:text-zinc-900 dark:hover:bg-[#a5a0f8]"
            }`}
          >
            {options.confirmText ?? t("confirm.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
