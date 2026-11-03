// Gestinéro – page de l'ordinateur : relier (code du téléphone), puis glisser des fichiers qui partent, chiffrés, vers l'appli.
(function(){
'use strict';
const CFG=window.GPC_CONFIG||{}, $=id=>document.getElementById(id);
const CLE='gestinero-pc-lien';
const lire=()=>{ try{ const x=JSON.parse(localStorage.getItem(CLE)||'null'); return x&&/^[0-9a-f]{32}$/.test(x.canal||'')&&x.cle?x:null }catch(e){ return null } };
const ecrire=x=>{ try{ if(x) localStorage.setItem(CLE,JSON.stringify(x)); else localStorage.removeItem(CLE) }catch(e){} };
let lien=null; // {canal, cle (CryptoKey)}
const EXT=['pdf','jpg','jpeg','png','webp','heic','heif','xlsx','xls','ods','csv'];
const extDe=n=>{ const m=/\.([a-z0-9]{2,5})$/i.exec(String(n||'')); return m?m[1].toLowerCase():'' };
const accepte=f=>EXT.includes(extDe(f.name))||/^image\//.test(f.type||'')||f.type==='application/pdf';
const reseau=e=>e&&e.reseau;

function voir(v){ for(const id of ['vPasPret','vRelier','vEnvoyer']) $(id).hidden=id!==v; if(v==='vRelier') setTimeout(()=>{ try{ $('code').focus() }catch(e){} },50) }
function msg(t,ok){ const m=$('mRelier'); m.hidden=!t; m.textContent=t||''; m.className='msg '+(ok?'ok':'ko') }
function appareil(){ const u=navigator.userAgent||''; const os=/Windows/.test(u)?'Windows':/Mac OS X|Macintosh/.test(u)?'Mac':/CrOS/.test(u)?'Chromebook':/Linux/.test(u)?'Linux':'';
  const nav=/Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/Firefox\//.test(u)?'Firefox':/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'';
  return ['Ordinateur'+(os?' '+os:''),nav].filter(Boolean).join(' · ') }
function delieIci(texte){ ecrire(null); lien=null; voir('vRelier'); $('code').value=''; msg(texte||'',false) }

// ---------- relier ----------
async function relier(saisie){ const code=GPC.normaliser(saisie);
  if(!code){ msg('Ce code n\'est pas complet : il a 12 lettres et chiffres, comme XXXX-XXXX-XXXX.',false); return }
  const b=$('bRelier'); b.disabled=true; b.textContent='Un instant…'; msg('',true);
  try{ const r=await GPC.deriver(code); const e=await GPC.rpc(CFG,'pc_etat',{p_canal:r.canal});
    if(!e||!e.existe){ msg('Ce code ne marche pas. Vérifie-le sur ton téléphone (Réglages › 📱 Mon téléphone › 💻 Relier mon PC).',false); return }
    await GPC.rpc(CFG,'pc_relier',{p_canal:r.canal,p_pc:await GPC.chiffrerTexte(r.cle,appareil(),'pc')});
    ecrire({canal:r.canal,cle:r.cleB64,le:Date.now()}); lien={canal:r.canal,cle:r.cle}; voir('vEnvoyer') }
  catch(e){ msg(reseau(e)?'Pas de connexion internet. Vérifie ta connexion, puis réessaie.':'Le service ne répond pas pour le moment. Réessaie dans quelques minutes.',false) }
  finally{ b.disabled=false; b.textContent='Relier' } }
$('fCode').addEventListener('submit',e=>{ e.preventDefault(); relier($('code').value) });
$('code').addEventListener('input',()=>{ const i=$('code'), s=i.value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,12); const j=s.replace(/(.{4})(?=.)/g,'$1-'); if(i.value!==j) i.value=j });

// ---------- envoyer ----------
const file=[]; let occupe=false; const attendus=new Map(); // fichier envoyé → {d: sa ligne, rid: n° de la réponse du téléphone, arrive}
// v43 : fichiers déjà envoyés depuis cet ordinateur (empreinte SHA-256, gardée dans ce navigateur seulement)
const CLE_ENV='gestinero-pc-envoyes';
const envoyes=()=>{ try{ const x=JSON.parse(localStorage.getItem(CLE_ENV)||'[]'); return Array.isArray(x)?x:[] }catch(e){ return [] } };
const noterEnvoye=h=>{ try{ const L=envoyes().filter(x=>x&&x.h!==h); L.push({h,le:Date.now()}); localStorage.setItem(CLE_ENV,JSON.stringify(L.slice(-3000))) }catch(e){} };
const MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const moisTxt=m=>/^\d{4}-\d{2}$/.test(m||'')?MOIS[+m.slice(5)-1]+' '+m.slice(0,4):'';
function ligne(f){ const d=document.createElement('div'); d.className='f';
  d.innerHTML='<div class="nom"></div><div class="barre"><i></i></div><div class="etat">En attente…</div><div class="aide" hidden></div>';
  d.querySelector('.nom').textContent='📄 '+f.name; $('liste').prepend(d); return d }
function etat(d,t,cls,aide){ const e=d.querySelector('.etat'); e.textContent=t; e.className='etat'+(cls?' '+cls:''); const a=d.querySelector('.aide'); a.hidden=!aide; a.textContent=aide||'' }
function ajouter(L){ for(const f of L){ const d=ligne(f);
    if(!accepte(f)){ d.querySelector('.barre').hidden=true; etat(d,'⚠️ Ce type de fichier n\'est pas pris en charge.','ko','Gestinéro range les PDF, les photos, les tableaux Excel, LibreOffice et CSV.'); continue }
    if(f.size>GPC.MAX){ d.querySelector('.barre').hidden=true; etat(d,'⚠️ Ce fichier est trop gros (plus de 20 Mo).','ko'); continue }
    if(!f.size){ d.querySelector('.barre').hidden=true; etat(d,'⚠️ Ce fichier est vide.','ko'); continue }
    file.push({f,d}) }
  suivant() }
async function suivant(){ if(occupe||!file.length) return; occupe=true;
  while(file.length){ const {f,d}=file.shift(); const bar=d.querySelector('.barre i');
    if(!lien){ etat(d,'⚠️ Pas envoyé : cet ordinateur n\'est plus relié.','ko'); continue }
    try{ etat(d,'Envoi… 0 %'); const bytes=new Uint8Array(await f.arrayBuffer());
      let h=''; try{ h=GPC.sha256?await GPC.sha256(bytes):'' }catch(e){ h='' }
      if(h&&!f.forcer&&envoyes().some(x=>x&&x.h===h)){ etat(d,'⚠️ Tu as déjà envoyé ce fichier','ko','Il n\'est pas renvoyé : Gestinéro l\'a déjà reçu depuis cet ordinateur.');
        const r=document.createElement('button'); r.className='btn g'; r.type='button'; r.textContent='L\'envoyer quand même'; r.style.alignSelf='flex-start';
        r.onclick=()=>{ r.remove(); f.forcer=true; etat(d,'En attente…'); file.push({f,d}); suivant() }; d.appendChild(r); continue }
      const id=await GPC.envoyer(CFG,lien,{nom:f.name,mime:f.type||'',bytes},p=>{ bar.style.width=Math.round(p*100)+'%'; etat(d,'Envoi… '+Math.round(p*100)+' %') });
      bar.style.width='100%'; if(h) noterEnvoye(h); etat(d,'✅ Envoyé à ton téléphone','ok','Il arrive dans Gestinéro dès que l\'appli est ouverte sur ton téléphone.'); let rid=''; try{ rid=GPC.idRetour?await GPC.idRetour(id):'' }catch(e){} attendus.set(id,{d,rid,arrive:0}); suivre() }
    catch(e){ bar.style.width='0';
      if(e&&e.raison==='canal'){ etat(d,'⚠️ Pas envoyé : ton téléphone n\'est plus relié.','ko'); file.length=0; occupe=false; delieIci('Ton téléphone n\'est plus relié à cet ordinateur. Pour envoyer de nouveau des fichiers, crée un nouveau code sur ton téléphone.'); return }
      const t=e&&e.raison==='plein'?'Il y a déjà beaucoup de fichiers en attente : ouvre Gestinéro sur ton téléphone pour les recevoir, puis réessaie.':e&&e.raison==='relais'?'Le service est très chargé en ce moment. Réessaie plus tard.':reseau(e)?'Vérifie ta connexion internet, puis réessaie.':'Le service ne répond pas pour le moment. Réessaie dans quelques minutes.';
      etat(d,'⚠️ Pas envoyé.','ko',t); const r=document.createElement('button'); r.className='btn g'; r.type='button'; r.textContent='Réessayer'; r.style.alignSelf='flex-start';
      r.onclick=()=>{ r.remove(); etat(d,'En attente…'); file.push({f,d}); suivant() }; d.appendChild(r) } }
  occupe=false }
// arrivé sur le téléphone ? (le fichier n'attend plus sur le relais)
let suivi=null;
let tour=false;
function suivre(){ if(suivi) return; suivi=setInterval(async()=>{ if(!lien||!attendus.size){ clearInterval(suivi); suivi=null; return } if(tour) return; tour=true;
  try{ const r=await GPC.rpc(CFG,'pc_liste',{p_canal:lien.canal}); if(r&&r.existe===false){ clearInterval(suivi); suivi=null; delieIci('Ton téléphone n\'est plus relié à cet ordinateur. Pour envoyer de nouveau des fichiers, crée un nouveau code sur ton téléphone.'); return }
    const reste=new Set(((r&&r.fichiers)||[]).map(x=>x.fichier));
    for(const [id,a] of attendus){ const d=a.d;
      // v43 : le téléphone dit ce qu'il en a fait (téléphone pas encore à jour : seulement « Bien arrivé »)
      if(a.rid&&reste.has(a.rid)){ let o=null; try{ o=await GPC.lireRetour(CFG,lien,a.rid) }catch(e){}
        if(o){ try{ await GPC.rpc(CFG,'pc_effacer',{p_canal:lien.canal,p_fichier:a.rid}) }catch(e){} attendus.delete(id);
          if(o.etat==='deja') etat(d,'⚠️ Déjà dans Gestinéro'+(o.num?' (facture '+o.num+')':''),'ko','Il n\'a pas été ajouté une deuxième fois.');
          else if(o.etat==='refus') etat(d,'⚠️ Pas rangé par Gestinéro','ko',o.texte||'');
          else if(o.etat==='attente') etat(d,'📱 Arrivé dans Gestinéro','ok','Gestinéro te pose une question sur ton téléphone.');
          else etat(d,'✅ Rangé dans Gestinéro'+(o.mois?' ('+moisTxt(o.mois)+')':''),'ok',(o.num?'Facture '+o.num+(o.ou?' · ':''):'')+(o.ou||''));
          continue } }
      if(!reste.has(id)&&!a.arrive){ a.arrive=Date.now(); etat(d,'✅ Envoyé à ton téléphone','ok','📱 Bien arrivé dans Gestinéro.') }
      if(a.arrive&&Date.now()-a.arrive>30*60000) attendus.delete(id) } }catch(e){} finally{ tour=false } },5000) }

const zone=$('zone');
$('bChoisir').addEventListener('click',()=>$('choix').click());
$('choix').addEventListener('change',e=>{ ajouter([...e.target.files]); e.target.value='' });
['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{ e.preventDefault(); zone.classList.add('sur') }));
['dragleave','drop'].forEach(t=>zone.addEventListener(t,()=>zone.classList.remove('sur')));
// un fichier lâché à côté de la zone : envoyé aussi (jamais ouvert à la place de la page)
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{ e.preventDefault(); zone.classList.remove('sur'); if(!lien||$('vEnvoyer').hidden) return; const L=[...((e.dataTransfer&&e.dataTransfer.files)||[])]; if(L.length) ajouter(L) });

$('bDelier').addEventListener('click',async()=>{ if(!confirm('Délier cet ordinateur ?\n\nLes fichiers pas encore arrivés sur ton téléphone seront effacés. Pour envoyer de nouveau des fichiers, il faudra un nouveau code.')) return;
  const c=lien&&lien.canal; try{ if(c) await GPC.rpc(CFG,'pc_canal_supprimer',{p_canal:c}) }catch(e){}
  file.length=0; attendus.clear(); $('liste').innerHTML=''; delieIci('Cet ordinateur est délié.'); msg('Cet ordinateur est délié.',true) });

// ---------- démarrage ----------
// un lien avec le code (« 📤 M'envoyer le lien » sur le téléphone) : la page se relie toute seule
async function codeDuLien(){ const h=decodeURIComponent((location.hash||'').slice(1)); if(!h) return false; try{ history.replaceState(null,'',location.pathname+location.search) }catch(e){} // le code ne reste pas dans l'adresse
  const c=GPC.normaliser(h); if(!c) return false; lien=null; ecrire(null); voir('vRelier'); $('code').value=GPC.joli(c); await relier(c); return true }
window.addEventListener('hashchange',()=>{ if(GPC.pret(CFG)) codeDuLien() });
(async()=>{
  if(!GPC.pret(CFG)||!(window.crypto&&crypto.subtle)){ voir('vPasPret'); return }
  if(await codeDuLien()) return;
  const x=lire();
  if(x){ try{ lien={canal:x.canal,cle:await GPC.importer(x.cle)} }catch(e){ lien=null }
    if(lien){ voir('vEnvoyer');
      try{ const e=await GPC.rpc(CFG,'pc_etat',{p_canal:lien.canal}); if(e&&e.existe===false) delieIci('Ton téléphone n\'est plus relié à cet ordinateur. Pour envoyer de nouveau des fichiers, crée un nouveau code sur ton téléphone.') }catch(e){}
      return } }
  voir('vRelier') })();
})();
