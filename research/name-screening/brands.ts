// Place well-known brands (3-6 letters) on the 5-letter ASCII-sum bell curve.
// Score = ASCII sum scaled to 5 letters (sum * 5 / len), so 3-, 4- and 6-letter
// names share one axis. 5-letter brands land on their exact sum.
// Usage: bun brands.ts [lo] [hi]   (band to highlight, default 526-563)
import { readFileSync } from "node:fs";

const lo = Number(Bun.argv[2] ?? 526);
const hi = Number(Bun.argv[3] ?? 563);

type Src = "global" | "iran";
type Brand = { label: string; key: string; len: number; sum: number; score: number; src: Src; links: number };

const SUFFIX = /\b(the|inc|incorporated|corp|corporation|company|co|ltd|limited|plc|ag|se|sa|nv|spa|gmbh|llc|group|holdings?)\b/g;
// Iranian labels carry descriptors around the brand word ("Bank Sepah", "Mahan Air", "Bank Melli Iran").
const IRAN_WORDS = /\b(bank|air|airlines|iran|of|industries|industrial|manufacturing)\b/g;
// Bluehost is tagged Iranian on Wikidata but is a US host. The rest collapse to
// a generic English word or a fragment once the descriptors above are stripped.
const EXCLUDE = new Set(["Bluehost", "Iran Daily", "Iran Dairy Industries Company", "Future Bank", "System Group", "Post Bank of Iran", "Irān-e now"]);

function key(label: string, src: Src): string {
  let s = label
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .toLowerCase()
    .replace(/\bs\.a\.?/g, " ")
    .replace(/[.,]/g, " ")
    .replace(SUFFIX, "");
  if (src === "iran") s = s.replace(IRAN_WORDS, "");
  return s.replace(/[^a-z0-9]/g, "");
}

type Raw = { label: string; src: Src; links: number };
function readWikidata(file: string, src: Src, rows: Map<string, Raw>) {
  for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
    const m = line.match(/^([^,]+),(.*),(\d+)\r?$/);
    if (!m) continue;
    const label = m[2].replace(/^"|"$/g, "").replace(/""/g, '"');
    if (src === "iran" && Number(m[3]) < 2) continue; // drops 0-1 sitelink stubs (PNPE, tatpnu, ...)
    if (EXCLUDE.has(label)) continue;
    rows.set(m[1], { label, src, links: Number(m[3]) });
  }
}

const raw = new Map<string, Raw>();
readWikidata("wd-global.csv", "global", raw);
readWikidata("wd-iran.csv", "iran", raw); // Iranian entries overwrite global ones with same id
readWikidata("wd-iran2.csv", "iran", raw);
for (const l of readFileSync("iran-curated.txt", "utf8").split(/\r?\n/).filter(Boolean))
  raw.set("curated:" + l, { label: l, src: "iran", links: 0 });

const byKey = new Map<string, Brand>();
const fetched = { global: 0, iran: 0 };
for (const { label, src, links } of raw.values()) {
  fetched[src]++;
  const k = key(label, src);
  if (!/^[a-z]{3,6}$/.test(k)) continue;
  let sum = 0;
  for (let i = 0; i < k.length; i++) sum += k.charCodeAt(i);
  const b: Brand = { label, key: k, len: k.length, sum, score: Math.round((sum * 5) / k.length), src, links };
  const prev = byKey.get(k);
  // Same name from both sources: keep the Iranian one so the Iran view is complete.
  if (!prev || (src === "iran" && prev.src !== "iran") || (src === prev.src && links > prev.links)) byKey.set(k, b);
}
const brands = [...byKey.values()].sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

