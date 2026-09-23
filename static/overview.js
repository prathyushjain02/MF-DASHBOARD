/* The Equity overview: the landing page.

   Five panels, one at a time: the broad benchmarks side by side, the holding
   period tools, why equity and why India, how we choose and keep watching,
   and the quarter's House View. Everything live comes from /api/mf/overview;
   the long Sensex tables and the House View figures travel in the same
   payload and say where they are from at the foot of the page.

   Nothing here carries a score, rank or quartile. */

async function renderOverview(host, token) {
  host.innerHTML = '<div class="loading">Reading the benchmarks…</div>';
  const D = await get('/overview');
  if (superseded(token)) return;
  host.innerHTML = `<div class="overview"><section class="band" id="band">
    <div><span class="tag ondark">Equity overview</span><h1>Markets, perspective, positioning.</h1></div>
    <div class="keystats" id="keystats"></div>
  </section>

  <nav class="ptabs" id="ptabs">
    <button class="on" data-p="markets">Markets<small>where the money has been made</small></button>
    <button data-p="hold">Holding period<small>time in, not timing</small></button>
    <button data-p="why">Why equity, why India<small>the long run</small></button>
    <button data-p="how">How we choose<small>and keep watching</small></button>
    <button data-p="hv">House view<small>Q2FY27</small></button>
  </nav>

  <!-- markets -->
  <section class="panel on" id="p-markets">
    <div class="grid stagger">
      <section class="card c8"><div class="eye"><span class="tag">Benchmark race</span><span class="periods" id="periods"></span></div><div class="race" id="race"></div><div class="key" id="racekey"></div></section>
      <section class="card c4"><div class="eye"><span class="tag">Leaderboard</span><span class="note" id="lb-note"></span></div><div class="lb" id="lb"></div><div class="grow"></div><div class="foot" id="lb-foot"></div></section>
    </div>
    <div class="grid stagger">
      <section class="card c7 opens" tabindex="0" data-modal="quilt"><div class="eye"><span class="tag">Calendar years, ranked</span><span class="note">total return · 2026 is year to date</span></div><div class="quilt" id="quilt"></div><div class="qkey" id="qkey"></div><div class="corner"></div></section>
      <section class="card c5"><div class="eye"><span class="tag">How far below the last high</span><span class="note">weekly, since 2018</span></div><div class="periods" id="fallpick"></div><div class="uw" id="uw"></div><div class="fallstrip" id="fallstrip"></div></section>
    </div>
  </section>

  <!-- holding period -->
  <section class="panel" id="p-hold">
    <div class="grid stagger">
      <section class="card c6"><div class="eye"><span class="tag">Sensex, INR 100 in 2000</span><span class="note">year by year, to Sep 2025 · crises shaded peak to bottom</span></div><div class="path" id="path"></div><div class="foot" id="path-foot"></div></section>
      <section class="card c6"><div class="eye"><span class="tag">Buying at the worst moment</span><span class="note">six crises, a year since</span></div><div style="overflow-x:auto"><table class="crisis" id="crisis"></table></div><div class="grow"></div><div class="cdetail" id="cdetail"></div></section>
    </div>
    <div class="grid stagger">
      <section class="card c12"><div class="eye"><span class="tag">Every start year, every holding period</span><span class="note">annualised return, Sensex, price only · hover any cell</span></div><div class="holdwrap"><div class="hold" id="hold"></div><div class="gridwrap" id="gridwrap"></div></div></section>
    </div>
  </section>

  <!-- why -->
  <section class="panel" id="p-why">
    <div class="grid stagger">
      <section class="card c6"><div class="eye"><span class="tag">Why equity</span><span class="note">the index, over decades</span></div><div class="tiles" id="sensex"></div><div class="grow"></div><div class="foot" id="sensex-foot"></div></section>
      <section class="card c6"><div class="eye"><span class="tag">Why India</span><span class="note">the backdrop, 2026</span></div><div class="tiles" id="india"></div><div class="grow"></div><div class="foot" id="india-foot"></div></section>
    </div>
    <div class="grid stagger">
      <section class="card c7"><div class="eye"><span class="tag">What compounding does</span><span class="note">drag the amount and the years</span></div><div class="sip" id="sip"></div></section>
      <section class="card c5"><div class="eye"><span class="tag">Against the alternatives</span><span class="note">20 years, a year</span></div><div class="bars" id="assets" style="margin-top:4px"></div><div class="grow"></div><div class="foot">Equity with dividends against bank deposits and city property over twenty years. Equity is the only one that beat inflation by a wide margin.</div></section>
    </div>
    <div class="grid stagger">
      <section class="card c7"><div class="eye"><span class="tag">The themes we back</span><span class="note">from the House View</span></div><div class="themes" id="themes"></div></section>
      <section class="card c5 opens" tabindex="0" data-modal="landscape"><div class="eye"><span class="tag">What to expect, by vehicle</span><span class="note">a year, over 18 to 24 months</span></div><div style="overflow-x:auto"><table class="land" id="landscape"></table></div><div class="corner"></div></section>
    </div>
  </section>

  <!-- how -->
  <section class="panel" id="p-how">
    <div class="grid stagger">
      <section class="card c8"><div class="eye"><span class="tag">How selective are we</span><span class="note">click a stage</span></div><div class="funnel" id="funnel"></div><div class="fsay" id="fsay"></div></section>
      <section class="card c4"><div class="eye"><span class="tag">What we walk away from</span><span class="note">whatever the returns</span></div><div class="walk" id="walk"></div></section>
    </div>
    <div class="grid stagger">
      <section class="card c7"><div class="eye"><span class="tag">Two managers, one pick</span><span class="note">real flexi cap funds, names removed</span></div><div class="game" id="game"></div></section>
      <section class="card c5"><div class="eye"><span class="tag">What makes us relook</span><span class="note">tap a flag</span></div><div class="flags" id="flags"></div><div class="story" id="story"></div></section>
    </div>
  </section>

  <!-- house view -->
  <section class="panel" id="p-hv">
    <div class="hvcall" id="hvcall"></div>
    <div class="hvgrid stagger">
      <section class="card c8"><div class="eye"><span class="tag">Listed equity positioning</span><span class="note">OW overweight · N neutral · UW underweight</span></div><table class="stance" id="stance"></table><div class="hist" id="hist"></div></section>
      <section class="card c4"><div class="eye"><span class="tag">Where we are in the cycle</span><span class="note">30 Jun 2026</span></div><div id="gauges"></div><div class="grow"></div><div class="foot" id="gauge-foot"></div></section>
    </div>
    <div class="hvgrid stagger">
      <section class="card c7"><div class="eye"><span class="tag">Sectors: growth versus price</span><span class="note">12-month forward</span></div><div class="scatter" id="scatter" style="position:relative"></div><div class="foot" id="sector-view"></div></section>
      <section class="card c5"><div class="eye"><span class="tag">What we are watching</span><span class="note">five factors</span></div><div class="factors" id="factors"></div></section>
    </div>
  </section>

  <div class="legend" id="prov"></div></div>`;

const n=(v,d=1)=>v==null||isNaN(v)?'–':Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const sign=(v,d=1)=>v==null?'–':(v>0?'+':'')+n(v,d);
const monY=s=>new Date(s).toLocaleString('en-GB',{month:'short',year:'numeric'});
const dmy=s=>new Date(s).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const proposed=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches;
const IDX=['Nifty 50','Nifty 500','Nifty Midcap 150','Nifty Smallcap 250'];
const COL={'Nifty 50':'#171d25','Nifty 500':'#7e94b6','Nifty Midcap 150':'#5676a8','Nifty Smallcap 250':'#f28275'};
const QCOL={'Nifty 50 TRI':'#171d25','Nifty 500 TRI':'#7e94b6','Nifty Midcap 100 TRI':'#5676a8','Nifty Smallcap 250 TRI':'#f28275'};
const short=s=>s.replace(' TRI','');

// panels: one at a time
document.querySelectorAll('#ptabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#ptabs button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.panel').forEach(p=>{p.classList.remove('on');});const p=$('#p-'+b.dataset.p);void p.offsetWidth;p.classList.add('on');if(b.dataset.p==='markets')drawRace();if(b.dataset.p==='hv')drawScatter();});

