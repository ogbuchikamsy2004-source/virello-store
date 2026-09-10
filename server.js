const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require ('fs');
const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'virello.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true});
const db = new Database(dbPath);


app.use(express.json({limit:'2mb'}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET',
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:1000*60*60*8}
}));

function now(){ return new Date().toISOString(); }
function id(){ return crypto.randomUUID(); }
function reference(){ return 'VIR-' + Date.now().toString().slice(-8) + '-' + crypto.randomInt(100,1000); }

const defaultState={
  settings:{businessName:'Virello Store',email:'placeholder@example.com',phone:'',whatsapp:'',instagram:''},
  content:{headline:'Quality products. A simple way to shop.',text:'Self satisfaction above other things. Browse our products, place your order and keep your reference number to track it.',cta:"Let's Dive In",promise:'A smooth shopping experience from product selection to delivery.',stat1:'2K+',stat1Label:'Orders',stat2:'100+',stat2Label:'Delivery / Service',stat3:'100%',stat3Label:'Delivery Satisfaction'},
  products:[
    {id:'p1',name:'Premium Collection Item',price:25000,category:'Featured',description:'A placeholder product. Replace this with your real product information from the Admin Portal.',image:'',availability:'Available'},
    {id:'p2',name:'Signature Collection Item',price:35000,category:'Featured',description:'A placeholder product. Replace this with your real product information from the Admin Portal.',image:'',availability:'Available'},
    {id:'p3',name:'Classic Collection Item',price:18000,category:'Classic',description:'A placeholder product. Replace this with your real product information from the Admin Portal.',image:'',availability:'Available'}
  ],
  reviews:[{id:'r1',name:'Customer Review',rating:5,text:'Placeholder review — replace with a real customer review or clearly identify admin-created content.',date:now()}],
  rules:'Ordering, delivery, returns/exchanges, cancellations and payment policies will be published here by the business owner. Please confirm the final business policies before publishing them.'
};