// Background: the 5-letter pool histogram from ascii-sum.ts.
const hist = readFileSync("ascii-sum.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(",").map(Number));

const data = {
  lo, hi, hist,
  brands: brands.map((b) => [b.score, b.sum, b.len, b.key, b.label, b.src === "iran" ? 1 : 0]),
};

const html = `<!doctype html><meta charset="utf-8"><title>Brands on the ASCII-sum curve</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px}svg text{font-size:11px;fill:#444}
table{border-collapse:collapse;margin-top:16px}td,th{padding:2px 10px;border-bottom:1px solid #eee;text-align:right}td.l{text-align:left}
tr.in{background:#eaf8ec}.k{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 12px}
.sw{display:inline-flex;border:1px solid #bbb;border-radius:6px;overflow:hidden;margin:8px 0}
.sw label{padding:6px 14px;cursor:pointer;user-select:none}.sw input{display:none}.sw input:checked+span{font-weight:600}
.sw label:has(input:checked){background:#0072b2;color:#fff}
</style>
<h2>Where well-known brands land on the 5-letter ASCII-sum curve</h2>
<div class="sw">
  <label><input type="radio" name="m" value="both" checked><span>Both</span></label>
  <label><input type="radio" name="m" value="global"><span>Global only</span></label>
  <label><input type="radio" name="m" value="iran"><span>Iranian only</span></label>
</div>
<p id="sum"></p>
<p>Score = ASCII sum × 5 / length, so every length sits on the 5-letter axis. Light bars = 5-letter pool. Hover a dot for the brand. Red ring = Iranian.
<span class="k" style="background:#e69f00"></span>3L<span class="k" style="background:#009e73"></span>4L<span class="k" style="background:#0072b2"></span>5L<span class="k" style="background:#cc79a7"></span>6L</p>
<div id="chart"></div>
<table><thead><tr><th>score</th><th>raw sum</th><th>len</th><th class="l">name</th><th class="l">label</th><th>source</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const D = ${JSON.stringify(data)};
const COL = {3:"#e69f00",4:"#009e73",5:"#0072b2",6:"#cc79a7"};
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;");
const all = D.brands.map(([score,sum,len,key,label,iran]) => ({score,sum,len,key,label,iran}));
const minS = Math.min(D.hist[0][0], all[0].score) - 2;
const maxS = Math.max(D.hist[D.hist.length-1][0], all[all.length-1].score) + 2;
const maxC = Math.max(...D.hist.map(h => h[1]));

function render(mode) {
  const list = all.filter(b => mode === "both" || (mode === "iran") === !!b.iran);
  const stacks = new Map();
  for (const b of list) (stacks.get(b.score) ?? stacks.set(b.score, []).get(b.score)).push(b);
  const maxStack = Math.max(1, ...[...stacks.values()].map(s => s.length));
  const W = 1500, P = 60, HH = 380, R = 5, H = HH + maxStack * (2*R+1) + 70;
  const bw = (W - 2*P) / (maxS - minS + 1);
  const x = s => P + (s - minS) * bw;
  const yH = c => HH - (c / maxC) * (HH - 40);
  const o = [];
  o.push('<rect x="'+x(D.lo)+'" y="20" width="'+(x(D.hi+1)-x(D.lo))+'" height="'+(H-60)+'" fill="#2ecc40" opacity="0.10"/>');
  o.push('<text x="'+(x(D.lo)+4)+'" y="34" fill="#1a8f2c">band '+D.lo+'-'+D.hi+'</text>');
  for (const [s,c] of D.hist) o.push('<rect x="'+x(s).toFixed(1)+'" y="'+yH(c).toFixed(1)+'" width="'+(bw-0.5).toFixed(1)+'" height="'+(HH-yH(c)).toFixed(1)+'" fill="#c9d6ee"><title>5-letter pool, sum '+s+': '+c.toLocaleString()+'</title></rect>');
  o.push('<line x1="'+P+'" x2="'+(W-P)+'" y1="'+HH+'" y2="'+HH+'" stroke="#999"/>');
  for (const [s, st] of stacks) st.forEach((b, i) => {
    const ring = b.iran ? ' stroke="#d00" stroke-width="2"' : '';
    o.push('<circle cx="'+(x(s)+bw/2).toFixed(1)+'" cy="'+(HH+10+R+i*(2*R+1))+'" r="'+R+'" fill="'+COL[b.len]+'"'+ring+'><title>'+esc(b.label)+' ('+b.key+', '+b.len+'L) sum '+b.sum+' -> score '+b.score+(b.iran?' · Iran':'')+'</title></circle>');
  });
  for (let s = Math.ceil(minS/10)*10; s <= maxS; s += 10) o.push('<text x="'+(x(s)+bw/2).toFixed(1)+'" y="'+(H-22)+'" text-anchor="middle">'+s+'</text>');
  o.push('<text x="'+W/2+'" y="'+(H-4)+'" text-anchor="middle">ASCII sum, scaled to 5 letters</text>');
  document.getElementById("chart").innerHTML = '<svg width="'+W+'" height="'+H+'">'+o.join("")+'</svg>';

  const inBand = list.filter(b => b.score >= D.lo && b.score <= D.hi).length;
  const byLen = [3,4,5,6].map(l => l+'L: '+list.filter(b => b.len === l).length).join(' · ');
  const below = list.filter(b => b.score < D.lo).length, above = list.filter(b => b.score > D.hi).length;
  document.getElementById("sum").innerHTML = '<b>'+list.length+' brands</b> ('+byLen+') · <b>'+inBand+' ('+(list.length ? Math.round(inBand/list.length*100) : 0)+'%) inside '+D.lo+'-'+D.hi+'</b> · '+below+' below · '+above+' above. The band holds 75% of the 5-letter pool.';
  document.getElementById("rows").innerHTML = list.map(b => '<tr'+(b.score>=D.lo&&b.score<=D.hi?' class="in"':'')+'><td>'+b.score+'</td><td>'+b.sum+'</td><td>'+b.len+'</td><td class="l">'+b.key+'</td><td class="l">'+esc(b.label)+'</td><td>'+(b.iran?'Iran':'Global')+'</td></tr>').join("");
}
for (const r of document.querySelectorAll('input[name=m]')) r.addEventListener("change", e => render(e.target.value));
render("both");
</script>`;

await Bun.write("brands.html", html);
await Bun.write("brands.csv", "score,sum,len,name,label,iran\n" + brands.map((b) => `${b.score},${b.sum},${b.len},${b.key},"${b.label.replace(/"/g, '""')}",${b.src === "iran" ? 1 : 0}`).join("\n") + "\n");
const iran = brands.filter((b) => b.src === "iran");
const glob = brands.filter((b) => b.src === "global");
const pct = (l: Brand[]) => Math.round((l.filter((b) => b.score >= lo && b.score <= hi).length / l.length) * 100);
console.log(`fetched global ${fetched.global}, iran ${fetched.iran}`);
console.log(`kept 3-6L: global ${glob.length} (${pct(glob)}% in ${lo}-${hi}), iran ${iran.length} (${pct(iran)}% in band)`);
