const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const initSqlJs = require('sql.js');

const ENV_FILES = [
  path.join(__dirname, '.env'),
  path.join(__dirname, 'config', '.env')
];
for (const f of ENV_FILES) { if (fs.existsSync(f)) dotenv.config({ path: f, override: false }); }
function cleanEnvValue(v) {
  if (v == null) return '';
  return String(v).trim().replace(/^\"|\"$/g,'').replace(/^'|'$/g,'');
}
const PORT = Number(process.env.PORT || 3000);
const REEF_KEY = cleanEnvValue(process.env.REEF_KEY || process.env.REEF_API_KEY || process.env.REEFAPI_KEY || '');
const MAX_PAGES = Math.min(10, Math.max(1, Number(process.env.REEF_MAX_PAGES || 1)));
const DEFAULT_INTERVAL = Math.max(0, Number(process.env.SCAN_INTERVAL_MINUTES || 60));
const DEFAULT_BATCH = Math.min(54, Math.max(1, Number(process.env.SCAN_CATEGORIES_PER_CYCLE || 12)));
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'fiyatnabiz.sqlite');
fs.mkdirSync(DATA_DIR, { recursive: true });

const CATEGORIES = [
['Cep Telefonu','cep telefonu'],['Yenilenmiş Telefon','yenilenmiş cep telefonu'],['Tablet','tablet'],['Akıllı Saat','akıllı saat'],['Akıllı Bileklik','akıllı bileklik'],['Laptop','laptop'],['Notebook','notebook bilgisayar'],['Masaüstü Bilgisayar','masaüstü bilgisayar'],['Mini PC','mini pc'],['Monitör','monitör'],['Ekran Kartı','ekran kartı'],['İşlemci','işlemci'],['Anakart','anakart'],['RAM','ram bellek'],['SSD','ssd'],['HDD','harddisk'],['Bilgisayar Kasası','bilgisayar kasası'],['Güç Kaynağı','power supply güç kaynağı'],['Soğutma','işlemci soğutucu sıvı soğutma'],['Klavye','klavye'],['Mouse','mouse'],['Webcam','webcam'],['Mikrofon','mikrofon'],['Kulaklık','kulaklık'],['Hoparlör','bluetooth hoparlör'],['Ses Sistemleri','ses sistemi soundbar'],['Televizyon','televizyon'],['Projeksiyon','projeksiyon'],['Kamera','fotoğraf makinesi'],['Aksiyon Kamera','aksiyon kamera'],['Güvenlik Kamera','güvenlik kamerası'],['Drone','drone'],['Oyun Konsolu','oyun konsolu'],['Oyun Aksesuarları','oyuncu ekipmanları'],['Oyun Kumandası','oyun kolu'],['Powerbank','powerbank'],['Şarj Cihazı','şarj cihazı adaptör'],['Kablo','usb kablo type c kablo'],['Telefon Aksesuarları','telefon aksesuarları'],['Network','modem router wifi'],['Mesh Sistem','mesh wifi'],['Switch','network switch'],['Yazıcı','yazıcı'],['Tarayıcı','tarayıcı scanner'],['Kartuş Toner','kartuş toner'],['USB Bellek','usb bellek flash disk'],['Hafıza Kartı','hafıza kartı micro sd'],['Harici Disk','harici harddisk'],['Akıllı Ev','akıllı ev ürünleri'],['Akıllı Aydınlatma','akıllı ampul akıllı aydınlatma'],['Robot Süpürge','robot süpürge'],['Elektrikli Süpürge','dikey süpürge elektrikli süpürge'],['Ev Elektroniği','ev elektroniği'],['Elektronik Hobi','elektronik hobi']
].map(([name,query])=>({name,query}));

const SOURCE_DEFAULTS = {
  trendyol: true,
  amazon: true,
  hepsiburada: true,
  akakce: false,
  cimri: false
};

let SQL, db, scanning = false, lastScan = null, lastError = null, timer = null, cycleTimer = null;
let settings = { interval: DEFAULT_INTERVAL, batch: DEFAULT_BATCH, sources: {...SOURCE_DEFAULTS} };

