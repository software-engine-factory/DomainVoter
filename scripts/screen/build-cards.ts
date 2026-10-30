// One-off review page for every rejected name: the app's voter cards (default
// "kahroba" theme), no header or footer, one virtualised full-width grid.
// Click a card to bookmark it (saved in this browser's localStorage); press B or the
// corner pill to see only bookmarks. Usage: bun scripts/screen/build-cards.ts (works in research/name-screening/out/open)
//
// Cards are ordered most-sayable first: the higher of the Persian (Behnevis) and
// English character-trigram scores, so likely misses sit at the top, not "aaaqv".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INPUTS, OUT } from "./paths";

process.chdir(join(OUT, "open"));

const A = 27, id = (c: number) => c - 96;
function trainLM(words: Iterable<string>) {
  const c1 = new Float64Array(A), c2 = new Float64Array(A * A), c3 = new Float64Array(A * A * A), x1 = new Float64Array(A), x2 = new Float64Array(A * A);
  let t = 0;
  for (const w of words) {
    let a = 0, b = 0;
    for (let i = 0; i <= w.length; i++) { const c = i < w.length ? id(w.charCodeAt(i)) : 0; c1[c]++; t++; c2[b * A + c]++; x1[b]++; c3[(a * A + b) * A + c]++; x2[a * A + b]++; a = b; b = c; }
  }
  return (w: string) => {
    let a = 0, b = 0, s = 0;
    for (let i = 0; i <= w.length; i++) {
      const c = i < w.length ? id(w.charCodeAt(i)) : 0;
      const p3 = x2[a * A + b] ? c3[(a * A + b) * A + c] / x2[a * A + b] : 0, p2 = x1[b] ? c2[b * A + c] / x1[b] : 0;
      s += Math.log2(0.6 * p3 + 0.3 * p2 + 0.1 * c1[c] / t + 1e-9); a = b; b = c;
    }
    return s / (w.length + 1);
  };
}
const fa = trainLM(new Set([...readFileSync(join(INPUTS, "behnevis/combined_tables.js"), "utf8").matchAll(/"([a-z]+)":"/g)].map((m) => m[1])));
const en = trainLM(readFileSync(join(INPUTS, "words_alpha.txt"), "utf8").split(/\r?\n/).filter((w) => w.length >= 3 && /^[a-z]+$/.test(w)));

const rows = readFileSync("rejected.csv", "utf8").trim().split("\n").slice(1)
  .map((line) => ({ line, s: Math.max(fa(line.slice(0, 5)), en(line.slice(0, 5))) }))
  .sort((a, b) => b.s - a.s)
  .map((r) => r.line);
const reasons: string[] = [], reasonIdx = new Map<string, number>();
let names = "", codes = "";
const prices: Record<number, number> = {};
rows.forEach((line, i) => {
  const [name, faR, , enR, , price] = line.split(",");
  const r = faR === enR ? faR : `${faR} · ${enR}`;
  if (!reasonIdx.has(r)) { reasonIdx.set(r, reasons.length); reasons.push(r); }
  names += name;
  codes += String.fromCharCode(48 + reasonIdx.get(r)!); // 60 combos fit in printable ASCII
  if (price) prices[i] = Number(price);
});
if (reasons.length > 70) throw new Error(`too many reason combos: ${reasons.length}`);

const html = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rejected names · ${rows.length.toLocaleString()}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Vazirmatn:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{--paper:#f3efe6;--ink:#1c1915;--card:#fffdf8;--muted:#5e574e;--line:#e3dacd;--accent:#085041;--accent-soft:#e4f3ec;--chip:#efe8dc;
--radius-tile:.75rem;--ease-out:cubic-bezier(.2,.8,.2,1);--ease-spring:cubic-bezier(.34,1.56,.64,1);--shadow-lift:0 6px 18px rgb(0 0 0/.08);
--colw:118px;--rowh:66px;--gap:6px}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);font-family:Vazirmatn,sans-serif}
#scroller{position:fixed;inset:0;overflow-y:auto;overscroll-behavior:contain}
#spacer{position:relative}
#grid{position:sticky;top:0;height:100vh;overflow:hidden}
#layer{position:absolute;inset:0}
.row{position:absolute;top:0;left:0;right:0;height:var(--rowh);will-change:transform;contain:layout style}
.tile{position:absolute;display:flex;flex-direction:column;border:1px solid var(--line);background:var(--card);
border-radius:var(--radius-tile);padding:6px 9px 5px;cursor:pointer;text-align:start;overflow:hidden;contain:strict;
transition:transform 180ms var(--ease-out),box-shadow 180ms ease}
.tile:hover{transform:translateY(-3px);box-shadow:var(--shadow-lift);border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.tile:active{transform:translateY(0) scale(.97);transition-duration:80ms}
.tile.on{border-color:var(--accent);background:var(--accent-soft)}.tile.pulse{animation:pulse 520ms var(--ease-out)}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 35%,transparent)}100%{box-shadow:0 0 0 10px transparent}}
.nm{direction:ltr;text-align:left;flex:1;display:flex;align-items:center;min-height:0}
.lb{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600;font-size:1.32rem;letter-spacing:-.01em;line-height:1}
.sf{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.72rem;font-weight:500;color:var(--muted);margin-left:1px}
.ft{display:flex;justify-content:space-between;align-items:flex-end;gap:4px;direction:ltr;min-height:15px}
.rs{font-size:.62rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:"JetBrains Mono",monospace}
.pr{font-family:"JetBrains Mono",monospace;font-size:.62rem;font-weight:600;background:var(--chip);border-radius:5px;padding:0 4px;color:color-mix(in srgb,var(--ink) 80%,transparent)}
.mk{color:var(--accent);font-size:.75rem;font-weight:700;opacity:0}
.on .mk{opacity:1}.hide{display:none}
.lk{position:absolute;top:3px;inset-inline-start:3px;width:20px;height:20px;display:grid;place-items:center;border-radius:5px;color:var(--muted);opacity:0}
.tile:hover .lk{opacity:1}.lk:hover{background:var(--chip);color:var(--ink)}
#pill{position:fixed;bottom:10px;left:10px;z-index:5;display:flex;gap:6px;opacity:.35;transition:opacity 160ms}
#pill:hover{opacity:1}
#pill button{font:600 12px Vazirmatn,sans-serif;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:5px 11px;cursor:pointer}
#pill button.acc{background:var(--accent);color:#fff;border-color:var(--accent)}
#empty{position:fixed;inset:0;display:none;place-items:center;color:var(--muted);font-size:14px}
</style></head><body>
<div id="scroller"><div id="spacer"><div id="grid"><div id="layer"></div></div></div></div><div id="empty">هنوز نامی انتخاب نشده</div>
<div id="pill"><button id="bm" title="B">★ <span id="cnt">0</span></button><button id="cp" hidden>کپی فهرست</button></div>
<script>
const NAMES=${JSON.stringify(names)};
const CODES=${JSON.stringify(codes)};
const REASONS=${JSON.stringify(reasons)};
const PRICES=${JSON.stringify(prices)};
const N=NAMES.length/5, KEY="dv-rejected-picks";
const name=i=>NAMES.substr(i*5,5);
let picks=new Set(JSON.parse(localStorage.getItem(KEY)||"[]"));
let view=null; // null = all rejected; array of indexes = bookmarks
const scroller=document.getElementById("scroller"),spacer=document.getElementById("spacer"),layer=document.getElementById("layer");
const cs=getComputedStyle(document.documentElement),COLW=parseFloat(cs.getPropertyValue("--colw")),ROWH=parseFloat(cs.getPropertyValue("--rowh")),GAP=parseFloat(cs.getPropertyValue("--gap"));
const STEP=ROWH+GAP, MAXH=15e6; // browsers cap element height; beyond this the scrollbar is scaled
let cols=1,cw=0,count=0,totalH=0,scale=1,tiles=[];
const FMT=[0,2].map(d=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:d})),FMTC=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:0});
const money=p=>p>=1e5?FMTC.format(p):FMT[p>=100?0:1].format(p);
const LINK='<svg viewBox="0 0 16 16" width="12" height="12"><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A ring of row elements, enough for one screen plus a row. Each frame only moves rows
// with a transform; a row's tiles are rewritten only when it wraps to a new row index,
// so normal scrolling refills one row at a time instead of every card.
let rowEls=[];
function layout(){
  const W=scroller.clientWidth-GAP;
  cols=Math.max(1,Math.floor(W/(COLW+GAP)));cw=(W-GAP*cols)/cols;
  count=view?view.length:N;
  totalH=Math.ceil(count/cols)*STEP+GAP;
  const h=Math.min(totalH,MAXH);spacer.style.height=Math.max(h,innerHeight)+"px";
  scale=totalH>MAXH?(totalH-innerHeight)/(h-innerHeight):1;
  const R=Math.ceil(innerHeight/STEP)+1;
  let row='<div class="row">';
  for(let c=0;c<cols;c++)
    row+='<div class="tile" role="button" style="width:'+cw+'px;height:'+ROWH+'px;right:'+(GAP+c*(cw+GAP))+'px">'+
      '<a class="lk" target="_blank" rel="noopener noreferrer">'+LINK+'</a><span class="nm"><span class="lb"></span><span class="sf">.com</span></span>'+
      '<span class="ft"><span class="rs"></span><span class="mk">✓</span></span></div>';
  layer.innerHTML=(row+'</div>').repeat(R);
  tiles=[];
  rowEls=[...layer.children].map(el=>{
    const ts=[...el.children].map(t=>({t,lb:t.querySelector(".lb"),rs:t.querySelector(".rs"),i:-1}));
    tiles.push(...ts);return {el,ts,r:-1};
  });
  document.getElementById("empty").style.display=view&&!view.length?"grid":"none";
  render();
}
function fillRow(R,r){
  for(let c=0;c<cols;c++){
    const T=R.ts[c],k=r*cols+c;
    if(k>=count){if(T.i!==-2){T.t.classList.add("hide");T.i=-2}continue}
    const i=view?view[k]:k;
    if(T.i<0)T.t.classList.remove("hide");
    T.i=i;const n=name(i),p=PRICES[i];
    T.lb.textContent=n;
    T.rs.textContent=p?money(p):REASONS[CODES.charCodeAt(i)-48];
    T.rs.className=p?"pr":"rs";
    const on=picks.has(n);T.t.classList.toggle("on",on);T.t.setAttribute("aria-pressed",on);
  }
}
let raf=0;
function render(){
  raf=0;
  const top=scroller.scrollTop*scale,r0=Math.floor(top/STEP),n=rowEls.length;
  for(let r=r0;r<r0+n;r++){
    const R=rowEls[r%n];
    if(R.r!==r){fillRow(R,r);R.r=r}
    R.el.style.transform="translate3d(0,"+(GAP+r*STEP-top)+"px,0)";
  }
}
scroller.addEventListener("scroll",()=>{if(!raf)raf=requestAnimationFrame(render)},{passive:true});
let rt=0;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(layout,100)});
layer.addEventListener("mouseover",e=>{const a=e.target.closest(".lk");if(a){const T=tiles.find(x=>x.t===a.closest(".tile"));if(T&&T.i>=0){const n=name(T.i);a.href="https://"+n+".com";a.title=n+".com"}}});
layer.addEventListener("click",e=>{
  if(e.target.closest(".lk"))return;
  const el=e.target.closest(".tile");if(!el)return;
  const T=tiles.find(x=>x.t===el);if(!T||T.i<0)return;
  const n=name(T.i);
  picks.has(n)?picks.delete(n):picks.add(n);
  localStorage.setItem(KEY,JSON.stringify([...picks]));
  const on=picks.has(n);el.classList.toggle("on",on);el.setAttribute("aria-pressed",on);
  el.classList.remove("pulse");void el.offsetWidth;if(on)el.classList.add("pulse");
  document.getElementById("cnt").textContent=picks.size;
});
function toggleView(){
  if(view){view=null;}else{
    const want=new Set(picks);view=[];
    for(let i=0;i<N&&view.length<want.size;i++)if(want.has(name(i)))view.push(i);
  }
  document.getElementById("bm").classList.toggle("acc",!!view);
  document.getElementById("cp").hidden=!view;
  scroller.scrollTop=0;layout();
}
document.getElementById("bm").onclick=toggleView;
document.getElementById("cp").onclick=()=>navigator.clipboard.writeText([...picks].sort().map(n=>n+".com").join("\\n"));
addEventListener("keydown",e=>{
  if(e.key==="b"||e.key==="B")toggleView();
  if(e.key==="Escape"&&view)toggleView();
  const page=innerHeight*0.9/scale;
  if(e.key==="PageDown"||e.key===" "){scroller.scrollTop+=page;e.preventDefault()}
  if(e.key==="PageUp"){scroller.scrollTop-=page;e.preventDefault()}
  if(e.key==="Home")scroller.scrollTop=0;
  if(e.key==="End")scroller.scrollTop=scroller.scrollHeight;
});
document.getElementById("cnt").textContent=picks.size;
layout();
</script></body></html>`;

await Bun.write("rejected-cards.html", html);
console.log(`${rows.length.toLocaleString()} cards, ${reasons.length} reason combos, ${Object.keys(prices).length} with price, ${(html.length / 1e6).toFixed(1)} MB`);
