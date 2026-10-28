"use client";

import { LengthPicker, type LengthOption } from "@/components/admin/length-picker";
import { AssigneePicker, type PickerUser } from "@/components/admin/assignee-picker";
import { AvailPicker, availCounts } from "@/components/admin/avail-picker";
import { ACTIVE_SETS } from "@/lib/sets";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { buttonClass, fieldBase } from "@/components/ui";
import { countBlockAction, createBatchAction } from "@/lib/actions/batches";
import { planBatch } from "@/lib/batch-plan";
import { t } from "@/lib/copy/fa";

type Facet = { value: string | null; count: number };

export function BatchForm({ classes, providers, setLabels, poolTotal, users, lengths, initialLength }: { classes: Facet[]; providers: Facet[]; setLabels: Record<number, string>; poolTotal: number; users: PickerUser[]; lengths: LengthOption[]; initialLength: number | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [block, setBlock] = useState(poolTotal);
  const [counting, startCount] = useTransition();
  const [rounds, setRounds] = useState(5);
  const [perRound, setPerRound] = useState(500);
  const [remainderMode, setRemainderMode] = useState<"extra" | "last" | "drop">("drop");
  const [order, setOrder] = useState("random");
  const [seed] = useState(() => String(Date.now() % 1_000_000));
  const [length, setLength] = useState(initialLength);
  const [avail, setAvail] = useState<"any" | "sale" | "free">("any");
  const byAvail = lengths.map((l) => ({ ...l, count: availCounts([l], l.length)[avail] }));

  const recount = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    startCount(async () => {
      const result = await countBlockAction({
        classes: data.getAll("classes").map(String),
        providers: data.getAll("providers").map(String),
        sets: data.getAll("sets").map(String),
        setMode: data.get("setMode"),
        evidence: data.get("evidence"),
        minUsd: data.get("minUsd"),
        maxUsd: data.get("maxUsd"),
        includeUnpriced: data.get("includeUnpriced") ? "1" : "0",
        cap: data.get("cap"),
        excludeUsed: data.get("excludeUsed"),
        length: data.get("length"),
        avail: data.get("avail"),
      });
      setBlock(result.count);
    });
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRecount = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(recount, 250);
  };
  useEffect(() => {
    recount();
  }, []);

  const plan = useMemo(() => planBatch({ total: block, rounds, perRound, remainderMode }), [block, rounds, perRound, remainderMode]);
  const field = `${fieldBase} h-9 w-full`;
  const chip = "flex items-center gap-1.5 rounded-lg border border-line px-2 py-1";

  return (
    <form ref={formRef} action={createBatchAction} onChange={scheduleRecount} className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <fieldset className="rounded-xl border border-line p-3 text-sm">
          <legend className="px-1 font-semibold">{t.batch.blockLegend}</legend>
          <div className="mt-2"><AvailPicker counts={availCounts(lengths, length)} value={avail} onChange={setAvail} /></div>
          <div className="mt-3"><LengthPicker options={byAvail} initial={initialLength} onPick={setLength} /></div>
          <div className="mt-3 font-medium">{t.batch.sets}</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {ACTIVE_SETS.map((n) => (
              <label key={n} className={chip}><input type="checkbox" name="sets" value={n} /><span>{setLabels[n]}</span></label>
            ))}
            <select name="setMode" defaultValue="any" className={`${fieldBase} h-9 w-28`} aria-label={t.batch.setMode}>
              <option value="any">{t.batch.setAny}</option>
              <option value="all">{t.batch.setAll}</option>
            </select>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">{t.batch.nsAndProvider(classes.length + providers.length)}</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {classes.map((c) => (
                <label key={`c-${c.value}`} className={chip}><input type="checkbox" name="classes" value={c.value ?? "__none__"} /><span dir="ltr">{c.value ?? "none"}</span><span className="text-xs text-muted">{c.count}</span></label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {providers.map((c) => (
                <label key={`p-${c.value}`} className={chip}><input type="checkbox" name="providers" value={c.value ?? "__none__"} /><span dir="ltr">{c.value ?? "none"}</span><span className="text-xs text-muted">{c.count}</span></label>
              ))}
            </div>
          </details>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select name="evidence" defaultValue="any" className={field} aria-label={t.batch.evidence}>
              <option value="any">{t.batch.anyEvidence}</option>
              <option value="sale_page">{t.batch.salePage}</option>
              <option value="nameserver">NS</option>
            </select>
            <input name="minUsd" inputMode="decimal" placeholder={t.batch.minUsd} dir="ltr" className={field} />
            <input name="maxUsd" inputMode="decimal" placeholder={t.batch.maxUsd} dir="ltr" className={field} />
            <label className="flex items-center gap-2"><input type="checkbox" name="includeUnpriced" value="1" defaultChecked />{t.batch.includeUnpriced}</label>
            <input name="cap" inputMode="numeric" placeholder={t.batch.cap} dir="ltr" className={`${field} col-span-2`} />
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="excludeUsed" value="1" defaultChecked />{t.batch.excludeUsed}</label>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-line p-3 text-sm">
          <legend className="px-1 font-semibold">{t.batch.order}</legend>
          <div className="flex flex-wrap gap-2">
            {[
              ["random", t.batch.orders.random],
              ["name", t.batch.orders.name],
              ["price_asc", t.batch.orders.price_asc],
              ["price_desc", t.batch.orders.price_desc],
              ["provider", t.batch.orders.provider],
              ["set", t.batch.orders.set],
            ].map(([value, label]) => (
              <label key={value} className={chip}>
                <input type="radio" name="order" value={value} checked={order === value} onChange={() => setOrder(value)} />
                {label}
              </label>
            ))}
          </div>
          {order === "random" ? (
            <label className="mt-2 flex items-center gap-2">
              <span className="text-muted">{t.batch.seed}</span>
              <input name="seed" defaultValue={seed} dir="ltr" className={`${fieldBase} h-9 w-32`} />
              <span className="text-xs text-muted">{t.batch.seedHint}</span>
            </label>
          ) : null}
        </fieldset>
      </div>

      <aside className="space-y-3 rounded-xl border border-line bg-card p-3 text-sm lg:sticky lg:top-4 lg:self-start">
        <h2 className="font-semibold">{t.batch.calculator}</h2>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">{t.batch.namesInBlock}</span>
          <span className="text-2xl font-semibold tabular-nums">{counting ? "…" : block.toLocaleString("en")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs text-muted">{t.batch.roundCount}</span>
            <input name="rounds" type="number" min={1} value={rounds} onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))} className={field} dir="ltr" />
          </label>
          <label className="block"><span className="text-xs text-muted">{t.batch.perRound}</span>
            <input name="perRound" type="number" min={1} value={perRound} onChange={(e) => setPerRound(Math.max(1, Number(e.target.value) || 1))} className={field} dir="ltr" />
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setPerRound(Math.max(1, Math.ceil(block / rounds)))}>{t.batch.splitEven(rounds)}</button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setRounds(Math.max(1, Math.ceil(block / perRound)))}>{t.batch.enoughRounds}</button>
        </div>
        <label className="block"><span className="text-xs text-muted">{t.batch.leftover}</span>
          <select name="remainderMode" value={remainderMode} onChange={(e) => setRemainderMode(e.target.value as typeof remainderMode)} className={field}>
            <option value="extra">{t.batch.leftoverExtra}</option>
            <option value="last">{t.batch.leftoverLast}</option>
            <option value="drop">{t.batch.leftoverDrop}</option>
          </select>
        </label>
        <dl className="space-y-1 rounded-lg border border-line bg-paper p-2 tabular-nums">
          <div className="flex justify-between"><dt>{t.batch.planRounds}</dt><dd>{plan.sizes.length}</dd></div>
          <div className="flex justify-between"><dt>{t.batch.planPlaced}</dt><dd>{plan.placed.toLocaleString("en")}</dd></div>
          <div className="flex justify-between"><dt>{rounds} × {perRound}</dt><dd>{(rounds * perRound).toLocaleString("en")}</dd></div>
          <div className="flex justify-between"><dt>{t.batch.planLeftover}</dt><dd>{plan.remainder.toLocaleString("en")}{remainderMode === "drop" && plan.remainder ? t.batch.droppedMark : ""}</dd></div>
          {plan.sizes.length ? <div className="flex justify-between text-xs text-muted"><dt>{t.batch.lastSize}</dt><dd>{plan.sizes[plan.sizes.length - 1]}</dd></div> : null}
        </dl>
        <input name="title" required maxLength={70} placeholder={t.batch.titlePlaceholder} className={field} />
        <AssigneePicker users={users} compact />
        <div className="grid gap-2">
          <button name="createMode" value="all" disabled={!block} className={buttonClass("primary")}>{t.batch.createAll(plan.sizes.length)}</button>
          <button name="createMode" value="first" disabled={!block} className={buttonClass("secondary")}>{t.batch.createFirst}</button>
        </div>
        <p className="text-xs text-muted">{t.batch.savedNote}</p>
      </aside>
    </form>
  );
}
