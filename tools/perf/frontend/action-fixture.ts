// Models the documented Next 16.4.3 per-client serial dispatcher.
// The real form components mount unchanged; all server actions are replaced here.
let queue = Promise.resolve();
function dispatch<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.then(() => undefined, () => undefined);
  return next;
}
async function json(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Fixture request failed');
  return r.json();
}
export const countPoolAction = (input: unknown) => dispatch(() => json('/api/count', input));
export const countBlockAction = countPoolAction;
export const createPoolRoundAction = (form: FormData) => dispatch(() => json('/api/create', Object.fromEntries(form)));
export const createBatchAction = createPoolRoundAction;
