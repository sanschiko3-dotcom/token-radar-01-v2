export function build(s) {
 const base=144/758, buckets=new Map();
 const age=p=>p.listed_at?Math.max(1,(Date.parse(s.as_of)-Date.parse(p.listed_at))/86400000):1000;
 const key=p=>[p.category,p.tvl_usd>=1e8,age(p)>=730].join('|');
 for(const p of s.protocols){const b=buckets.get(key(p))||[0,0];b[0]++;b[1]+=p.mcap_usd!==null?1:0;buckets.set(key(p),b)}
 const live=s.protocols.filter(p=>p.mcap_usd!==null), peers=live.filter(p=>p.mcap_usd>0);
 const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
 const ratio=median(peers.map(p=>Math.log10(p.mcap_usd/p.tvl_usd)));
 const features=p=>[Math.log10(p.tvl_usd),Math.max(-.4,Math.min(.3,(p.change_7d||0)/100)),Math.log10(age(p))];
 const X=peers.map(features), y=peers.map(p=>Math.log10(p.mcap_usd));
 const mu=[0,1,2].map(j=>X.reduce((s,x)=>s+x[j],0)/X.length),sd=mu.map((m,j)=>Math.sqrt(X.reduce((s,x)=>s+(x[j]-m)**2,0)/X.length)||1);
 const Z=X.map(x=>[1,...x.map((v,j)=>(v-mu[j])/sd[j])]);
 const A=[0,1,2,3].map(j=>[... [0,1,2,3].map(k=>Z.reduce((s,x)=>s+x[j]*x[k],0)+(j===k&&j>0?40:0)),Z.reduce((s,x,i)=>s+x[j]*y[i],0)]);
 for(let j=0;j<4;j++){let v=A[j][j];for(let k=j;k<5;k++)A[j][k]/=v;for(let i=0;i<4;i++)if(i!==j){v=A[i][j];for(let k=j;k<5;k++)A[i][k]-=v*A[j][k]}}
 const beta=A.map(r=>r[4]), predict=p=>beta[0]+features(p).reduce((s,v,j)=>s+beta[j+1]*(v-mu[j])/sd[j],0);
 const adj=new Map();for(const c of new Set(peers.map(p=>p.category))){const r=peers.filter(p=>p.category===c).map(p=>Math.log10(p.mcap_usd)-predict(p));if(r.length>=3)adj.set(c,Math.round(Math.max(-.2,Math.min(.2,median(r)*r.length/(r.length+4)))*1e4)/1e4)}
 const rows=s.protocols.filter(p=>s.watchlist.includes(p.slug)||(p.mcap_usd===null&&!p.gecko_id&&!p.symbol&&!['Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC','CEX'].includes(p.category)&&!/\b(wrapped|staked|staking)\b|\s([vV]\d+(\.\d+)?|\d+\.\d+)$|^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i.test(p.name))).map(p=>{
 const b=buckets.get(key(p)), odds=Math.max(.05,Math.min(.95,(b[1]+20*base)/(b[0]+20))), fitted=Math.round(10**(predict(p)+(adj.get(p.category)||0))), value=Math.max(1,Math.round(fitted*odds));
 const deposit=250, fees=p.chains.includes('Ethereum')?14:3, hours=2, reward=value*.00002, net=reward-fees-5;
 return {...p,odds,bucket:key(p),peer_count:b[0],peer_listed:b[1],fitted,implied_value_usd:value,deposit,fees,hours,net,net_hour:net/hours,verdict:net/hours>=10?'FARM':net>0?'THIN':'SKIP',own_token_share:1,comparables:peers.filter(q=>q.category===p.category).slice(0,3),farm_steps:[`Verify ${p.name} official deployment and eligibility; no allocation is guaranteed.`,`Deposit $250 on ${p.chains[0]||'supported chain'} only after reviewing withdrawal and contract risks.`,`Use its ${p.category||'protocol'} product once weekly for four weeks; budget two hours and $${fees} in transaction fees.`,`Withdraw a small amount first; stop if fees exceed the budget or eligibility remains unverified.`]};
 }).sort((a,b)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug));
 rows.forEach((r,i)=>r.rank=i+1);return {rows,live,ratio};
}
