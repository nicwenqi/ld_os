"use client";

import { useEffect } from "react";

const defaultMessage = "当前页面有未保存的更改，确定离开吗？";

export function useUnsavedChangesGuard(
  dirty: boolean,
  message = defaultMessage,
) {
  useEffect(() => {
    if (!dirty) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
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

      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor
        || anchor.target && anchor.target !== "_self"
        || anchor.hasAttribute("download")
      ) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      if (
        destination.pathname === current.pathname
        && destination.search === current.search
      ) return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardInternalNavigation, true);
    };
  }, [dirty, message]);
}
