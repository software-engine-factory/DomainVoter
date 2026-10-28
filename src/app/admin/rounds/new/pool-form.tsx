"use client";

import { LengthPicker, type LengthOption } from "@/components/admin/length-picker";
import { AssigneePicker, type PickerUser } from "@/components/admin/assignee-picker";
import { AvailPicker, availCounts } from "@/components/admin/avail-picker";
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
    length: data.get("length"),
    avail: data.get("avail"),
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
  lengths,
  initialLength,
}: {
  lengths: LengthOption[];
  initialLength: number | null;
  classes: Facet[];
  providers: Facet[];
  setCounts: Array<{ n: number; label: string; count: number }>;
  total: number;
  error?: string;
  users: PickerUser[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState<number>(() => lengths.find((l) => l.length === initialLength)?.count ?? total);
  const [countError, setCountError] = useState<string>();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState("random");
  const [seed, setSeed] = useState(() => String(Date.now() % 1_000_000));
  const [length, setLength] = useState(initialLength);
  const [avail, setAvail] = useState<"any" | "sale" | "free">("any");
  const byAvail = lengths.map((l) => ({ ...l, count: availCounts([l], l.length)[avail] }));

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

  const steps = t.w4.steps;
  const last = steps.length - 1;
  const show = (i: number) => (step === i ? "grid gap-4" : "hidden");
  const chip = "flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft";

  return (
    <form
      ref={form}
      action={createPoolRoundAction}
      onChange={refresh}
      onKeyDown={(e) => {
        if (e.key === "Enter" && step < last && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          setStep(step + 1);
        }
      }}
      className="mt-6 grid gap-5"
      data-testid="round-wizard"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ol className="grid grid-cols-3 gap-2" aria-label={t.w4.stepOf(step + 1, steps.length)}>
        {steps.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={`press grid w-full gap-1 text-start text-sm ${step === i ? "font-semibold text-ink" : "text-muted"}`}
            >
              <span className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} aria-hidden />
              <span>
                {(i + 1).toLocaleString("fa-IR")}. {label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <section className={show(0)} data-step="0">
        <AvailPicker counts={availCounts(lengths, length)} value={avail} onChange={setAvail} />
        <LengthPicker options={byAvail} initial={initialLength} onPick={setLength} />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">{t.pool.sets}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {setCounts.map((s) => (
              <label key={s.n} className={chip} title={`set_${s.n}`}>
                <span className="flex items-center gap-2">
                  <input type="checkbox" name="sets" value={s.n} />
                  {s.label}
                </span>
                <span className="text-xs tabular-nums text-muted">{s.count.toLocaleString("fa-IR")}</span>
              </label>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-2 text-sm">
            {t.newRound.mode}
            <select name="setMode" className="h-9 rounded-md border border-line bg-paper px-2">
              <option value="any">{t.newRound.modeAny}</option>
              <option value="all">{t.common.all}</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="grid gap-3 text-sm">
          <legend className="mb-2 font-semibold">{t.newRound.evidencePrice}</legend>
          <select name="evidence" aria-label={t.newRound.evidence} className="h-11 rounded-lg border border-line bg-paper px-3">
            <option value="any">{t.newRound.evidence}: {t.common.all}</option>
            <option value="sale_page">{t.common.salePage}</option>
            <option value="nameserver">{t.common.nameserver}</option>
          </select>
          <div className="flex items-center gap-2">
            <input name="minUsd" inputMode="decimal" dir="ltr" placeholder="$ min" aria-label={t.newRound.usdFrom} className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3" />
            <span className="text-muted">–</span>
            <input name="maxUsd" inputMode="decimal" dir="ltr" placeholder="$ max" aria-label={t.newRound.usdTo} className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeUnpriced" value="1" defaultChecked />
            {t.newRound.includeUnpriced}
          </label>
        </fieldset>
        <details className="group rounded-xl border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold">
            {t.w4.more}
            <span aria-hidden className="text-muted transition group-open:rotate-180">▾</span>
          </summary>
          <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
            <Checks name="classes" facets={classes} label={t.pool.facetClass} />
            <Checks name="providers" facets={providers} label={t.pool.facetProvider} />
          </div>
        </details>
      </section>

      <section className={show(1)} data-step="1">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">{t.newRound.order}</legend>
          {(
            [
              ["random", t.newRound.orderRandom],
              ["provider", t.newRound.orderProvider],
              ["name", t.newRound.orderName],
              ["price_asc", t.newRound.orderCheap],
              ["price_desc", t.newRound.orderExpensive],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={chip}>
              <span className="flex items-center gap-2">
                <input type="radio" name="order" value={value} checked={order === value} onChange={() => setOrder(value)} />
                {label}
              </span>
            </label>
          ))}
        </fieldset>
        {order === "random" ? (
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              {t.w4.seed}
              <input name="seed" value={seed} onChange={(e) => setSeed(e.target.value)} dir="ltr" className="h-10 w-32 rounded-lg border border-line bg-paper px-3 tabular-nums" />
            </label>
            <button type="button" onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000)))} className={buttonClass("ghost", "sm")}>
              {t.w4.reshuffle}
            </button>
          </div>
        ) : null}
      </section>

      <section className={show(2)} data-step="2">
        <label className="grid gap-1.5 text-sm font-semibold">
          {t.newRound.roundTitle}
          <input name="title" required maxLength={80} className={fieldClass} placeholder={t.newRound.poolPlaceholder} />
        </label>
        <AssigneePicker users={users} />
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:p-4">
        <p className="text-sm" aria-live="polite" title={`${count.toLocaleString("fa-IR")} / ${total.toLocaleString("fa-IR")}`}>
          {countError ? (
            <span className="text-danger">{countError}</span>
          ) : (
            <span className="font-display text-2xl tabular-nums" data-testid="wizard-count">
              {count.toLocaleString("fa-IR")}
              {pending ? "…" : ""}
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className={buttonClass("secondary")}>
              {t.w4.back}
            </button>
          ) : null}
          {step < last ? (
            <button type="button" onClick={() => setStep(step + 1)} className={buttonClass()} disabled={!!countError || count === 0}>
              {t.w4.forward}
            </button>
          ) : (
            <button className={buttonClass()} disabled={!!countError || count === 0}>
              {t.newRound.openVoting}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
