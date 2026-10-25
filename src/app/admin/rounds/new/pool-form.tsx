"use client";

import { AssigneePicker, type PickerUser } from "@/components/admin/assignee-picker";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, buttonClass, fieldClass } from "@/components/ui";
import { countPoolAction, createPoolRoundAction } from "@/lib/actions/pool";
import { t } from "@/lib/copy/fa";

type Facet = { value: string | null; count: number };
const NONE = "__none__";

function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    classes: data.getAll("classes").map(String),
    providers: data.getAll("providers").map(String),
    sets: data.getAll("sets").map(String),
    setMode: data.get("setMode"),
    evidence: data.get("evidence"),
    minUsd: data.get("minUsd"),
    maxUsd: data.get("maxUsd"),
    includeUnpriced: data.get("includeUnpriced") ? "1" : "0",
  };
}

function Checks({ name, facets, label }: { name: string; facets: Facet[]; label: string }) {
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <div className="grid max-h-52 gap-1 overflow-auto text-sm">
        {facets.map((f) => (
          <label key={f.value ?? NONE} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <input type="checkbox" name={name} value={f.value ?? NONE} />
              <span dir="ltr" className="font-mono">{f.value ?? "(none)"}</span>
            </span>
            <span className="tabular-nums text-muted">{f.count.toLocaleString("fa-IR")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PoolRoundForm({
  classes,
  providers,
  setCounts,
  total,
  error,
  users,
}: {
  classes: Facet[];
  providers: Facet[];
  setCounts: Array<{ n: number; label: string; count: number }>;
  total: number;
  error?: string;
  users: PickerUser[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState<number>(total);
  const [countError, setCountError] = useState<string>();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function refresh() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!form.current) return;
      const input = readForm(form.current);
      start(async () => {
        const result = await countPoolAction(input);
        setCount(result.count);
        setCountError(result.error);
      });
    }, 250);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  if (total === 0) {
    return (
      <div className="mt-8">
        <Alert>{t.newRound.poolEmpty}</Alert>
      </div>
    );
  }

  return (
    <form ref={form} action={createPoolRoundAction} onChange={refresh} className="mt-8 grid gap-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <label className="grid gap-1.5 text-sm font-semibold">
        {t.newRound.roundTitle}
        <input name="title" required maxLength={80} className={fieldClass} placeholder={t.newRound.poolPlaceholder} />
      </label>
      <AssigneePicker users={users} />
      <div className="grid gap-4 md:grid-cols-2">
        <Checks name="classes" facets={classes} label={t.pool.facetClass} />
        <Checks name="providers" facets={providers} label={t.pool.facetProvider} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">{t.pool.sets}</legend>
          <div className="grid gap-1 text-sm">
            {setCounts.map((s) => (
              <label key={s.n} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <input type="checkbox" name="sets" value={s.n} />
                  {s.label}
                </span>
                <span className="tabular-nums text-muted">{s.count.toLocaleString("fa-IR")}</span>
              </label>
            ))}
            <label className="mt-2 flex items-center gap-2">
              {t.newRound.mode}
              <select name="setMode" className="h-8 rounded-md border border-line bg-paper px-2">
                <option value="any">{t.newRound.modeAny}</option>
                <option value="all">{t.common.all}</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="grid gap-3 rounded-xl border border-line p-3 text-sm">
          <legend className="px-1 font-semibold">{t.newRound.evidencePrice}</legend>
          <label className="flex items-center gap-2">
            {t.newRound.evidence}
            <select name="evidence" className="h-8 rounded-md border border-line bg-paper px-2">
              <option value="any">{t.common.all}</option>
              <option value="sale_page">{t.common.salePage}</option>
              <option value="nameserver">{t.common.nameserver}</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {t.newRound.usdFrom}
            <input name="minUsd" inputMode="decimal" dir="ltr" className="h-8 w-24 rounded-md border border-line bg-paper px-2" />
            {t.newRound.usdTo}
            <input name="maxUsd" inputMode="decimal" dir="ltr" className="h-8 w-24 rounded-md border border-line bg-paper px-2" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeUnpriced" value="1" defaultChecked />
            {t.newRound.includeUnpriced}
          </label>
          <label className="flex items-center gap-2">
            {t.newRound.order}
            <select name="order" className="h-8 rounded-md border border-line bg-paper px-2">
              <option value="provider">{t.newRound.orderProvider}</option>
              <option value="name">{t.newRound.orderName}</option>
              <option value="random">{t.newRound.orderRandom}</option>
              <option value="price_asc">{t.newRound.orderCheap}</option>
              <option value="price_desc">{t.newRound.orderExpensive}</option>
            </select>
          </label>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-4">
        <p className="text-sm" aria-live="polite">
          {countError ? (
            <span className="text-danger">{countError}</span>
          ) : (
            <>
              <span className="font-display text-2xl tabular-nums">{count.toLocaleString("fa-IR")}</span> {t.newRound.countMid}{" "}
              {total.toLocaleString("fa-IR")} {t.newRound.countEnd}{pending ? " …" : ""}
            </>
          )}
        </p>
        <button className={buttonClass()} disabled={!!countError || count === 0}>
          {t.newRound.openVoting}
        </button>
      </div>
      <p className="text-xs text-muted">{t.newRound.privacyNote}</p>
    </form>
  );
}