function saveDb(){ fs.writeFileSync(DB_FILE, Buffer.from(db.export())); }
function run(sql,p={}){ db.run(sql,p); }
function all(sql,p={}){ const st=db.prepare(sql); try{st.bind(p);const r=[];while(st.step())r.push(st.getAsObject());return r;}finally{st.free();} }
function one(sql,p={}){return all(sql,p)[0]||null;}
function normalizePrice(v){
  if(typeof v==='number'&&Number.isFinite(v)) return v;
  if(v==null) return null;
  let s=String(v).replace(/\s/g,'').replace(/TL|TRY|₺/gi,'');
  if(!s) return null;
  if(s.includes('.')&&s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  else if(/\d+\.\d{3}$/.test(s)) s=s.replace(/\./g,'');
  else s=s.replace(',','.');
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function first(obj, keys){ for(const k of keys){ const v=obj?.[k]; if(v!==undefined&&v!==null&&v!=='') return v; } return null; }
function arrFrom(data){
  if(Array.isArray(data)) return data;
  for(const k of ['results','products','items','offers','data']) if(Array.isArray(data?.[k])) return data[k];
  return [];
}
function loadSettings(){
  const row=one(`SELECT value FROM settings WHERE key='app'`); if(!row) return;
  try{ const x=JSON.parse(row.value); settings={...settings,...x,sources:{...settings.sources,...(x.sources||{})}}; }catch{}
}
function saveSettings(){
  run(`INSERT INTO settings(key,value) VALUES('app',:v) ON CONFLICT(key) DO UPDATE SET value=:v`,{':v':JSON.stringify(settings)}); saveDb();
}
async function initDb(){
  SQL=await initSqlJs({locateFile:f=>path.join(__dirname,'node_modules','sql.js','dist',f)});
  db=fs.existsSync(DB_FILE)?new SQL.Database(fs.readFileSync(DB_FILE)):new SQL.Database();
  run(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,marketplace TEXT NOT NULL,external_id TEXT NOT NULL,title TEXT NOT NULL,brand TEXT,url TEXT,image TEXT,category TEXT,current_price REAL,list_price REAL,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,UNIQUE(marketplace,external_id))`);
  run(`CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,price REAL NOT NULL,recorded_at TEXT NOT NULL,scan_id TEXT NOT NULL,FOREIGN KEY(product_id) REFERENCES products(id))`);
  run(`CREATE INDEX IF NOT EXISTS idx_price_history_product_time ON price_history(product_id,recorded_at)`);
  run(`CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,found INTEGER DEFAULT 0,saved INTEGER DEFAULT 0,opportunities INTEGER DEFAULT 0,status TEXT DEFAULT 'running',error TEXT,source TEXT,category_count INTEGER DEFAULT 0)`);
  run(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`);
  loadSettings(); saveSettings();
}
async function reefPost(api,action,body){
  if(!REEF_KEY) throw new Error('REEF_KEY tanımlı değil. .env dosyasını kontrol edin.');
  const r=await fetch(`https://api.reefapi.com/${api}/v1/${action}`,{method:'POST',headers:{'x-api-key':REEF_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok) throw new Error(j?.error?.message||j?.error?.code||j?.error||`ReefAPI HTTP ${r.status}`);
  return j.data;
}
function normalizeMarketplaceItem(item, source, category){
  const title=first(item,['title','name','product_name']);
  const price=normalizePrice(first(item,['price_value','current_price','price','lowest_price','sale_price']));
  const list=normalizePrice(first(item,['list_price','regular_price','old_price','rrp']));
  const id=String(first(item,['content_id','asin','product_id','id','sku','ean','url'])||'');
  if(!title||!id||price==null||price<0) return null;
  return {marketplace:source,title,external_id:id,brand:first(item,['brand','brand_name'])||'',url:first(item,['url','product_url','comparison_url','link'])||'',image:first(item,['image','image_url','thumbnail','thumbnail_url'])||'',category,price,list_price:list};
}
async function searchSource(source,query,category){
  if(source==='trendyol'){
    const d=await reefPost('trendyol','search',{query,page:1,max_pages:MAX_PAGES}); return arrFrom(d).map(x=>normalizeMarketplaceItem(x,'Trendyol',category)).filter(Boolean);
  }
  if(source==='amazon'){
    const d=await reefPost('amazon','search',{query,page:1,max_pages:MAX_PAGES}); return arrFrom(d).map(x=>normalizeMarketplaceItem(x,'Amazon',category)).filter(Boolean);
  }
  if(source==='hepsiburada'){
    const d=await reefPost('hepsiburada','search',{query,page:1,max_pages:MAX_PAGES}); return arrFrom(d).map(x=>normalizeMarketplaceItem(x,'Hepsiburada',category)).filter(Boolean);
  }
  if(source==='akakce'||source==='cimri'){
    const d=await reefPost('price-compare','search',{query,source,page:1}); return arrFrom(d).map(x=>normalizeMarketplaceItem(x,source==='akakce'?'Akakçe':'Cimri',category)).filter(Boolean);
  }
  return [];
}
function upsertProduct(x,now){
  const existing=one(`SELECT * FROM products WHERE marketplace=:m AND external_id=:e`,{':m':x.marketplace,':e':x.external_id});
  if(!existing){run(`INSERT INTO products(marketplace,external_id,title,brand,url,image,category,current_price,list_price,first_seen_at,last_seen_at) VALUES(:m,:e,:t,:b,:u,:i,:c,:p,:lp,:n,:n)`,{':m':x.marketplace,':e':x.external_id,':t':x.title,':b':x.brand,':u':x.url,':i':x.image,':c':x.category,':p':x.price,':lp':x.list_price,':n':now});}
  else run(`UPDATE products SET title=:t,brand=:b,url=:u,image=:i,category=:c,current_price=:p,list_price=:lp,last_seen_at=:n WHERE id=:id`,{':id':existing.id,':t':x.title,':b':x.brand||existing.brand||'',':u':x.url||existing.url||'',':i':x.image||existing.image||'',':c':x.category||existing.category||'',':p':x.price,':lp':x.list_price,':n':now});
  return one(`SELECT * FROM products WHERE marketplace=:m AND external_id=:e`,{':m':x.marketplace,':e':x.external_id});
}
function previousSnapshot(id,scanId){return one(`SELECT price,recorded_at FROM price_history WHERE product_id=:id AND scan_id<>:s ORDER BY recorded_at DESC,id DESC LIMIT 1`,{':id':id,':s':scanId});}
function snapshot(product,price,scanId,now){run(`INSERT INTO price_history(product_id,price,recorded_at,scan_id) VALUES(:id,:p,:t,:s)`,{':id':product.id,':p':price,':t':now,':s':scanId});}
function opp(product,prev,current){if(!prev||prev.price<=0||current>=prev.price)return null;const d=(prev.price-current)*100/prev.price;return {product_id:product.id,marketplace:product.marketplace,title:product.title,brand:product.brand,url:product.url,image:product.image,category:product.category,old_price:prev.price,new_price:current,drop_pct:Number(d.toFixed(2)),previous_at:prev.recorded_at};}
function selectedCategories(){
  const start=Number(settings.cursor||0)%CATEGORIES.length;
  const batch=Math.min(CATEGORIES.length,Math.max(1,Number(settings.batch)||DEFAULT_BATCH));
  const out=[];
  for(let i=0;i<batch;i++) out.push(CATEGORIES[(start+i)%CATEGORIES.length]);
  settings.cursor=(start+batch)%CATEGORIES.length;
  // Cursor is persisted so the next 12'li parti can continue even after a refresh.
  saveSettings();
  return out;
}
async function scanNow(reason='manual', continueCycle=true){
  if(scanning)return {skipped:true,reason:'Tarama zaten çalışıyor.'}; scanning=true; lastError=null;
  const scanId=new Date().toISOString()+'-'+Math.random().toString(36).slice(2,8), startedAt=new Date().toISOString();
  const cats=selectedCategories(), sources=Object.entries(settings.sources).filter(([,v])=>v).map(([k])=>k);
  run(`INSERT INTO scans(id,started_at,status,source,category_count) VALUES(:id,:t,'running',:s,:c)`,{':id':scanId,':t':startedAt,':s':sources.join(','),':c':cats.length});
  let found=0,saved=0,opportunities=0;
  try{
    for(const cat of cats){
      for(const source of sources){
        try{
          const results=await searchSource(source,cat.query,cat.name); found+=results.length;
          for(const x of results){const now=new Date().toISOString();const p=upsertProduct(x,now);const prev=previousSnapshot(p.id,scanId);snapshot(p,x.price,scanId,now);saved++;if(opp(p,prev,x.price))opportunities++;}
        }catch(e){ lastError=`${source}/${cat.name}: ${e.message}`; console.error(lastError); }
      }
    }
    saveDb(); const finishedAt=new Date().toISOString();
    run(`UPDATE scans SET finished_at=:f,found=:found,saved=:saved,opportunities=:o,status='ok',error=:e WHERE id=:id`,{':id':scanId,':f':finishedAt,':found':found,':saved':saved,':o':opportunities,':e':lastError||''});
    saveDb(); lastScan={id:scanId,startedAt,finishedAt,found,saved,opportunities,reason,categories:cats.map(c=>c.name),sources}; return lastScan;
  }catch(e){lastError=e.message;run(`UPDATE scans SET finished_at=:f,status='error',error=:e WHERE id=:id`,{':id':scanId,':f':new Date().toISOString(),':e':e.message});saveDb();throw e;}
  finally{
    scanning=false;
    // Manuel "Şimdi tara" yalnızca ilk partiyi çalıştırır; kalan partiler
    // arka planda otomatik olarak 5 sn arayla devam eder.
    // Son parti tamamlandığında cursor 0 olur ve tam tur kapanır.
    if(continueCycle && settings.cursor !== 0 && !cycleTimer){
      cycleTimer=setTimeout(async ()=>{
        cycleTimer=null;
        if(scanning) return;
        try{
          await scanNow('cycle-continue', true);
        }catch(e){
          console.error('Döngü devamı:',e.message);
          // Geçici API hatasında döngüyü tamamen öldürme; bir sonraki
          // otomatik zamanlayıcı veya kullanıcı taraması yeniden deneyebilir.
        }
      },5000);
    }
  }
}
function stats(threshold=50){threshold=Math.max(30,Math.min(50,Number(threshold)||50));const p=one(`SELECT COUNT(*) n FROM products`),o=one(`SELECT COUNT(*) n FROM price_history`),c=one(`SELECT COUNT(DISTINCT category) n FROM products`);const cutoff=new Date(Date.now()-3600000).toISOString();const opportunities=all(`SELECT p.id product_id,p.marketplace,p.title,p.brand,p.url,p.image,p.category,prev.price old_price,ph.price new_price,ROUND((prev.price-ph.price)*100.0/prev.price,2) drop_pct,ph.recorded_at detected_at,prev.recorded_at previous_at FROM price_history ph JOIN products p ON p.id=ph.product_id JOIN price_history prev ON prev.id=(SELECT h.id FROM price_history h WHERE h.product_id=ph.product_id AND h.recorded_at<ph.recorded_at ORDER BY h.recorded_at DESC,h.id DESC LIMIT 1) WHERE ph.recorded_at>=:cutoff AND prev.price>0 AND ph.price<prev.price AND ((prev.price-ph.price)*100.0/prev.price)>=:t ORDER BY drop_pct DESC,ph.recorded_at DESC`,{':cutoff':cutoff,':t':threshold});return {products:Number(p.n||0),observations:Number(o.n||0),categories:Number(c.n||0),opportunities,threshold,scanning,lastScan,lastError,settings,categoryList:CATEGORIES.map((x,i)=>({name:x.name,query:x.query,index:i})),sourceStatus:settings.sources};}
function restartTimer(){if(timer)clearInterval(timer);timer=null;if(settings.interval>0){timer=setInterval(()=>{if(!scanning&&REEF_KEY)scanNow('automatic').catch(e=>console.error('Otomatik tarama:',e.message));},settings.interval*60000);}}
const app=express();app.use(express.json());app.use(express.static(path.join(__dirname,'public')));
app.get('/api/status',(req,res)=>{res.json({ok:true,reef_configured:Boolean(REEF_KEY),stats:stats(req.query.threshold)});});
app.post('/api/scan',async(req,res)=>{try{const r=await scanNow('manual');res.json({ok:true,result:r,stats:stats(req.query.threshold)});}catch(e){res.status(500).json({ok:false,error:e.message,stats:stats(req.query.threshold)});}});
app.get('/api/settings',(req,res)=>res.json({ok:true,settings}));
app.post('/api/settings',(req,res)=>{const body=req.body||{};if(body.interval!==undefined)settings.interval=Math.max(0,Math.min(1440,Number(body.interval)||0));if(body.batch!==undefined)settings.batch=Math.max(1,Math.min(CATEGORIES.length,Number(body.batch)||DEFAULT_BATCH));if(body.sources)for(const k of Object.keys(SOURCE_DEFAULTS))if(body.sources[k]!==undefined)settings.sources[k]=Boolean(body.sources[k]);saveSettings();restartTimer();res.json({ok:true,settings});});
app.post('/api/demo', (req,res)=>{const now=Date.now(),old=new Date(now-70*60000).toISOString(),neu=new Date(now-5*60000).toISOString(),a='demo-a-'+now,b='demo-b-'+now;run(`INSERT OR IGNORE INTO products(marketplace,external_id,title,brand,url,image,category,current_price,first_seen_at,last_seen_at) VALUES('Trendyol','demo-rtx-4070','Demo RTX 4070 Ekran Kartı','Demo','https://www.trendyol.com/','','Ekran Kartı',24999,:o,:n)`,{':o':old,':n':neu});const p=one(`SELECT * FROM products WHERE external_id='demo-rtx-4070'`);run(`INSERT INTO price_history(product_id,price,recorded_at,scan_id) VALUES(:id,52000,:t,:s)`,{':id':p.id,':t':old,':s':a});run(`INSERT INTO price_history(product_id,price,recorded_at,scan_id) VALUES(:id,24999,:t,:s)`,{':id':p.id,':t':neu,':s':b});saveDb();res.json({ok:true,stats:stats(req.query.threshold)});});
app.get('/api/history/:id',(req,res)=>res.json({ok:true,rows:all(`SELECT price,recorded_at,scan_id FROM price_history WHERE product_id=:id ORDER BY recorded_at DESC,id DESC LIMIT 200`,{':id':Number(req.params.id)})}));
initDb().then(()=>{app.listen(PORT,()=>console.log(`FiyatNabiz v13.3: http://127.0.0.1:${PORT}`));restartTimer();require('./telegram');}).catch(e=>{console.error(e);process.exit(1);});
