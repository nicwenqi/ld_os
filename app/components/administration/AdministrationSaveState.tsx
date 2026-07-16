"use client";

import { useEffect } from "react";

export type AdministrationSavePhase =
  | "pristine"
  | "dirty"
  | "saving"
  | "saved"
  | "failed"
  | "conflict";

export function AdministrationSaveState({
  phase,
  savedAt,
  message,
  onRetry,
  onReload,
}: {
  phase: AdministrationSavePhase;
  savedAt?: string | null;
  message?: string | null;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  const label =
    phase === "saving"
      ? "保存中"
      : phase === "dirty"
        ? "有未保存更改"
        : phase === "saved"
          ? `已保存 · ${savedAt ?? currentTime()}`
          : phase === "failed"
            ? "保存失败，点击重试"
            : phase === "conflict"
              ? "保存冲突，请重新读取"
              : "未修改";

  return (
    <div className={`administration-save-state ${phase}`} role={phase === "failed" || phase === "conflict" ? "alert" : "status"}>
      <i aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {message && <small>{message}</small>}
      </div>
      {phase === "failed" && onRetry && (
        <button type="button" onClick={onRetry}>重试</button>
      )}
      {phase === "conflict" && onReload && (
        <button type="button" onClick={onReload}>读取最新资料</button>
      )}
    </div>
  );
}

export function useUnsavedChangesWarning(dirty: boolean, message = "当前页面有未保存更改") {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };
    const guardInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor
        || (anchor.target && anchor.target !== "_self")
        || anchor.hasAttribute("download")
      ) return;
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        destination.origin !== current.origin
        || (
          destination.pathname === current.pathname
          && destination.search === current.search
        )
      ) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardInternalNavigation, true);
    };
  }, [dirty, message]);
}

export function savedTime() {
  return currentTime();
}

function currentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
