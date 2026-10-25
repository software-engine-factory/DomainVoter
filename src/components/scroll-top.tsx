"use client";

import { useEffect } from "react";

/** After a server-action redirect the old scroll offset is kept; land the new page at the top. */
export function ScrollTop() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
}
