"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check } from "lucide-react";

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  kind: "ok" | "err" | "info";
  action?: { label: string; run: () => void };
}

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="pointer-events-auto flex w-full items-center gap-3 rounded-xl border border-white/12 bg-panel-2/95 px-4 py-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur"
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                t.kind === "err"
                  ? "bg-rose/15 text-rose"
                  : t.kind === "ok"
                    ? "bg-volt/15 text-volt"
                    : "bg-white/10 text-white/70"
              }`}
            >
              {t.kind === "err" ? <AlertTriangle size={14} /> : <Check size={14} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{t.title}</p>
              {t.detail && (
                <p className="truncate font-mono text-[10px] text-white/45">{t.detail}</p>
              )}
            </div>
            {t.action && (
              <button
                onClick={t.action.run}
                className="shrink-0 rounded-full border border-volt/40 px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.12em] text-volt uppercase transition-colors hover:bg-volt hover:text-void"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
