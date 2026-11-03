// ==== Gestinéro – « Relier mon PC » : outils communs à l'appli et à la page de l'ordinateur ====
// (le MÊME fichier est copié dans pc/pc_commun.js ; tests/pc_relais.test.js vérifie qu'ils sont identiques)
//
// Comment ça marche :
//  - le téléphone tire un code de 12 caractères au hasard (ex. « K7QM-4TXA-9HWE ») ;
//  - le code donne, par un calcul volontairement lent (PBKDF2, 200 000 tours), deux choses :
//      * le « canal » (32 caractères) : l'adresse de la boîte aux lettres sur le relais ;
//      * la clé de chiffrement AES-GCM 256 bits : elle ne quitte JAMAIS le téléphone et l'ordinateur ;
//  - l'ordinateur chiffre chaque fichier (nom compris) par morceaux de 512 ko AVANT de l'envoyer : le relais (Supabase)
//    ne voit que des données illisibles, effacées dès que le téléphone les a reçues, et au plus tard après 24 h ;
//  - le relais n'est utilisé qu'à travers des fonctions (supabase/relais_pc.sql) : sans le canal, rien n'est lisible.
(function(racine){
'use strict';
const ALPHA='23456789ABCDEFGHJKMNPQRSTVWXYZ'; // ni 0/O, ni 1/I/L, ni U : rien à confondre
const LONG=12, SEL='gestinero-pc-v1', TOURS=200000, MORCEAU=512*1024, MAX=20*1024*1024;
const te=new TextEncoder(), td=new TextDecoder();
const sub=()=>racine.crypto&&racine.crypto.subtle;

const b64e=u=>{ let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s) };
const b64d=s=>{ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u };
const hex=u=>[...u].map(x=>x.toString(16).padStart(2,'0')).join('');
const auHasard=n=>racine.crypto.getRandomValues(new Uint8Array(n));

// ---------- le code ----------
function nouveauCode(){ let s=''; while(s.length<LONG){ for(const x of auHasard(32)){ if(x<240&&s.length<LONG) s+=ALPHA[x%30] } } return s } // 240 = 8 × 30 : pas de lettre favorisée
// ce que la personne a tapé (espaces, tirets, minuscules…) → le code, ou '' s'il n'est pas bon
function normaliser(t){ const s=String(t||'').toUpperCase().replace(/[\s\-_.·–—]/g,'');
  return s.length===LONG&&[...s].every(c=>ALPHA.includes(c))?s:'' }
const joli=c=>String(c||'').replace(/(.{4})(?=.)/g,'$1-');

// ---------- canal + clé tirés du code ----------
async function deriver(code){ const c=normaliser(code); if(!c) throw new Error('code');
  const base=await sub().importKey('raw',te.encode(c),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await sub().deriveBits({name:'PBKDF2',salt:te.encode(SEL),iterations:TOURS,hash:'SHA-256'},base,384));
  const brut=bits.slice(0,32), canal=hex(bits.slice(32,48));
  return {code:c,canal,cleB64:b64e(brut),cle:await importer(b64e(brut))} }
const importer=b=>sub().importKey('raw',b64d(b),{name:'AES-GCM'},false,['encrypt','decrypt']);

// ---------- chiffrement (iv de 12 octets + données chiffrées, en base64 ; aad : à quoi ce morceau appartient) ----------
async function chiffrer(cle,bytes,aad){ const iv=auHasard(12);
  const ct=new Uint8Array(await sub().encrypt({name:'AES-GCM',iv,additionalData:te.encode(aad)},cle,bytes));
  const out=new Uint8Array(12+ct.length); out.set(iv); out.set(ct,12); return b64e(out) }
async function dechiffrer(cle,b64,aad){ const u=b64d(b64);
  return new Uint8Array(await sub().decrypt({name:'AES-GCM',iv:u.subarray(0,12),additionalData:te.encode(aad)},cle,u.subarray(12))) }
const chiffrerTexte=(cle,t,aad)=>chiffrer(cle,te.encode(t),aad);
const dechiffrerTexte=async(cle,b,aad)=>td.decode(await dechiffrer(cle,b,aad));

// ---------- le relais (fonctions Supabase appelées par simple « fetch ») ----------
function pret(cfg){ return !!(cfg&&/^https?:\/\/\S+$/.test(String(cfg.url||'').trim())&&String(cfg.cle||'').trim().length>20) }
async function rpc(cfg,fn,args,ms){ const url=String(cfg.url).trim().replace(/\/+$/,'')+'/rest/v1/rpc/'+fn, cle=String(cfg.cle).trim();
  const ctl=typeof AbortController!=='undefined'?new AbortController():null; const t=ctl?setTimeout(()=>ctl.abort(),ms||30000):0;
  let r; try{ const h={'Content-Type':'application/json',apikey:cle,Authorization:'Bearer '+cle}; // comme la bibliothèque de Supabase : clé « anon » (JWT) ou « publishable » (sb_publishable_…)
  r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(args||{}),signal:ctl?ctl.signal:undefined,cache:'no-store'}) }
  catch(e){ const x=new Error('reseau'); x.reseau=true; throw x } finally{ if(t) clearTimeout(t) }
  const txt=await r.text(); if(!r.ok){ const x=new Error('relais '+r.status+' '+txt.slice(0,160)); x.statut=r.status; throw x }
  return txt?JSON.parse(txt):null }

