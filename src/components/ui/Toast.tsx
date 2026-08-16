"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";

type ToastVariant = "success" | "error";
// 선택 액션 버튼(#787) — 예: "열린 곳으로 이동". 누르면 onClick 실행 후 토스트 닫힘.
type ToastAction = { label: string; onClick: () => void };
type ToastFn = (message: string, variant?: ToastVariant, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn>(() => {});

// 짧게 뜨는 안내 토스트. `const toast = useToast()` 후 `toast("메시지")` / `toast("메시지", "error")` /
// `toast("메시지", "error", { label: "이동", onClick })`.
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

interface ToastItem { id: number; message: string; variant: ToastVariant; action?: ToastAction; }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const toast = useCallback<ToastFn>((message, variant = "success", action) => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => [...prev, { id, message, variant, action }]);
    // 액션 있는 토스트는 유저가 누를 시간을 더 준다(4.5초), 없으면 2.8초 후 자동 제거.
    setTimeout(() => remove(id), action ? 4500 : 2800);
  }, [remove]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {items.length > 0 && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2">
          {items.map((t) => (
            <ToastCard key={t.id} message={t.message} variant={t.variant} action={t.action} onDismiss={() => remove(t.id)} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ message, variant, action, onDismiss }: { message: string; variant: ToastVariant; action?: ToastAction; onDismiss: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-700 shadow-lg transition-all duration-200 dark:border-zinc-700 dark:bg-[#1b1c24] dark:text-zinc-200 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {variant === "error" ? (
        <IconCircleX size={17} stroke={2} className="shrink-0 text-red-500" aria-hidden />
      ) : (
        <IconCircleCheck size={17} stroke={2} className="shrink-0 text-[#3B34E2] dark:text-[#8b86f5]" aria-hidden />
      )}
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => { action.onClick(); onDismiss(); }}
          className="ml-1 shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-[#3B34E2] transition hover:bg-[#3B34E2]/10 dark:text-[#8b86f5] dark:hover:bg-[#8b86f5]/15"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
