// 記帳本：離線快取＋繳費通知
const C='ledger-v3';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-192.png','icon-512.png'])))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const same=new URL(r.url).origin===location.origin;
  if(same&&/rules\.json/.test(r.url))return; /* 級距檔每次都抓最新 */
  e.respondWith(fetch(r).then(res=>{if(res.ok&&(same||r.url.includes('cdnjs')||r.url.includes('jsdelivr'))){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})
    .catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});

/* ---------- 繳費通知 ---------- */
/* App 開啟時會把「近期要繳的款項」寫進 IndexedDB，這裡在背景讀出來，時間到就跳通知 */
function idb(){return new Promise((res,rej)=>{const q=indexedDB.open('ledger-notify',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function kvGet(k){const d=await idb();return new Promise(r=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)})}
async function kvSet(k,v){const d=await idb();return new Promise(r=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=()=>r();t.onerror=()=>r()})}
const pad=n=>String(n).padStart(2,'0'),ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const money=n=>'$'+Math.round(n).toLocaleString('zh-TW');
async function checkDue(force){
  const cfg=await kvGet('due');if(!cfg||!cfg.enabled||!cfg.items)return 0;
  const sent=(await kvGet('sent'))||{},td=ymd(new Date()),t0=new Date(td+'T00:00:00');
  const before=(cfg.before||[3,1,0]).map(Number);
  const groups={};
  for(const it of cfg.items){
    const diff=Math.round((new Date(it.date+'T00:00:00')-t0)/864e5);
    if(diff<0)continue;
    const stage=before.filter(b=>diff<=b).sort((a,b)=>a-b)[0];
    if(stage==null)continue;
    const sk=`${it.key}|${stage}`;if(sent[sk]&&!force)continue;
    (groups[it.date]||={diff,list:[],keys:[]}).list.push(it);groups[it.date].keys.push(sk);
  }
  let n=0;
  for(const date of Object.keys(groups).sort()){
    const g=groups[date],tot=g.list.reduce((s,x)=>s+(+x.amt||0),0),md=`${+date.slice(5,7)}/${+date.slice(8)}`;
    const when=g.diff===0?'今天':g.diff===1?'明天':`${g.diff} 天後`;
    await self.registration.showNotification(`${when}（${md}）有 ${g.list.length} 筆要繳${tot?`，共 ${money(tot)}`:''}`,{
      body:g.list.map(x=>`${x.title}${x.amt?` ${money(x.amt)}`:''}`).join('\n'),
      tag:'due-'+date,renotify:true,icon:'icon-192.png',badge:'icon-192.png',data:{url:'./'}});
    g.keys.forEach(k=>sent[k]=td);n++;
  }
  for(const k of Object.keys(sent))if(sent[k]<ymd(new Date(Date.now()-60*864e5)))delete sent[k];
  await kvSet('sent',sent);await kvSet('lastCheck',Date.now());
  return n;
}
self.addEventListener('periodicsync',e=>{if(e.tag==='due-check')e.waitUntil(checkDue())});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='check-due')e.waitUntil(checkDue(!!e.data.force))});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if('focus' in c)return c.focus()}
    return self.clients.openWindow(e.notification.data&&e.notification.data.url||'./');
  }));
});