// ---------- envoyer un fichier (ordinateur) ----------
const idFichier=()=>hex(auHasard(16));
async function envoyer(cfg,lien,f,progres){ // f : {nom, mime, bytes}
  if(f.bytes.length>MAX) throw Object.assign(new Error('trop gros'),{trop:true});
  const id=idFichier(), total=Math.max(1,Math.ceil(f.bytes.length/MORCEAU));
  const info=await chiffrerTexte(lien.cle,JSON.stringify({nom:f.nom,mime:f.mime||'',taille:f.bytes.length}),id+'|info');
  for(let n=0;n<total;n++){ const part=f.bytes.subarray(n*MORCEAU,Math.min(f.bytes.length,(n+1)*MORCEAU));
    const r=await rpc(cfg,'pc_envoyer',{p_canal:lien.canal,p_fichier:id,p_n:n,p_total:total,p_info:n===0?info:null,p_donnees:await chiffrer(lien.cle,part,id+'|'+n+'|'+total)},60000);
    if(!r||!r.ok){ const x=new Error(r&&r.raison||'refus'); x.raison=r&&r.raison; throw x }
    if(progres) progres((n+1)/total) }
  return id }

// ---------- recevoir un fichier (téléphone) ----------
async function recevoir(cfg,lien,x){ // x : {fichier,total,info} venu de pc_liste
  const meta=JSON.parse(await dechiffrerTexte(lien.cle,x.info,x.fichier+'|info')); const parts=[]; let n0=0;
  for(let n=0;n<x.total;n++){ const b=await rpc(cfg,'pc_morceau',{p_canal:lien.canal,p_fichier:x.fichier,p_n:n},60000);
    if(typeof b!=='string'||!b) throw Object.assign(new Error('morceau absent'),{absent:true});
    const u=await dechiffrer(lien.cle,b,x.fichier+'|'+n+'|'+x.total); parts.push(u); n0+=u.length }
  const bytes=new Uint8Array(n0); let o=0; for(const u of parts){ bytes.set(u,o); o+=u.length }
  return {nom:String(meta.nom||'document'),mime:String(meta.mime||''),bytes} }

// ---------- v43 : réponse du téléphone pour un fichier reçu (où il est rangé, ou « déjà là »), sur le même canal, chiffrée ----------
// C'est un petit « fichier » du relais (mêmes fonctions, rien à changer côté Supabase) dont le numéro se calcule à partir de celui du
// fichier envoyé : l'ordinateur sait où le chercher, le téléphone le reconnaît (info chiffrée {retour:1}) et ne le range jamais.
const sha256=async bytes=>hex(new Uint8Array(await sub().digest('SHA-256',bytes)));
const idRetour=async id=>(await sha256(te.encode('retour|'+id))).slice(0,32);
async function envoyerRetour(cfg,lien,id,res){ const rid=await idRetour(id);
  const info=await chiffrerTexte(lien.cle,JSON.stringify({retour:1,pour:id}),rid+'|info');
  const r=await rpc(cfg,'pc_envoyer',{p_canal:lien.canal,p_fichier:rid,p_n:0,p_total:1,p_info:info,p_donnees:await chiffrer(lien.cle,te.encode(JSON.stringify(res||{})),rid+'|0|1')},30000);
  return !!(r&&r.ok) }
async function estRetour(lien,x){ try{ const m=JSON.parse(await dechiffrerTexte(lien.cle,x.info,x.fichier+'|info')); return m&&m.retour?m:null }catch(e){ return null } }
async function lireRetour(cfg,lien,rid){ const b=await rpc(cfg,'pc_morceau',{p_canal:lien.canal,p_fichier:rid,p_n:0}); if(typeof b!=='string'||!b) return null;
  try{ return JSON.parse(td.decode(await dechiffrer(lien.cle,b,rid+'|0|1'))) }catch(e){ return null } }

const GPC={ALPHA,LONG,TOURS,MORCEAU,MAX,nouveauCode,normaliser,joli,deriver,importer,chiffrer,dechiffrer,chiffrerTexte,dechiffrerTexte,pret,rpc,envoyer,recevoir,b64e,b64d,sha256,idRetour,envoyerRetour,estRetour,lireRetour};
racine.GPC=GPC; if(typeof module!=='undefined'&&module.exports) module.exports=GPC;
})(typeof window!=='undefined'?window:globalThis);
