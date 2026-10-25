"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import { countBlockAction, createBatchAction } from "@/lib/actions/batches";
import { planBatch } from "@/lib/batch-plan";

type Facet = { value: string | null; count: number };

export function BatchForm({ classes, providers, setLabels, poolTotal }: { classes: Facet[]; providers: Facet[]; setLabels: Record<number, string>; poolTotal: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [block, setBlock] = useState(poolTotal);
  const [counting, startCount] = useTransition();
  const [rounds, setRounds] = useState(5);
  const [perRound, setPerRound] = useState(500);
  const [remainderMode, setRemainderMode] = useState<"extra" | "last" | "drop">("extra");
  const [order, setOrder] = useState("random");
  const [seed] = useState(() => String(Date.now() % 1_000_000));

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
  const field = `${fieldClass} h-9`;
  const chip = "flex items-center gap-1.5 rounded-lg border border-line px-2 py-1";

  return (
    <form ref={formRef} action={createBatchAction} onChange={scheduleRecount} className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <fieldset className="rounded-xl border border-line p-3 text-sm">
          <legend className="px-1 font-semibold">بلوک نام‌ها (همهٔ فیلترها اختیاری)</legend>
          <div className="text-xs text-muted">چیزی انتخاب نکنید تا همهٔ استخر حساب شود.</div>
          <div className="mt-3 font-medium">مجموعه‌ها</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={chip}><input type="checkbox" name="sets" value={n} /><span dir="ltr">{n} · {setLabels[n]}</span></label>
            ))}
            <select name="setMode" defaultValue="any" className={`${field} w-28`} aria-label="ترکیب مجموعه‌ها">
              <option value="any">هر کدام</option>
              <option value="all">همه با هم</option>
            </select>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">کلاس NS و پارکینگ ({classes.length + providers.length})</summary>
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
            <select name="evidence" defaultValue="any" className={field} aria-label="شاهد">
              <option value="any">هر شاهد</option>
              <option value="sale_page">صفحهٔ فروش</option>
              <option value="nameserver">NS</option>
            </select>
            <input name="minUsd" inputMode="decimal" placeholder="حداقل $" dir="ltr" className={field} />
            <input name="maxUsd" inputMode="decimal" placeholder="حداکثر $" dir="ltr" className={field} />
            <label className="flex items-center gap-2"><input type="checkbox" name="includeUnpriced" value="1" defaultChecked />بی‌قیمت هم</label>
            <input name="cap" inputMode="numeric" placeholder="سقف بلوک (اختیاری)" dir="ltr" className={`${field} col-span-2`} />
            <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="excludeUsed" value="1" defaultChecked />نام‌هایی که در دورهای قبلی بوده‌اند نیایند</label>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-line p-3 text-sm">
          <legend className="px-1 font-semibold">ترتیب</legend>
          <div className="flex flex-wrap gap-2">
            {[
              ["random", "تصادفی"],
              ["name", "نام"],
              ["price_asc", "قیمت ↑"],
              ["price_desc", "قیمت ↓"],
              ["provider", "پارکینگ"],
              ["set", "مجموعه"],
            ].map(([value, label]) => (
              <label key={value} className={chip}>
                <input type="radio" name="order" value={value} checked={order === value} onChange={() => setOrder(value)} />
                {label}
              </label>
            ))}
          </div>
          {order === "random" ? (
            <label className="mt-2 flex items-center gap-2">
              <span className="text-muted">بذر</span>
              <input name="seed" defaultValue={seed} dir="ltr" className={`${field} w-32`} />
              <span className="text-xs text-muted">با همین بذر همین ترتیب تکرار می‌شود.</span>
            </label>
          ) : null}
        </fieldset>
      </div>

      <aside className="space-y-3 rounded-xl border border-line bg-card p-3 text-sm lg:sticky lg:top-4 lg:self-start">
        <h2 className="font-semibold">ماشین‌حساب</h2>
        <div className="flex items-baseline justify-between">
          <span className="text-muted">نام در بلوک</span>
          <span className="text-2xl font-semibold tabular-nums">{counting ? "…" : block.toLocaleString("en")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs text-muted">شمار دورها</span>
            <input name="rounds" type="number" min={1} value={rounds} onChange={(e) => setRounds(Math.max(1, Number(e.target.value) || 1))} className={field} dir="ltr" />
          </label>
          <label className="block"><span className="text-xs text-muted">نام در هر دور</span>
            <input name="perRound" type="number" min={1} value={perRound} onChange={(e) => setPerRound(Math.max(1, Number(e.target.value) || 1))} className={field} dir="ltr" />
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setPerRound(Math.max(1, Math.ceil(block / rounds)))}>تقسیم مساوی بر {rounds}</button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setRounds(Math.max(1, Math.ceil(block / perRound)))}>دور کافی</button>
        </div>
        <label className="block"><span className="text-xs text-muted">باقیمانده</span>
          <select name="remainderMode" value={remainderMode} onChange={(e) => setRemainderMode(e.target.value as typeof remainderMode)} className={field}>
            <option value="extra">دورهای اضافه بسازد</option>
            <option value="last">به دور آخر اضافه شود</option>
            <option value="drop">کنار گذاشته شود</option>
          </select>
        </label>
        <dl className="space-y-1 rounded-lg border border-line bg-paper p-2 tabular-nums">
          <div className="flex justify-between"><dt>دورها</dt><dd>{plan.sizes.length}</dd></div>
          <div className="flex justify-between"><dt>در دورها</dt><dd>{plan.placed.toLocaleString("en")}</dd></div>
          <div className="flex justify-between"><dt>{rounds} × {perRound}</dt><dd>{(rounds * perRound).toLocaleString("en")}</dd></div>
          <div className="flex justify-between"><dt>باقیمانده</dt><dd>{plan.remainder.toLocaleString("en")}{remainderMode === "drop" && plan.remainder ? " (کنار)" : ""}</dd></div>
          {plan.sizes.length ? <div className="flex justify-between text-xs text-muted"><dt>اندازهٔ دور آخر</dt><dd>{plan.sizes[plan.sizes.length - 1]}</dd></div> : null}
        </dl>
        <input name="title" required maxLength={70} placeholder="عنوان دسته" className={field} />
        <div className="grid gap-2">
          <button name="createMode" value="all" disabled={!block} className={buttonClass("primary")}>همهٔ {plan.sizes.length} دور را الان بساز</button>
          <button name="createMode" value="first" disabled={!block} className={buttonClass("secondary")}>فقط دور اول؛ بقیه بعداً</button>
        </div>
        <p className="text-xs text-muted">ترتیب بلوک ذخیره می‌شود؛ دورهای بعدی دقیقاً از ادامهٔ همان بلوک ساخته می‌شوند.</p>
      </aside>
    </form>
  );
}
