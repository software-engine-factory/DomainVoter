"use client";

import { useEffect, useState } from "react";
import { countMatchesAction, deriveRoundAction } from "@/lib/actions/rounds";
import { Alert, Field, buttonClass, fieldClass } from "@/components/ui";
import { SubmitButton } from "@/components/pending";
import { t } from "@/lib/copy/fa";

export function DeriveForm({ roundId, defaultTitle, serverError }: { roundId: number; defaultTitle: string; serverError?: string }) {
  const [title, setTitle] = useState(defaultTitle);
  const [minVotes, setMinVotes] = useState("");
  const [maxVotes, setMaxVotes] = useState("");
  const [premium, setPremium] = useState("any");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("original");
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void countMatchesAction(roundId, { minVotes, maxVotes, premium, minPrice, maxPrice, sort })
        .then((result) => {
          if (!active) return;
          setCount(result.count);
          setError(result.error ?? "");
        })
        .catch(() => {
          if (!active) return;
          setError(t.derive.err.count);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [maxPrice, maxVotes, minPrice, minVotes, premium, roundId, sort]);

  const blocked = count === 0 || Boolean(error);

  return (
    <form action={deriveRoundAction} className="grid max-w-xl gap-5">
      <input type="hidden" name="roundId" value={roundId} />
      <Field label={t.derive.nextTitle}>
        <input name="title" value={title} maxLength={80} required onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.derive.minVotes} hint={t.derive.blankNoLimit}>
          <input name="minVotes" dir="ltr" inputMode="numeric" value={minVotes} onChange={(event) => setMinVotes(event.target.value)} className={fieldClass} />
        </Field>
        <Field label={t.derive.maxVotes} hint={t.derive.blankNoLimit}>
          <input name="maxVotes" dir="ltr" inputMode="numeric" value={maxVotes} onChange={(event) => setMaxVotes(event.target.value)} className={fieldClass} />
        </Field>
        <Field label={t.derive.minPrice}>
          <input name="minPrice" dir="ltr" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} className={fieldClass} />
        </Field>
        <Field label={t.derive.maxPrice}>
          <input name="maxPrice" dir="ltr" inputMode="decimal" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} className={fieldClass} />
        </Field>
      </div>
      <Field label={t.common.premium}>
        <select name="premium" value={premium} onChange={(event) => setPremium(event.target.value)} className={fieldClass}>
          <option value="any">{t.derive.anyDomain}</option>
          <option value="premium">{t.derive.onlyPremium}</option>
          <option value="standard">{t.derive.onlyStandard}</option>
        </select>
      </Field>
      <Field label={t.derive.order}>
        <select name="sort" value={sort} onChange={(event) => setSort(event.target.value)} className={fieldClass}>
          <option value="original">{t.derive.orderOriginal}</option>
          <option value="votes">{t.derive.orderVotes}</option>
        </select>
      </Field>
      {serverError && serverError !== error ? <Alert tone="danger">{serverError}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <p className="text-sm text-muted">
        {count == null ? t.derive.counting : t.derive.matches(count)}
      </p>
      <div>
        <SubmitButton pendingLabel={t.pending.creating} className={buttonClass()} disabled={blocked}>
          {t.derive.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