$('#keystats').innerHTML=IDX.map(k=>{const v=D.indices[k].returns.YTD.total;return `<div><span class="k">${esc(k)} · YTD</span><span class="v num ${v<0?'dn':'upv'}">${sign(v)}<small>%</small></span></div>`;}).join('');

// ---- race ----
const PER=['YTD','1Y','3Y','5Y','7Y'];let period='YTD';
function startDate(p){const end=new Date(D.asOf);if(p==='YTD')return new Date(end.getFullYear(),0,1);const y=+p[0];return new Date(end.getFullYear()-y,end.getMonth(),end.getDate());}
function slice(k,p){const s=D.indices[k].series,st=startDate(p);let i=s.d.findIndex(d=>new Date(d)>=st);if(i<0)i=0;const base=s.v[i];return {d:s.d.slice(i),v:s.v.slice(i).map(x=>x/base*100)};}
function drawRace(){const W=760,H=300,L=36,R=168,T=14,B=26;const lines=IDX.map(k=>({k,...slice(k,period)}));
  const all=lines.flatMap(l=>l.v);let lo=Math.min(...all),hi=Math.max(...all);const pad=(hi-lo)*.08||5;lo-=pad;hi+=pad;
  const t0=new Date(lines[0].d[0]).getTime(),t1=new Date(D.asOf).getTime();const xd=d=>L+(new Date(d).getTime()-t0)/(t1-t0)*(W-L-R);const y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  const ticks=[];const step=(hi-lo)>120?50:(hi-lo)>60?25:(hi-lo)>30?10:5;for(let t=Math.ceil(lo/step)*step;t<=hi;t+=step)ticks.push(t);
  const xl=[];if(period==='YTD'||period==='1Y'){for(let m=new Date(t0);m.getTime()<=t1;m.setMonth(m.getMonth()+2)){const s=new Date(m.getFullYear(),m.getMonth(),1);if(s.getTime()>=t0)xl.push({x:xd(s),t:monY(s)});}}else{for(let yy=new Date(t0).getFullYear()+1;yy<=new Date(t1).getFullYear();yy++)xl.push({x:xd(new Date(yy,0,1)),t:yy});}
  const ends=lines.map(l=>({k:l.k,v:l.v[l.v.length-1],y:y(l.v[l.v.length-1])})).sort((a,b)=>a.y-b.y);for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<15)ends[i].y=ends[i-1].y+15;
  const paths=lines.map(l=>{const p=l.v.map((v,i)=>`${i?'L':'M'}${xd(l.d[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');return `<path class="draw" style="--len:2200" d="${p}" fill="none" stroke="${COL[l.k]}" stroke-width="${l.k==='Nifty 50'?2.2:1.7}" stroke-linejoin="round" stroke-linecap="round"/>`;}).join('');
  $('#race').innerHTML=`<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${ticks.map(t=>`<line class="${t===100?'base':'grid'}" x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L-6}" y="${y(t)+4}" text-anchor="end">${t}</text>`).join('')}${xl.map(o=>`<text x="${o.x}" y="${H-8}" text-anchor="middle">${o.t}</text>`).join('')}${paths}${ends.map(e=>`<circle cx="${W-R+2}" cy="${y(e.v)}" r="3" fill="${COL[e.k]}"/><text class="end" x="${W-R+9}" y="${e.y+4}">${esc(e.k)} <tspan fill="${e.v>=100?'var(--up)':'var(--down)'}">${n(e.v,0)}</tspan></text>`).join('')}</svg>`;
  $('#racekey').innerHTML=`<span>INR 100 on <b>${dmy(lines[0].d[0])}</b>, price only</span><span>Dotted line is where you started</span>`;drawLB();}
function drawLB(){const rows=IDX.map(k=>{const r=D.indices[k].returns[period];return {k,tot:r.total,pa:r.pa};}).sort((a,b)=>b.tot-a.tot);
  const mx=Math.max(...rows.map(r=>Math.abs(r.tot)))||1;const lb=$('#lb');const before={};[...lb.children].forEach(c=>before[c.dataset.k]=c.getBoundingClientRect().top);
  lb.innerHTML=rows.map((r,i)=>`<div class="row" data-k="${esc(r.k)}"><span class="r">${i+1}</span><div class="l"><span>${esc(r.k)}</span><div class="t"><i class="f" style="width:${Math.abs(r.tot)/mx*100}%;background:${COL[r.k]}"></i></div></div><div class="v num ${r.tot<0?'down':'up'}">${sign(r.pa??r.tot)}%<small>${r.pa!=null?'a year · '+sign(r.tot,0)+'% total':'total'}</small></div></div>`).join('');
  if(proposed()&&Object.keys(before).length){[...lb.children].forEach(c=>{const dy=before[c.dataset.k]-c.getBoundingClientRect().top;if(dy){c.style.transition='none';c.style.transform=`translateY(${dy}px)`;void c.offsetWidth;c.style.transition='';c.style.transform='';}});}
  $('#lb-note').textContent=period==='YTD'?'since 1 Jan 2026':'past '+period.replace('Y',' years').replace('1 years','year');
  const top=rows[0],bot=rows[rows.length-1];$('#lb-foot').textContent=`${top.k} leads ${bot.k} by ${n(top.tot-bot.tot,0)} points over this period.`;}
$('#periods').innerHTML=PER.map(p=>`<span class="${p===period?'on':''}" data-p="${p}">${p}</span>`).join('');
$('#periods').onclick=e=>{const s=e.target.closest('span');if(!s)return;period=s.dataset.p;document.querySelectorAll('#periods span').forEach(x=>x.classList.toggle('on',x===s));drawRace();};
drawRace();

// ---- quilt ----
const QY=Object.keys(D.quilt['Nifty 50 TRI']);const QN=Object.keys(D.quilt);
$('#quilt').innerHTML=QY.map(y=>{const cells=QN.map(k=>({k,v:D.quilt[k][y]})).sort((a,b)=>b.v-a.v);return `<div class="col"><div class="y">${y===QY[QY.length-1]?y+' YTD':y}</div>${cells.map(c=>`<div class="cell" data-k="${esc(c.k)}" style="background:${QCOL[c.k]}"><b class="num">${sign(c.v)}%</b><span>${esc(short(c.k).replace('Nifty ',''))}</span></div>`).join('')}</div>`;}).join('');
$('#qkey').innerHTML=QN.map(k=>`<span data-k="${esc(k)}"><i style="background:${QCOL[k]}"></i>${esc(k)}</span>`).join('');
function focusQ(k){const q=$('#quilt');q.classList.toggle('focus',!!k);q.querySelectorAll('.cell').forEach(c=>c.classList.toggle('hi',c.dataset.k===k));document.querySelectorAll('#qkey span').forEach(s=>s.classList.toggle('on',s.dataset.k===k));}
$('#qkey').addEventListener('mouseover',e=>{const s=e.target.closest('span');if(s)focusQ(s.dataset.k);});$('#qkey').addEventListener('mouseleave',()=>focusQ(null));
$('#quilt').addEventListener('mouseover',e=>{const c=e.target.closest('.cell');if(c)focusQ(c.dataset.k);});$('#quilt').addEventListener('mouseleave',()=>focusQ(null));
document.querySelectorAll('#qkey, #quilt').forEach(el=>el.addEventListener('click',e=>e.stopPropagation()));

// ---- underwater, live in the card ----
let fallIdx='Nifty 50';const AB=[['A','B'],['C','D'],['E','F']];
function months(a,b){return Math.round((new Date(b)-new Date(a))/(30.44*864e5));}
function uwChart(k,W=520,H=190){const u=D.indices[k].uw,f=D.indices[k].falls;const L=34,R=8,T=16,B=22;const lo=Math.min(...u.v,-5);const t0=new Date(u.d[0]).getTime(),t1=new Date(u.d[u.d.length-1]).getTime();const x=d=>L+(new Date(d).getTime()-t0)/(t1-t0)*(W-L-R),y=v=>T+(0-v)/(0-lo)*(H-T-B);
  const area=`M${x(u.d[0])},${y(0)}`+u.v.map((v,i)=>`L${x(u.d[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')+`L${x(u.d[u.d.length-1])},${y(0)}Z`;
  const years=[];for(let yy=new Date(t0).getFullYear()+1;yy<=new Date(t1).getFullYear();yy++)years.push({y:yy,x:x(new Date(yy,0,1))});
  const marks=f.map((z,i)=>`<line x1="${x(z.peak)}" x2="${x(z.peak)}" y1="${T}" y2="${H-B}" stroke="var(--s_shade)" stroke-dasharray="3 3"/><line x1="${x(z.trough)}" x2="${x(z.trough)}" y1="${T}" y2="${H-B}" stroke="var(--s_shade)" stroke-dasharray="3 3"/><text x="${x(z.peak)-3}" y="${T-4}" text-anchor="end">${AB[i][0]}</text><text x="${x(z.trough)+3}" y="${T-4}">${AB[i][1]}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}"><line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--s_shade)"/>${[-10,-20,-30].filter(t=>t>lo).map(t=>`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--s)"/><text x="${L-5}" y="${y(t)+4}" text-anchor="end">${t}%</text>`).join('')}<path d="${area}" fill="${COL[k]}" fill-opacity=".18" stroke="${COL[k]}" stroke-width="1.4"/>${marks}${years.map(o=>`<text x="${o.x}" y="${H-7}" text-anchor="middle">${o.y}</text>`).join('')}</svg>`;}
function drawUW(){$('#uw').innerHTML=uwChart(fallIdx);const f=D.indices[fallIdx].falls;$('#fallstrip').innerHTML=f.map((x,i)=>`<div><i>${AB[i][0]}–${AB[i][1]}</i><b class="num">${n(x.depth)}%</b>${monY(x.peak)} to ${monY(x.trough)}, back to the old high ${x.recovered?'in '+months(x.trough,x.recovered)+' months':'not yet'}.</div>`).join('');}
$('#fallpick').innerHTML=IDX.map(k=>`<span class="${k===fallIdx?'on':''}" data-k="${esc(k)}">${esc(k)}</span>`).join('');
$('#fallpick').onclick=e=>{const s=e.target.closest('span');if(!s)return;fallIdx=s.dataset.k;document.querySelectorAll('#fallpick span').forEach(x=>x.classList.toggle('on',x===s));drawUW();};
drawUW();

// ---- holding period ----
$('#crisis').innerHTML=`<thead><tr><th>Crisis</th><th>Top</th><th>Fall</th><th>At the top</th><th>At the bottom</th></tr></thead><tbody>${D.crises.map((c,i)=>`<tr data-i="${i}"><td>${esc(c.event)}</td><td class="num">${c.peakDate}</td><td class="num dd">${c.drawdown}</td><td class="num pa">${c.peakCagr} a yr</td><td class="num pa">${c.bottomCagr} a yr</td></tr>`).join('')}</tbody>`;
function holdStats(h){const vals=D.matrix.map(r=>r.cells[h-1]).filter(c=>c!=='').map(Number);const s=[...vals].sort((a,b)=>a-b);const med=s[Math.floor(s.length/2)];return {vals,min:s[0],max:s[s.length-1],med,hit:vals.filter(v=>v>=thr).length,neg:vals.filter(v=>v<0).length};}
let holdY=7,thr=10;
const shade=v=>v<thr?'var(--p_dim)':v>=20?'#171d25':v>=15?'#2e3b51':v>=10?'#46556b':'#7e94b6';
function drawGrid(){$('#gridwrap').innerHTML=`<div class="hg" id="hg"><span class="y"></span>${Array.from({length:25},(_,i)=>`<span class="h ${i+1===holdY?'col':''}">${i+1}</span>`).join('')}${D.matrix.map(r=>`<span class="y">${r.year}</span>${r.cells.map((c,i)=>c===''?'<span class="blank"></span>':`<span class="${+c<thr?'miss':''} ${i+1===holdY?'col':''}" data-y="${r.year}" data-h="${i+1}" data-v="${c}" style="background:${shade(+c)}">${c}</span>`).join('')}`).join('')}</div><div class="tip" id="htip"></div>`;
  $('#hg').onmousemove=e=>{const c=e.target.closest('span[data-v]');const tip=$('#htip');if(!c){tip.classList.remove('on');return;}const v=+c.dataset.v;tip.innerHTML=`<b>Started ${c.dataset.y}, held ${c.dataset.h} ${c.dataset.h==='1'?'year':'years'}</b>${sign(v,0)}% a year${v<0?', lost money':v>=thr?', clears '+thr+'%':''}`;const r=$('#gridwrap').getBoundingClientRect();tip.style.left=(e.clientX-r.left+12)+'px';tip.style.top=(e.clientY-r.top-38)+'px';tip.classList.add('on');};
  $('#hg').onmouseleave=()=>$('#htip').classList.remove('on');
  $('#hg').onclick=e=>{const c=e.target.closest('span[data-h]');if(c){holdY=+c.dataset.h;drawHold();}};}
function drawHold(){const st=holdStats(holdY);
  $('#hold').innerHTML=`<div class="top"><div class="yrs num">${holdY}<small>${holdY===1?'year held':'years held'}</small></div><input type="range" id="holdr" min="1" max="25" value="${holdY}" style="width:50%"></div>
  <div class="three"><div><div class="n num ${st.min<0?'dn':''}">${sign(st.min,0)}%</div><div class="d">worst start year, a year</div></div><div><div class="n num">${sign(st.med,0)}%</div><div class="d">typical start year, a year</div></div><div><div class="n num">${sign(st.max,0)}%</div><div class="d">best start year, a year</div></div></div>
  <p class="say">Held for <b>${holdY} ${holdY===1?'year':'years'}</b>, <b>${st.hit} of ${st.vals.length}</b> start years since 2000 cleared ${thr}% a year${st.neg?`, and <b>${st.neg}</b> lost money`:', and <b>none</b> lost money'}. The outlined column on the grid is this holding period.</p>
  <div class="thr"><span>Shade cells that made at least <b>${thr}% a year</b></span><input type="range" id="thrr" min="0" max="20" value="${thr}" style="width:120px"></div>`;
  $('#holdr').oninput=e=>{holdY=+e.target.value;drawHold();};$('#thrr').oninput=e=>{thr=+e.target.value;drawHold();};drawGrid();}
drawHold();
// yearly path from the grid's one-year returns
(function(){let lvl=100;const pts=[{y:2000,v:100}];D.matrix.forEach(r=>{lvl*=1+(+r.cells[0])/100;pts.push({y:r.year+1,v:lvl});});
  const W=700,H=250,L=44,R=14,T=22,B=26;const hi=Math.max(...pts.map(p=>p.v))*1.06;const x=y=>L+(y-2000)/25*(W-L-R),yy=v=>T+(1-Math.log(v/90)/Math.log(hi/90))*(H-T-B);
  const MO={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};const fy=s=>{const [d,m,y]=s.split('-');return 2000+(+y)+(MO[m]+(+d)/30)/12;};
  const SHORT={'DotCom Bubble':'DotCom','NDA losing':'NDA 2004','Chinese Hard Landing':'China 2006','Global Financial Crisis':'GFC','European Bank Crisis':'EU banks','COVID-19 Outbreak':'COVID'};
  const EV=D.crises.map(c=>[fy(c.peakDate),fy(c.bottomDate),SHORT[c.event]||c.event]);
  const d=pts.map((p,i)=>`${i?'L':'M'}${x(p.y).toFixed(1)},${yy(p.v).toFixed(1)}`).join('');
  $('#path').innerHTML=`<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${EV.map((e,i)=>`<rect class="evband" data-i="${i}" x="${x(e[0])}" y="${T}" width="${Math.max(x(e[1])-x(e[0]),5)}" height="${H-T-B}" fill="var(--red_light)" fill-opacity=".22"/><text class="ev" data-i="${i}" x="${x(e[0])+(e[1]-e[0]<0.5?-3:3)}" y="${T+11+(i%2)*12}" text-anchor="${e[1]-e[0]<0.5?'end':'start'}">${e[2]}</text>`).join('')}${[100,200,500,1000,2000].map(v=>`<line x1="${L}" x2="${W-R}" y1="${yy(v)}" y2="${yy(v)}" stroke="var(--s)"/><text x="${L-6}" y="${yy(v)+4}" text-anchor="end">${v.toLocaleString('en-IN')}</text>`).join('')}<path class="draw" style="--len:1400" d="${d}" fill="none" stroke="var(--p)" stroke-width="2.2" stroke-linejoin="round"/>${pts.filter(p=>p.y%5===0).map(p=>`<text x="${x(p.y)}" y="${H-8}" text-anchor="middle">${p.y}</text>`).join('')}<circle cx="${x(2025)}" cy="${yy(pts[25].v)}" r="4" fill="var(--red)"/><text x="${x(2025)-8}" y="${yy(pts[25].v)-10}" text-anchor="end" style="fill:var(--p);font-size:12px">INR ${Math.round(pts[25].v).toLocaleString('en-IN')}</text></svg>`;
  $('#path-foot').textContent=`INR 100 in January 2000 became about INR ${Math.round(pts[25].v).toLocaleString('en-IN')} by September 2025, without dividends. Log scale, so equal slopes are equal growth rates. Click a crisis in the table, or a shaded band, to follow it.`;
  $('#path').onclick=e=>{const b=e.target.closest('[data-i]');if(b)selCrisis(+b.dataset.i);};})();
const num=s=>+String(s).replace(/,/g,'');const pct=s=>+String(s).replace('%','')/100;
function selCrisis(i){const c=D.crises[i];document.querySelectorAll('#crisis tbody tr').forEach(r=>r.classList.toggle('on',+r.dataset.i===i));$('#path').classList.add('sel');document.querySelectorAll('#path [data-i]').forEach(el=>el.classList.toggle('on',+el.dataset.i===i));
  const peak=num(c.peak),bot=num(c.bottom);const yrs=(new Date('2025-09-30')-new Date(c.peakDate.replace(/(\d+)-(\w+)-(\d+)/,(m,d,mo,y)=>`${d} ${mo} 20${y}`)))/(365.25*864e5);const today=peak*Math.pow(1+pct(c.peakCagr),yrs);
  const W=150,H=70;const lo=bot*0.85,hi=today*1.1;const yy=v=>8+(1-Math.log(v/lo)/Math.log(hi/lo))*(H-20);const xs=[10,58,W-10];const ys=[yy(peak),yy(bot),yy(today)];
  $('#cdetail').innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="M${xs[0]},${ys[0]}L${xs[1]},${ys[1]}" stroke="var(--down)" stroke-width="2" fill="none"/><path d="M${xs[1]},${ys[1]}L${xs[2]},${ys[2]}" stroke="var(--up)" stroke-width="2" fill="none"/><circle cx="${xs[0]}" cy="${ys[0]}" r="3" fill="var(--down)"/><circle cx="${xs[1]}" cy="${ys[1]}" r="3" fill="var(--down)"/><circle cx="${xs[2]}" cy="${ys[2]}" r="3" fill="var(--up)"/><text x="${xs[0]}" y="${H-2}">top</text><text x="${xs[1]}" y="${H-2}" text-anchor="middle">bottom</text><text x="${xs[2]}" y="${H-2}" text-anchor="end">Sep 2025</text></svg><p><b>${esc(c.event)}.</b> Sensex ${c.peak} on ${c.peakDate}, <span class="dn">${c.drawdown}</span> to ${c.bottom} by ${c.bottomDate}, about ${Math.round(today/1000)*1000>=1000?Math.round(today/1000).toLocaleString('en-IN')+',000':Math.round(today)} by Sep 2025. Bought at the top, <span class="up">${c.peakCagr} a year</span> since; at the bottom, <span class="up">${c.bottomCagr}</span>. The fall was the price of timing; the recovery came either way.</p>`;}
$('#crisis').onclick=e=>{const r=e.target.closest('tr[data-i]');if(r)selCrisis(+r.dataset.i);};selCrisis(3);

// ---- why ----
$('#sensex').innerHTML=`<div class="tile"><div class="n num">12.4%</div><div class="d">a year, Nifty 50 with dividends, since its 1995 base to Jun 2026</div></div><div class="tile"><div class="n num">12.4%</div><div class="d">a year over the past 20 years, with dividends</div></div><div class="tile"><div class="n num">13.6%</div><div class="d">a year, Sensex since Dec 1986, price only</div></div><div class="tile"><div class="n num">0</div><div class="d">ten-year windows in which the Nifty 50 lost money</div></div>`;
$('#sensex-foot').textContent='Equity has been the best-returning asset class in India over forty years, ahead of gold, property and deposits, with the falls along the way shown on the Markets tab.';
$('#india').innerHTML=`<div class="tile"><div class="n">USD 4.6 tn</div><div class="d">economy by FY27, back to 4th largest on IMF numbers; 3rd by 2031</div></div><div class="tile"><div class="n num" style="font-size:22px">6.4–6.9%</div><div class="d">FY27 growth, IMF to RBI range; fastest major economy</div></div><div class="tile"><div class="n">INR 32k cr</div><div class="d">a month through SIPs, Jul 2026; 9.9 cr accounts contributing</div></div><div class="tile"><div class="n">23 cr</div><div class="d">demat accounts, about a lakh opened every day</div></div>`;
$('#india-foot').textContent='Domestic money now anchors the market: mutual fund and SIP flows absorbed record foreign selling through 2026. Infrastructure capex has gone from INR 1.4 tn in FY16 to INR 12.2 tn in FY27, heading for INR 20 tn by FY30.';
let sipAmt=25000,sipYrs=15;
const fv=(pm,r,y)=>{const m=r/12,k=y*12;return pm*((Math.pow(1+m,k)-1)/m)*(1+m);};
const lakh=v=>v>=1e7?(v/1e7).toFixed(2)+' cr':Math.round(v/1e5)+' lakh';
function drawSip(){const eq=fv(sipAmt,.124,sipYrs),fd=fv(sipAmt,.07,sipYrs),put=sipAmt*12*sipYrs;
  $('#sip').innerHTML=`<div class="ctl"><label><span>Every month</span><b>INR ${sipAmt.toLocaleString('en-IN')}</b></label><input type="range" id="sipa" min="5000" max="200000" step="5000" value="${sipAmt}"><label><span>For</span><b>${sipYrs} years</b></label><input type="range" id="sipy" min="5" max="30" value="${sipYrs}"></div><div class="out"><div class="eq"><div class="n">INR ${lakh(eq)}</div><div class="d">in equity at 12.4% a year, the Nifty 50 with dividends over 20 years</div></div><div><div class="n">INR ${lakh(fd)}</div><div class="d">in a deposit at 7% a year</div></div><div><div class="n">INR ${lakh(put)}</div><div class="d">what you actually put in</div></div></div><p class="say">Same money, same discipline: equity ends <b>${(eq/fd).toFixed(1)}×</b> the deposit and <b>${(eq/put).toFixed(1)}×</b> what went in. The gap is mostly the last third of the years.</p>`;
  $('#sipa').oninput=e=>{sipAmt=+e.target.value;drawSip();};$('#sipy').oninput=e=>{sipYrs=+e.target.value;drawSip();};}
drawSip();
$('#assets').innerHTML=[['Nifty 50, with dividends',12.4,true],['Bank deposits',7.3],['City property',7.0],['Inflation',5.5]].map(a=>`<div class="bar"><span class="l">${a[0]}</span><span class="t"><i class="f ${a[2]?'lead':''}" style="width:${a[1]/13*100}%"></i></span><span class="v num">${n(a[1])}%</span></div>`).join('');
const TH=[['Financials first','Lenders over non-lenders, private banks over public. Credit growth and a better asset cycle carry the FY27 earnings recovery.'],['Manufacturing and capex','Public capex at record levels, private capex following. Order books in industrials and infrastructure give multi-year visibility.'],['Financialisation of savings','Households moving from deposits and gold to markets. SIP flows are structural, not cyclical, and cushion foreign outflows.'],['Consumption, selectively','Tax rationalisation and rural recovery support discretionary demand; we back auto ancillaries, logistics and telecom over staples.'],['Earnings recovery','After two muted years consensus expects mid-teens Nifty earnings growth into FY27; Q1 results set the tone.'],['Reasonable valuations','India at a premium to emerging markets but below its own five-year average. Large caps are where that gap is widest.']];
$('#themes').innerHTML=TH.map(t=>`<div class="theme"><b>${t[0]}</b><span>${t[1]}</span></div>`).join('');
const BK=['Large cap','Flexi cap','Mid & small cap','Thematic','Micro cap','Long short','Discretionary'];
$('#landscape').innerHTML=`<thead><tr><th>Vehicle</th>${['Large cap','Flexi cap','Mid & small cap'].map(b=>`<th>${b}</th>`).join('')}</tr></thead><tbody>${D.landscape.slice(0,3).map(v=>`<tr><td>${esc(v.vehicle)}</td>${['Large cap','Flexi cap','Mid & small cap'].map(b=>{const c=v.buckets.find(x=>x[0]===b);return `<td class="num" style="text-align:center">${c?c[1]:'<span class="na">·</span>'}</td>`;}).join('')}</tr>`).join('')}</tbody>`;

// ---- funnel ----
const FUN=[['Tracked','600+','Every equity fund, PMS and AIF we can see, refreshed monthly. Nothing is chosen here; it is the universe.'],['Screened','≈150','Three basic requirements: long-term consistency against benchmark and peers, drawdowns no worse than the market, and a size that has not outrun the strategy.'],['Met','≈60','In-person time with the fund manager and team: how ideas are found, how the model is built, who leaves and why, what they own themselves.'],['Questionnaire','≈30','A written due-diligence questionnaire on organisation, team, process, quants and references. Answers are checked, not filed.'],['Committee','≈20','A note to the Investment Committee: performance, benchmarking, fees, governance, references, risks, compliance and operations.'],['Approved','≈15','What reaches a client portfolio. Approval is reviewed, not permanent; the flags on the right decide when.']];
$('#funnel').innerHTML=FUN.map((f,i)=>`<div class="fstage ${i===0?'on':''}" data-i="${i}"><div class="bar"><i style="height:${[100,50,32,22,15,11][i]}%"></i></div><div class="n num">${f[1]}</div><div class="k">${f[0]}</div></div>`).join('');
function fsay(i){$('#fsay').innerHTML=`<b>${FUN[i][0]}</b>${FUN[i][2]}`;document.querySelectorAll('.fstage').forEach(s=>s.classList.toggle('on',+s.dataset.i===i));}
fsay(0);$('#funnel').onclick=e=>{const s=e.target.closest('.fstage');if(s)fsay(+s.dataset.i);};

const WALK=[['Asset gatherers','a house that sells more than it invests'],['One-strategy stars with five strategies','attention divided is alpha divided'],['Fees above the market','with no performance link'],['Fewer than 12 stocks','conviction is fine, concentration is a bet'],['Cash calls','timing is our job, not the fund’s'],['Model portfolios built to sell','not in-house research'],['Team turnover','the record leaves with the people']];
$('#walk').innerHTML=WALK.map(w=>`<div><i>×</i><span><b>${w[0]}</b> · ${w[1]}</span></div>`).join('');
// ---- two managers ----
const PAIRS={flexi:{label:'Flexi cap',intro:'Two real flexi cap funds from the feed, names removed. Same three-year return. Which would you hire?',A:{name:'Manager A',sub:'flexi cap · INR 7,000 cr',ret1:20.0,ret3:17.6,ret5:16.2,hit:98.4,dd:-24.0,down:104.8,vol:19.6,flow:-15.3,cash:18.1,ten:21.0},B:{name:'Manager B',sub:'flexi cap · INR 1,01,800 cr',ret1:6.7,ret3:17.6,ret5:18.4,hit:77.4,dd:-12.4,down:69.6,vol:13.1,flow:34.1,cash:7.3,ten:3.1},why:'Both made 17.6% a year over three years, but A did it with a 24% fall, 18% parked in cash and money leaving. The one honest flag on B is size: INR 1 lakh crore with a third of it new in a year, which is exactly what the relook flags on the right are for.'},
 large:{label:'Large cap',intro:'Two real large cap funds, names removed. A has the better one- and three-year numbers. Which would you hire?',A:{name:'Manager A',sub:'large cap · INR 3,300 cr',ret1:12.9,ret3:15.9,ret5:null,hit:100,dd:-20.1,down:97.9,vol:17.9,flow:16.8,cash:26.1,ten:21.0},B:{name:'Manager B',sub:'large cap · INR 51,700 cr',ret1:2.7,ret3:13.3,ret5:14.6,hit:75.8,dd:-14.3,down:91.1,vol:14.1,flow:24.4,cash:0.8,ten:19.0},why:'A leads on every return line, and sits a quarter in cash to do it: a large cap fund that is only three-quarters invested is making a market call the client did not ask for. B stayed invested, fell less, and has had the same manager for nineteen years.'}};
let pairKey='flexi';let MG=PAIRS[pairKey];
const CH=[['Consistent against the benchmark',m=>m.hit>=70,m=>`${n(m.hit,0)}% of 3-yr windows ahead`],['Drawdown no worse than the market',m=>m.dd>-16,m=>`${n(m.dd)}% worst fall`],['Loses less when the market falls',m=>m.down<95,m=>`${n(m.down,0)}% downside capture`],['Volatility in line with the market',m=>m.vol<16,m=>`${n(m.vol)}% a year`],['Stays invested, no cash calls',m=>m.cash<10,m=>`${n(m.cash,0)}% in cash`],['Size not outrunning the strategy',m=>m.flow<30,m=>`${sign(m.flow,0)}% net flows in a year`],['Same hands for years',m=>m.ten>=3,m=>`${n(m.ten)} yrs on the fund`]];
function drawGame(){MG=PAIRS[pairKey];$('#game').innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><p style="margin:0 0 4px;font-size:13.5px;line-height:1.45">${MG.intro} Pick one, then watch the framework decide.</p><span class="periods" id="pairpick" style="margin:0;flex:none">${Object.keys(PAIRS).map(k=>`<span class="${k===pairKey?'on':''}" data-k="${k}">${PAIRS[k].label}</span>`).join('')}</span></div><div class="duel">${['A','B'].map(k=>{const m=MG[k];return `<div class="mgr" data-k="${k}"><span class="badge"></span><h3>${m.name}</h3><div class="sub">${m.sub}</div><dl><dt>1-year return</dt><dd class="num">${sign(m.ret1)}%</dd><dt>3-year return, a year</dt><dd class="num">${sign(m.ret3)}%</dd><dt>5-year return, a year</dt><dd class="num">${m.ret5==null?'under 5 yrs old':sign(m.ret5)+'%'}</dd></dl></div>`;}).join('')}</div><div class="checks" id="checks"><div class="hd"><span>What we check</span><span class="r">A</span><span class="r">B</span></div>${CH.map(c=>`<div><span>${c[0]}<small style="display:block;color:var(--s_shade);font-size:11.5px">A ${c[2](MG.A)} · B ${c[2](MG.B)}</small></span><span class="r ${c[1](MG.A)?'y':'n'}">${c[1](MG.A)?'✓':'✗'}</span><span class="r ${c[1](MG.B)?'y':'n'}">${c[1](MG.B)?'✓':'✗'}</span></div>`).join('')}</div><div class="verdict" id="verdict"></div>`;
  document.querySelectorAll('.mgr').forEach(el=>el.onclick=()=>reveal(el.dataset.k));$('#pairpick').onclick=e=>{const s=e.target.closest('span');if(!s)return;pairKey=s.dataset.k;drawGame();};}
function reveal(pick){document.querySelectorAll('.mgr').forEach(el=>{el.classList.toggle('pick',el.dataset.k===pick);el.onclick=null;});const rows=[...document.querySelectorAll('#checks>div:not(.hd)')];const delay=proposed()?260:0;
  rows.forEach((r,i)=>setTimeout(()=>r.classList.add('show'),i*delay));
  setTimeout(()=>{const a=CH.filter(c=>c[1](MG.A)).length,b=CH.filter(c=>c[1](MG.B)).length;const win=b>a?'B':'A';document.querySelectorAll('.mgr').forEach(el=>{el.classList.add(el.dataset.k===win?'win':'lose');el.querySelector('.badge').textContent=el.dataset.k===win?'our pick':'passed over';});
    const v=$('#verdict');v.innerHTML=`<b>${pick===win?'You and the framework agree.':'The framework went the other way.'}</b> Manager ${win} passes ${win==='B'?b:a} of ${CH.length} checks to Manager ${win==='B'?'A':'B'}'s ${win==='B'?a:b}. ${MG.why}`;v.classList.add('on');},rows.length*delay+100);}
drawGame();

// ---- red flags ----
const FL=[['Manager change','A lead manager of nine years resigned in March. The fund was placed on watch the same week, the new manager met within a month, and the mandate compared against what was promised. Style drifted towards momentum by the second quarter; the fund was replaced in client portfolios that autumn.','Manager left → watch → met successor → style drifted → replaced'],['Assets doubled','Inflows took a small cap fund from INR 4,000 cr to INR 9,000 cr in fourteen months. The framework says alpha shrinks non-linearly with size. Position sizes and liquidity were re-examined; the fund was capped for fresh money and no new clients were added until the manager closed subscriptions.','Size jump → liquidity check → capped for fresh money'],['Style drift','A value mandate started holding the same high-multiple names as growth peers. Attribution showed returns now came from re-rating, not earnings. The manager was asked to explain; the answer did not match the stated philosophy, and the fund was moved to a relook.','Attribution → does not match the philosophy → relook'],['Sharp underperformance','A fund fell behind its benchmark for eight straight months. That alone is not a trigger; attribution was. The gap came from two stock picks that had halved, not from the strategy. Held, with a written note, and the fund recovered over the next year.','Behind for 8 months → attribution → stock-specific → held'],['New strategies launched','A PMS manager launched two more strategies and an AIF in a year. Bandwidth was the concern, not performance. Team additions were checked; the core team had not grown. Weight was trimmed until it had.','Three launches → team unchanged → trimmed'],['Governance','A regulatory inspection at the fund house became public. Nothing had been proven, but the checklist treats it as a checkpoint. No new money, a call with the compliance head, and the position was reviewed monthly until closure.','Inspection → no new money → monthly review'],['Hype exposure','The portfolio’s weight in recently listed, loss-making names rose to 14%. Illiquidity and valuation risk had gone up without the return profile changing. The manager was asked for a ceiling; one was set at 8%.','Hype names at 14% → ceiling agreed at 8%'],['Fee change','A fund raised its expense ratio at the same time as a lower-cost peer with similar holdings appeared. Not a red flag on its own, but the framework wants fees at market. Clients were moved to the peer at the next rebalance.','Fee up → peer at market → switched at rebalance'],['Cash calls','A manager moved 22% to cash on a market view. The mandate is to be invested; timing is our call, not the fund’s. Flagged, discussed, and the fund was passed over for new allocations.','22% cash → mandate breach → passed over']];
$('#flags').innerHTML=FL.map((f,i)=>`<div class="flag ${i===0?'on':''}" data-i="${i}"><i></i>${f[0]}</div>`).join('');
function story(i){$('#story').innerHTML=`<b>${FL[i][0]}</b>${FL[i][1]}<div class="step"><span>The chain</span><span>${FL[i][2]}</span></div><em>A hypothetical episode written to show the process, not a record of a named fund.</em>`;document.querySelectorAll('.flag').forEach(s=>s.classList.toggle('on',+s.dataset.i===i));}
story(0);$('#flags').onclick=e=>{const s=e.target.closest('.flag');if(s)story(+s.dataset.i);};

// ---- house view ----
const H=D.hv;
$('#hvcall').innerHTML=`<div><span class="tag ondark">${H.edition} · the call</span><h3>${esc(H.headline)}</h3><div class="order">Preferred order by size <b>${esc(H.capOrder)}</b></div></div><div class="recap"><div><span class="k">${H.recap.q} · Nifty 50</span><div class="v num">${H.recap.nifty}</div></div><div><span class="k">BSE 500</span><div class="v num">${H.recap.bse500}</div></div><div><span class="k">Midcap · Smallcap</span><div class="v num">${H.recap.mid} · ${H.recap.small}</div></div><div><span class="k">Flows</span><div class="v num" style="font-size:15px;line-height:1.3;margin-top:4px">FIIs sold INR 1.5 tn<br>DIIs bought INR 2.19 tn</div></div></div>`;
const arrow=c=>c==='='?'<span style="color:var(--s_shade)">unchanged</span>':c==='up'?'<span style="color:var(--up)">raised ↑</span>':'<span style="color:var(--down)">lowered ↓</span>';
$('#stance').innerHTML=`<colgroup><col class="b"><col class="s"><col class="c"><col class="r"><col></colgroup><thead><tr><th>Bucket</th><th class="c">Stance</th><th>Change</th><th>Indicative</th><th>Why</th></tr></thead><tbody>${H.stance.map(s=>`<tr><td><b style="font-family:var(--font_primary)">${esc(s.bucket)}</b><small>${esc(s.role)}</small></td><td class="c"><span class="st ${s.stance}">${s.stance}</span></td><td>${arrow(s.change)}</td><td class="num">${s.ret} a yr</td><td style="color:var(--s_dark);font-size:12.5px">${esc(s.note)}</td></tr>`).join('')}</tbody>`;
$('#hist').innerHTML=`<span></span>${H.history.quarters.map(q=>`<span class="q">${q}</span>`).join('')}${H.stance.map(s=>s.bucket).filter(k=>H.history[k]).map(k=>`<span class="b">${esc(k)}</span>${H.history[k].map(s=>`<span class="c ${s}">${s}</span>`).join('')}`).join('')}`;
const V=H.valuation;const ey=100/V.niftyFwdPE;
function gauge(lbl,val,marks,min,max,unit){const pct=v=>((v-min)/(max-min)*100).toFixed(1)+'%';return `<div class="gauge"><div class="lbl"><span>${lbl}</span><b class="num">${val}${unit||''}</b></div><div class="tr"><div class="mk now" style="left:${pct(val)}"><span>now</span></div>${marks.map(m=>`<div class="mk" style="left:${pct(m[1])}"><span>${m[0]} ${m[1]}${unit||''}</span></div>`).join('')}</div></div>`;}
$('#gauge-foot').textContent=`The Nifty 50 at ${V.niftyLevel} trades below its own five-year average multiple; the broader market does not. Earnings yield still sits under the bond yield, so the case rests on earnings growth, not re-rating.`;
$('#gauges').innerHTML=gauge('Nifty 50 forward P/E',V.niftyFwdPE,[['5-yr avg',V.avg5y]],14,24,'x')+gauge('NSE 500 forward P/E',V.nse500FwdPE,[['Nifty 50',V.niftyFwdPE]],14,26,'x')+gauge('Earnings yield',+ey.toFixed(2),[['10-yr bond',V.bond10y]],4,8,'%');
function drawScatter(){const W=640,H2=300,L=44,R=16,T=18,B=38;const xs=H.sectors.map(s=>s[2]),ys=H.sectors.map(s=>s[1]);const xmin=Math.min(...xs)-5,xmax=Math.max(...xs)+5,ymin=0,ymax=Math.max(...ys)+4;
  const x=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R),y=v=>T+(ymax-v)/(ymax-ymin)*(H2-T-B);const nifty=H.sectors.find(s=>s[0]==='Nifty 50');
  $('#scatter').innerHTML=`<svg class="chart" viewBox="0 0 ${W} ${H2}" style="aspect-ratio:${W}/${H2}"><rect x="${L}" y="${T}" width="${x(0)-L}" height="${y(nifty[1])-T}" fill="var(--p_dim)"/><line x1="${x(0)}" x2="${x(0)}" y1="${T}" y2="${H2-B}" stroke="var(--s_shade)" stroke-dasharray="3 3"/><line x1="${L}" x2="${W-R}" y1="${y(nifty[1])}" y2="${y(nifty[1])}" stroke="var(--s_shade)" stroke-dasharray="3 3"/><text class="quad" x="${L+6}" y="${T+12}">Cheaper than usual · faster growth</text><text class="quad" x="${W-R-6}" y="${T+12}" text-anchor="end">Dearer · faster growth</text><text class="quad" x="${L+6}" y="${H2-B-6}">Cheaper · slower</text><text class="quad" x="${W-R-6}" y="${H2-B-6}" text-anchor="end">Dearer · slower</text>${[-30,-20,-10,0,10].filter(t=>t>xmin&&t<xmax).map(t=>`<text x="${x(t)}" y="${H2-B+14}" text-anchor="middle">${t>0?'+':''}${t}%</text>`).join('')}<text x="${W/2}" y="${H2-4}" text-anchor="middle">Forward P/E versus own 5-year average</text>${[0,10,20,30].filter(t=>t<ymax).map(t=>`<text x="${L-6}" y="${y(t)+4}" text-anchor="end">${t}%</text>`).join('')}<text transform="translate(12 ${H2/2}) rotate(-90)" text-anchor="middle">12-month forward earnings growth</text>${H.sectors.map((s,i)=>`<circle data-i="${i}" cx="${x(s[2])}" cy="${y(s[1])}" r="${s[0]==='Nifty 50'?6:5}" fill="${s[0]==='Nifty 50'?'var(--red)':'var(--p)'}" fill-opacity="${s[0]==='Nifty 50'?1:.85}"/><text x="${x(s[2])+8}" y="${y(s[1])+4}">${esc(s[0].replace('Nifty ','').replace('BSE ',''))}</text>`).join('')}</svg><div class="tip" id="tip"></div>`;
  $('#scatter').onmousemove=e=>{const c=e.target.closest('circle');const tip=$('#tip');if(!c){tip.classList.remove('on');return;}const s=H.sectors[+c.dataset.i];tip.innerHTML=`<b>${esc(s[0])}</b>earnings growth ${sign(s[1])}% · P/E ${sign(s[2],0)}% vs 5-yr average`;const r=$('#scatter').getBoundingClientRect();tip.style.left=(e.clientX-r.left+12)+'px';tip.style.top=(e.clientY-r.top-34)+'px';tip.classList.add('on');};
  $('#sector-view').innerHTML=`<b style="font-weight:500;color:var(--p)">The view.</b> ${esc(H.sectorView)}`;}
drawScatter();
$('#factors').innerHTML=H.factors.map(f=>`<div><i class="${f[2]}"></i><div><b>${esc(f[0])}</b><span>${esc(f[1])}</span></div></div>`).join('');
$('#prov').innerHTML=`Index prices from NSE via Yahoo to ${dmy(D.asOf)}, price only, refreshed nightly. Sensex history via Bloomberg to 30 Sep 2025. House View Q2FY27, data to 30 Jun 2026. India figures from IMF, RBI, AMFI and SEBI releases, Sep 2026. Indicative returns are not forecasts.`;

// ---- modals ----
const X='';
function heat(t){return `<div class="heat"><div class="r hd"><span></span>${Array.from({length:25},(_,i)=>`<span>${i+1}</span>`).join('')}</div>${D.matrix.map(r=>`<div class="r"><span>${r.year}</span>${r.cells.map(c=>c===''?'<span class="blank"></span>':`<span class="${+c>=t?'hit':'miss'}">${c}</span>`).join('')}</div>`).join('')}</div>`;}
const MODALS={
  quilt:()=>`<div class="top"><div><span class="tag">Calendar years</span><h2>Every year, every index</h2><p class="sub">Total return, dividends reinvested. 2026 is to ${dmy(D.asOf)}.</p></div>${X}</div><table><thead><tr><th>Index</th>${QY.map(y=>`<th>${y}</th>`).join('')}<th>Led</th></tr></thead><tbody>${QN.map(k=>{const wins=QY.filter(y=>QN.every(o=>D.quilt[o][y]<=D.quilt[k][y])).length;return `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${QCOL[k]};margin-right:8px"></i>${esc(k)}</td>${QY.map(y=>{const v=D.quilt[k][y];return `<td class="num ${v<0?'down':''}">${sign(v)}%</td>`;}).join('')}<td class="num">${wins} of ${QY.length}</td></tr>`;}).join('')}</tbody></table>`,
  matrix:()=>`<div class="top"><div><span class="tag">The full grid</span><h2>Start year down, years held across</h2><p class="sub">Annualised Sensex return for every combination. Navy cells clear the threshold.</p></div>${X}</div><div style="display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;margin-bottom:10px"><input type="range" id="thr" min="0" max="20" step="1" value="10"><div class="big num" id="thr-v">10%<small>a year</small></div></div><div id="heat"></div>`,
  landscape:()=>`<div class="top"><div><span class="tag">What to expect</span><h2>Indicative returns by vehicle and bucket</h2><p class="sub">House View Q2FY27, 18 to 24 month horizon. Ranges, not forecasts.</p></div>${X}</div><div class="tiles two">${D.landscape.map(v=>`<div class="tile"><b style="font-weight:400;font-family:var(--font_primary);color:var(--p)">${esc(v.vehicle)}</b><dl class="kv">${v.buckets.map(b=>`<dt>${esc(b[0])}</dt><dd class="num">${b[1]}</dd>`).join('')}</dl></div>`).join('')}</div>`,
};
const AFTER={matrix:()=>{const upd=()=>{const t=+$('#thr').value;$('#thr-v').innerHTML=`${t}%<small>a year</small>`;$('#heat').innerHTML=heat(t);};upd();$('#thr').oninput=upd;}};
function openOv(code,card){openModal(`<div class="ovm">${MODALS[code]()}</div>`,card);if(AFTER[code])AFTER[code]();}
host.querySelectorAll('[data-modal]').forEach(c=>{c.onclick=()=>openOv(c.dataset.modal,c);c.onkeydown=(e)=>{if((e.key==='Enter'||e.key===' ')&&e.target===c){e.preventDefault();openOv(c.dataset.modal,c);}};});


}
