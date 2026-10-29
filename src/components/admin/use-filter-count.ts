"use client";

import { useCallback, useEffect, useRef, useState, type RefObject, type FormEvent } from "react";

const fields = ["classes", "providers", "sets", "setMode", "evidence", "minUsd", "maxUsd", "includeUnpriced", "length", "avail"];
type Result = { count: number; error?: string };

/** At most one count in flight and one latest desired filter snapshot. Metadata never recounts. */
export function useFilterCount(form: RefObject<HTMLFormElement | null>, initial: number, action: (input: Record<string, unknown>) => Promise<Result>, batch = false) {
  const [count, setCount] = useState(initial), [pending, setPending] = useState(false), [countError, setError] = useState<string>();
  const revision = useRef(0), active = useRef(false), mounted = useRef(false);
  const latest = useRef<{ input: Record<string, unknown>; key: string; revision: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), lastKey = useRef("");
  const drain = useCallback(async () => {
    if (active.current || !latest.current || !mounted.current) return;
    active.current = true;
    while (latest.current && mounted.current) {
      const request = latest.current;
      latest.current = null;
      try {
        const result = await action(request.input);
        if (mounted.current && request.revision === revision.current) { setCount(result.count); setError(result.error); }
      } catch {
        if (mounted.current && request.revision === revision.current) setError("دریافت تعداد نام‌ها انجام نشد. یکی از فیلترها را تغییر دهید تا دوباره تلاش شود.");
      }
    }
    active.current = false;
    if (mounted.current && !timer.current) setPending(false);
  }, [action]);
  const refresh = useCallback((event?: FormEvent<HTMLFormElement>) => {
    const allowed = batch ? [...fields, "cap", "excludeUsed"] : fields;
    if (event && !allowed.includes((event.target as HTMLInputElement).name)) return;
    revision.current++;
    clearTimeout(timer.current);
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (!form.current || !mounted.current) return;
      const data = new FormData(form.current), input: Record<string, unknown> = {};
      for (const k of allowed) input[k] = ["classes", "providers", "sets"].includes(k) ? data.getAll(k).map(String).sort() : data.get(k);
      input.includeUnpriced = data.has("includeUnpriced") ? "1" : "0";
      const key = JSON.stringify(input);
      if (key === lastKey.current && !active.current) { setPending(false); return; }
      lastKey.current = key;
      latest.current = { input, key, revision: revision.current };
      void drain();
    }, 250);
  }, [batch, form, drain]);
  useEffect(() => {
    mounted.current = true;
    const initialTimer = batch ? setTimeout(() => refresh(), 0) : undefined;
    return () => { mounted.current = false; clearTimeout(initialTimer); clearTimeout(timer.current); };
  }, [batch, refresh]);
  return { count, pending, countError, refresh };
}