function init(){
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,price REAL NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,image TEXT,availability TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY,name TEXT NOT NULL,rating INTEGER NOT NULL,text TEXT NOT NULL,date TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,customerName TEXT NOT NULL,phone TEXT NOT NULL,delivery TEXT NOT NULL,items TEXT NOT NULL,total REAL NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL);`);
  const count=db.prepare('SELECT COUNT(*) c FROM settings').get().c;
  if(!count){
    const insert=db.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
    const s=db.transaction(()=>{ for(const [k,v] of Object.entries({...defaultState.settings, rules:defaultState.rules, content:JSON.stringify(defaultState.content)})) insert.run(k,typeof v==='string'?v:JSON.stringify(v)); }); s();
  }
  const pc=db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if(!pc){ const ins=db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)'); const tx=db.transaction(()=>defaultState.products.forEach(p=>ins.run(p.id,p.name,p.price,p.category,p.description,p.image,p.availability))); tx(); }
  const rc=db.prepare('SELECT COUNT(*) c FROM reviews').get().c;
  if(!rc){ const ins=db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?)'); const tx=db.transaction(()=>defaultState.reviews.forEach(r=>ins.run(r.id,r.name,r.rating,r.text,r.date))); tx(); }
  if(!process.env.ADMIN_PASSWORD_HASH){
    const hash=bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'CHANGE-ME-NOW',12);
    db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run('adminPasswordHash',hash);
  }
  if(!db.prepare('SELECT value FROM settings WHERE key=?').get('adminUsername')) db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('adminUsername','admin');
}
init();

function setting(k){ const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r?.value; }
function publicState(){
  const settings={businessName:setting('businessName')||'Virello Store',email:setting('email')||'',phone:setting('phone')||'',whatsapp:setting('whatsapp')||'',instagram:setting('instagram')||''};
  const content=JSON.parse(setting('content')||JSON.stringify(defaultState.content));
  const products=db.prepare('SELECT * FROM products ORDER BY rowid').all();
  const reviews=db.prepare('SELECT * FROM reviews ORDER BY rowid').all();
  return {settings,content,products,reviews,rules:setting('rules')||''};
}
function allOrders(){ return db.prepare('SELECT * FROM orders ORDER BY datetime(createdAt) ASC').all().map(o=>({...o,items:JSON.parse(o.items)})); }
function adminState(){ return {...publicState(),orders:allOrders(),settings:{...publicState().settings,adminUsername:setting('adminUsername')||'admin'}}; }
function requireAdmin(req,res,next){ if(req.session.admin) return next(); res.status(401).json({error:'Admin authentication required.'}); }

app.get('/api/state',(req,res)=>res.json(publicState()));
app.post('/api/orders',(req,res)=>{
  const {customerName,phone,delivery,items,total}=req.body||{};
  if(!customerName||!phone||!delivery||!Array.isArray(items)||!items.length) return res.status(400).json({error:'Please complete all order fields.'});
  const cleanItems=items.map(i=>({productId:String(i.productId||''),name:String(i.name||''),quantity:Number(i.quantity),price:Number(i.price)}));
  if(cleanItems.some(i=>!i.productId||!i.name||!Number.isFinite(i.quantity)||i.quantity<1||!Number.isFinite(i.price))) return res.status(400).json({error:'Invalid order items.'});
  const ref=reference(), oid=id(), createdAt=now();
  db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)').run(oid,ref,String(customerName).slice(0,200),String(phone).slice(0,100),String(delivery).slice(0,1000),JSON.stringify(cleanItems),Number(total)||0,'Pending',createdAt);
  res.status(201).json({reference:ref,status:'Pending'});
});
app.get('/api/track/:reference',(req,res)=>{
  const o=db.prepare('SELECT reference,status,items,createdAt FROM orders WHERE upper(reference)=upper(?)').get(req.params.reference);
  if(!o) return res.status(404).json({error:'No order found with that reference number.'});
  res.json({...o,items:JSON.parse(o.items)});
});

app.post('/api/admin/login',(req,res)=>{
  const {username,password}=req.body||{};
  const expected=setting('adminUsername')||'admin';
  const hash=process.env.ADMIN_PASSWORD_HASH || setting('adminPasswordHash');
  if(username===expected && hash && bcrypt.compareSync(String(password||''),hash)) { req.session.admin=true; return res.json({ok:true}); }
  res.status(401).json({error:'Invalid admin login.'});
});
app.post('/api/admin/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/state',requireAdmin,(req,res)=>res.json(adminState()));
app.put('/api/admin/username',requireAdmin,(req,res)=>{
  const username=String(req.body?.username||'').trim();
  if(!/^[A-Za-z0-9_.-]{3,40}$/.test(username)) return res.status(400).json({error:'Username must be 3–40 characters and use only letters, numbers, dot, underscore or hyphen.'});
  db.prepare('UPDATE settings SET value=? WHERE key=?').run(username,'adminUsername');
  res.json({ok:true,username});
});
app.put('/api/admin/password',requireAdmin,(req,res)=>{
  const current=String(req.body?.currentPassword||'');
  const next=String(req.body?.newPassword||'');
  if(next.length<8) return res.status(400).json({error:'New password must be at least 8 characters.'});
  const hash=setting('adminPasswordHash');
  if(!hash || !bcrypt.compareSync(current,hash)) return res.status(400).json({error:'Current password is incorrect.'});
  db.prepare('UPDATE settings SET value=? WHERE key=?').run(bcrypt.hashSync(next,12),'adminPasswordHash');
  res.json({ok:true});
});
app.put('/api/admin/state',requireAdmin,(req,res)=>{
  const b=req.body||{};
  const tx=db.transaction(()=>{
    const up=db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    if(b.settings){ for(const k of ['businessName','email','phone','whatsapp','instagram']) if(k in b.settings) up.run(k,String(b.settings[k]??'')); }
    if(b.content) up.run('content',JSON.stringify(b.content));
    if('rules' in b) up.run('rules',String(b.rules??''));
    if(Array.isArray(b.products)){
      db.prepare('DELETE FROM products').run(); const ins=db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)');
      for(const p of b.products) ins.run(String(p.id),String(p.name),Number(p.price)||0,String(p.category||''),String(p.description||''),String(p.image||''),String(p.availability||'Available'));
    }
    if(Array.isArray(b.reviews)){
      db.prepare('DELETE FROM reviews').run(); const ins=db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?)');
      for(const r of b.reviews) ins.run(String(r.id),String(r.name||''),Number(r.rating)||0,String(r.text||''),String(r.date||now()));
    }
  });
  try{tx();res.json(publicState());}catch(e){res.status(400).json({error:'Could not save store data.'});}
});
app.patch('/api/admin/orders/:id',requireAdmin,(req,res)=>{ const s=String(req.body?.status||''); const allowed=['Pending','Confirmed','Processing','Ready/Dispatched','Delivered','Cancelled']; if(!allowed.includes(s)) return res.status(400).json({error:'Invalid status.'}); const r=db.prepare('UPDATE orders SET status=? WHERE id=?').run(s,req.params.id); if(!r.changes)return res.status(404).json({error:'Order not found.'}); res.json({ok:true}); });
app.delete('/api/admin/orders/:id',requireAdmin,(req,res)=>{ const r=db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); if(!r.changes)return res.status(404).json({error:'Order not found.'}); res.json({ok:true}); });
app.use(express.static(path.join(__dirname,'public')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Virello Store running on port ${PORT}`));
