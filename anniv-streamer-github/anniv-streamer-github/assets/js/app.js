(function(){
  'use strict';

  /* ===== Réglages ===== */
  // Connexion à Supabase : renseignée dans assets/js/config.js (window.ANNIV_CONFIG).
  // Sans configuration, la page fonctionne en mode démo (localStorage, rien n'est partagé).
  var CFG = window.ANNIV_CONFIG || {};
  var SB_URL = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var SB_KEY = String(CFG.publishableKey || '');
  var REMOTE = !!(SB_URL && SB_KEY);
  var LOGIN_DOMAIN = CFG.loginDomain || 'anniv.fr';
  var UNLOCK = new Date('2026-11-30T00:00:00+01:00');   // ouverture du résumé (minuit, heure de Paris)
  var KEY = 'anniv-fiches-v1';

  /* ===== Connexion de l'équipe (Supabase Auth) ===== */
  var SKEY = 'anniv-session-v1';
  var SESSION = null;   // { access, refresh, exp, role }
  try{ var saved = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); if(saved && saved.refresh) SESSION = saved; }catch(e){}
  function saveSession(){
    try{ if(SESSION) sessionStorage.setItem(SKEY, JSON.stringify(SESSION)); else sessionStorage.removeItem(SKEY); }catch(e){}
  }
  async function sbAuth(grant, body){
    var r = await fetch(SB_URL + '/auth/v1/token?grant_type=' + grant, {
      method:'POST', headers:{ 'apikey':SB_KEY, 'Content-Type':'application/json' }, body: JSON.stringify(body)
    });
    var j = await r.json().catch(function(){ return {}; });
    if(!r.ok || !j.access_token) return null;
    return { access:j.access_token, refresh:j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, role:null };
  }
  async function token(){
    if(!SESSION) return null;
    if(SESSION.exp - Date.now() < 60000){
      var role = SESSION.role, s2 = null;
      try{ s2 = await sbAuth('refresh_token', { refresh_token: SESSION.refresh }); }catch(e){}
      if(!s2){ SESSION = null; saveSession(); return null; }
      s2.role = role; SESSION = s2; saveSession();
    }
    return SESSION.access;
  }
  async function sbFetch(path, opts){
    opts = opts || {};
    var h = Object.assign({ 'apikey':SB_KEY }, opts.headers || {});
    var t = await token();
    if(t) h['Authorization'] = 'Bearer ' + t;
    return fetch(SB_URL + path, Object.assign({}, opts, { headers:h }));
  }
  function hasRole(roles){ return !!(SESSION && roles.indexOf(SESSION.role) > -1); }
  async function login(id, pwd){
    var email = id.indexOf('@') > -1 ? id : id + '@' + LOGIN_DOMAIN;
    try{
      var s2 = await sbAuth('password', { email:email, password:pwd });
      if(!s2) return { ok:false, msg:'Identifiant ou mot de passe incorrect.' };
      SESSION = s2;
      var r = await sbFetch('/rest/v1/rpc/mon_role', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
      var role = r.ok ? await r.json().catch(function(){ return null; }) : null;
      if(role !== 'streamer' && role !== 'moderateur'){ SESSION = null; saveSession(); return { ok:false, msg:"Ce compte n'a pas accès à cet espace." }; }
      SESSION.role = role; saveSession();
      return { ok:true, role:role };
    }catch(e){
      SESSION = null; saveSession();
      return { ok:false, msg:'Connexion impossible pour le moment. Réessaie dans un instant.' };
    }
  }
  function logout(){ SESSION = null; saveSession(); REMOTE_LIST = []; }

  /* ===== Stockage =====
     Avec Supabase (REMOTE) : les fiches arrivent par la fonction « submit-fiche », sont lues dans la table « fiches »
     (le public ne voit que les fiches validées, après le 30 novembre, sans les mots ; les règles sont dans la base).
     Sans configuration : localStorage du navigateur (démo uniquement).
     Format d'une fiche : { id, at, status, pseudo, game, clip, clipTitle, clipThumb, word, drawing (data URL ou lien) } */
  var REMOTE_LIST = [];
  var PUB_COLS = 'id,pseudo,game,clip,clip_title,clip_thumb,drawing_path';
  var STAFF_COLS = PUB_COLS + ',status,created_at,word';
  function drawingUrl(p){ return p ? SB_URL + '/storage/v1/object/public/dessins/' + encodeURIComponent(p) : null; }
  function fromRow(r){
    return { id:r.id, at:r.created_at || null, status:r.status || 'approved', pseudo:r.pseudo, game:r.game || '',
             clip:r.clip || '', clipTitle:r.clip_title || '', clipThumb:r.clip_thumb || '', word:r.word || '', drawing:drawingUrl(r.drawing_path) };
  }
  async function fetchRemote(staff){
    var r = await sbFetch('/rest/v1/fiches?select=' + (staff ? STAFF_COLS : PUB_COLS) + '&order=created_at.asc&limit=1000',
                          { headers:{ 'Accept':'application/json' } });
    if(!r.ok) throw new Error('fiches ' + r.status);
    return (await r.json()).map(fromRow);
  }

  function loadFiches(){
    if(REMOTE) return REMOTE_LIST;
    try{ return JSON.parse(localStorage.getItem(KEY) || '[]'); }catch(e){ return []; }
  }
  // Renvoie true si la fiche est enregistrée, sinon { field, message } (refus argumenté du serveur) ou false.
  async function saveFiche(f){
    if(REMOTE){
      try{
        var r = await fetch(SB_URL + '/functions/v1/submit-fiche', {
          method:'POST', headers:{ 'apikey':SB_KEY, 'Content-Type':'application/json' },
          body: JSON.stringify({ pseudo:f.pseudo, game:f.game, clip:f.clip, word:f.word, drawing:f.drawing })
        });
        var j = await r.json().catch(function(){ return null; });
        if(r.ok && j && j.ok) return true;
        if(j && j.ok === false) return { field:j.field || null, message:j.message || null };
        return false;
      }catch(e){ return false; }
    }
    try{
      var all = loadFiches(); all.unshift(f);
      localStorage.setItem(KEY, JSON.stringify(all));
      return true;
    }catch(e){ return false; }
  }

  /* Modération : status = 'pending' (par défaut) | 'approved' | 'rejected'.
     Avec Supabase : seul un compte modérateur connecté peut changer le statut (règle côté base). */
  async function updateStatus(id, st){
    if(REMOTE){
      try{
        var r = await sbFetch('/rest/v1/fiches?id=eq.' + encodeURIComponent(id), {
          method:'PATCH', headers:{ 'Content-Type':'application/json', 'Prefer':'return=representation' }, body: JSON.stringify({ status:st })
        });
        if(!r.ok) return false;
        var j = await r.json();
        if(!j.length) return false;
        REMOTE_LIST.forEach(function(x){ if(x.id === id) x.status = st; });
        return true;
      }catch(e){ return false; }
    }
    try{
      var all = loadFiches();
      all.forEach(function(x){ if(x.id === id) x.status = st; });
      localStorage.setItem(KEY, JSON.stringify(all));
      return true;
    }catch(e){ return false; }
  }
  function statusOf(f){ return f.status === 'approved' || f.status === 'rejected' ? f.status : 'pending'; }

  var $ = function(s){ return document.querySelector(s); };

  /* ===== Vues ===== */
  var previewing = false;
  // Qui regarde le résumé : 'public' (bouton Résumé) ou 'streamer' (Tone).
  // Seul 'streamer' voit « Les mots » (les modérateurs lisent les mots directement sur les fiches à valider). BACKEND : cette règle doit être appliquée côté serveur
  // (ne jamais envoyer les mots à un visiteur public), le masquage ci-dessous n'est que visuel.
  var viewRole = 'public';
  var fromMod = false;   // résumé ouvert depuis l'espace modérateur
  function canSeeWords(){ return viewRole === 'streamer'; }
  function resumeAvailable(){ return Date.now() >= UNLOCK.getTime() || previewing; }
  function updateResumeBtn(){ $('#to-resume').hidden = !resumeAvailable(); }
  function show(view){
    $('#view-viewer').hidden = view !== 'viewer';
    $('#view-streamer').hidden = view !== 'streamer';
    if(view === 'viewer') updateResumeBtn();
    $('#view-mod').hidden = view !== 'mod';
    $('#view-login').hidden = view !== 'login';
    window.scrollTo(0,0);
    var connected = REMOTE && !!SESSION;
    $('#out1').hidden = $('#out2').hidden = !connected;
    if(view === 'viewer') fromMod = false;
    $('#back-mod').hidden = !(view === 'streamer' && fromMod);
    if(view === 'streamer') enterStreamer();
    if(view === 'mod') enterMod();
  }
  function setLoading(on){ $('#loading1').hidden = $('#loading2').hidden = !on; }
  // Chargement des fiches puis affichage
  async function enterStreamer(){
    if(!REMOTE || !isOpen()){ renderStreamer(); return; }
    var staff = viewRole === 'streamer';
    if(staff && !(await token())){ openLogin('streamer'); return; }
    $('#gate').hidden = true; $('#board').hidden = true; setLoading(true);
    try{ REMOTE_LIST = await fetchRemote(staff); }
    catch(e){ REMOTE_LIST = []; toast('Impossible de charger les fiches pour le moment. Réessaie dans un instant.'); }
    await ART_READY; setLoading(false); renderStreamer();
  }
  async function enterMod(){
    if(!REMOTE){ renderMod(); return; }
    if(!(await token())){ openLogin('mod'); return; }
    $('#mgate').hidden = true; $('#mboard').hidden = true; setLoading(true);
    try{ REMOTE_LIST = await fetchRemote(true); }
    catch(e){ REMOTE_LIST = []; toast('Impossible de charger les fiches pour le moment. Réessaie dans un instant.'); }
    await ART_READY; setLoading(false); renderMod();
  }
  // Connexion
  var loginTarget = 'streamer';
  function openLogin(target){
    loginTarget = target;
    $('#login-title').textContent = target === 'mod' ? 'Espace modérateur' : 'Espace streamer';
    $('#login-intro').textContent = 'Connecte-toi avec l\'identifiant et le mot de passe que tu as reçus.';
    $('#login-err').textContent = ''; $('#login-pwd').value = '';
    show('login'); $('#login-id').focus();
  }
  $('#login-form').addEventListener('submit', async function(e){
    e.preventDefault();
    var id = $('#login-id').value.trim(), pwd = $('#login-pwd').value;
    if(!id || !pwd){ $('#login-err').textContent = 'Indique ton identifiant et ton mot de passe.'; return; }
    var b = $('#login-go'); b.disabled = true; $('#login-err').textContent = '';
    var r = await login(id, pwd);
    b.disabled = false;
    if(!r.ok){ $('#login-err').textContent = r.msg; return; }
    $('#login-pwd').value = '';
    if(loginTarget === 'mod'){
      if(r.role !== 'moderateur'){ logout(); $('#login-err').textContent = "Ce compte n'a pas accès à l'espace modérateur."; return; }
      show('mod');
    } else { viewRole = 'streamer'; show('streamer'); }
  });
  $('#login-back').addEventListener('click', function(){ show('viewer'); });
  function doLogout(){ logout(); show('viewer'); toast('Tu es déconnecté.'); }
  $('#out1').addEventListener('click', doLogout);
  $('#out2').addEventListener('click', doLogout);

  $('#to-streamer').addEventListener('click', function(){
    if(REMOTE && !hasRole(['streamer','moderateur'])){ openLogin('streamer'); return; }
    fromMod = false; viewRole = 'streamer'; show('streamer');
  });
  $('#m-resume').addEventListener('click', function(){ fromMod = true; viewRole = 'streamer'; show('streamer'); });
  $('#back-mod').addEventListener('click', function(){ show('mod'); });
  $('#to-resume').addEventListener('click', function(){ viewRole = 'public'; show('streamer'); });
  $('#to-mod').addEventListener('click', function(){
    if(REMOTE && !hasRole(['moderateur'])){ openLogin('mod'); return; }
    show('mod');
  });
  $('#back1').addEventListener('click', function(){ show('viewer'); });
  $('#mback1').addEventListener('click', function(){ show('viewer'); });
  $('#mback2').addEventListener('click', function(){ show('viewer'); });
  $('#back2').addEventListener('click', function(){ show('viewer'); });
  // APERCU : retire ce bouton et previewing en production
  if(REMOTE){ $('#preview').hidden = true; $('#mpreview').hidden = true; }
  $('#preview').addEventListener('click', function(){ previewing = true; updateResumeBtn(); renderStreamer(); });
  $('#mpreview').addEventListener('click', function(){ previewing = true; updateResumeBtn(); renderMod(); });

  /* ===== Dessin ===== */
  var cv = $('#pad'), ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height, BG = '#dededa';
  var color = '#101010', erasing = false, size = 6, drawing = false, last = null;
  var undoStack = [];
  function blank(){ ctx.fillStyle = BG; ctx.fillRect(0,0,W,H); }
  blank();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  function snap(){
    if(undoStack.length >= 25) undoStack.shift();
    undoStack.push(ctx.getImageData(0,0,W,H));
  }
  function pos(e){
    var r = cv.getBoundingClientRect();
    return { x:(e.clientX - r.left) * W / r.width, y:(e.clientY - r.top) * H / r.height };
  }
  function stroke(from,to){
    ctx.strokeStyle = erasing ? BG : color;
    ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(from.x,from.y); ctx.lineTo(to.x,to.y); ctx.stroke();
  }
  cv.addEventListener('pointerdown', function(e){
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    snap(); drawing = true; last = pos(e);
    stroke(last,{x:last.x+0.01,y:last.y});
  });
  cv.addEventListener('pointermove', function(e){
    if(!drawing) return;
    var p = pos(e); stroke(last,p); last = p;
  });
  function stop(){ drawing = false; last = null; }
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  document.querySelectorAll('.swatch').forEach(function(b){
    b.addEventListener('click', function(){
      color = b.dataset.color; erasing = false;
      document.querySelectorAll('.swatch').forEach(function(s){ s.setAttribute('aria-pressed', s === b ? 'true':'false'); });
      $('#eraser').setAttribute('aria-pressed','false');
    });
  });
  $('#eraser').addEventListener('click', function(){
    erasing = !erasing;
    this.setAttribute('aria-pressed', erasing ? 'true':'false');
    if(erasing) document.querySelectorAll('.swatch').forEach(function(s){ s.setAttribute('aria-pressed','false'); });
    else { var first = document.querySelector('.swatch[data-color="'+color+'"]'); if(first) first.setAttribute('aria-pressed','true'); }
  });
  $('#size').addEventListener('input', function(){ size = +this.value; });
  $('#undo').addEventListener('click', function(){ if(undoStack.length) ctx.putImageData(undoStack.pop(),0,0); });
  $('#clear').addEventListener('click', function(){ snap(); blank(); });

  function isBlank(){
    var d = ctx.getImageData(0,0,W,H).data;
    for(var i=0;i<d.length;i+=4){
      if(Math.abs(d[i]-0xde)>6 || Math.abs(d[i+1]-0xde)>6 || Math.abs(d[i+2]-0xda)>6) return false;
    }
    return true;
  }


  /* ===== Éditeur du mot (mise en forme + emoji) ===== */
  var ed = $('#mot'), MAXW = 500;
  try{ document.execCommand('styleWithCSS', false, false); }catch(e){}

  function chars(str){ return Array.from(str); }
  function len(){ return chars(ed.textContent).length; }
  function updateCount(){
    var n = len(), el = $('#mot-count');
    el.textContent = n + ' / ' + MAXW;
    el.style.color = n > MAXW ? '#b00020' : '';
    el.style.fontWeight = n > MAXW ? '700' : '';
  }

  // Nettoyage : on ne garde que gras, italique, souligné, barré et retours à la ligne
  var TAGS = { B:'b', STRONG:'b', I:'i', EM:'i', U:'u', S:'s', STRIKE:'s', DEL:'s', BR:'br', DIV:'div', P:'div' };
  function cleanInto(src, dst){
    src.childNodes.forEach(function(n){
      if(n.nodeType === 3){ dst.appendChild(document.createTextNode(n.nodeValue)); }
      else if(n.nodeType === 1){
        var t = n.tagName;
        if(t === 'SCRIPT' || t === 'STYLE') return;
        if(TAGS[t]){
          var el = document.createElement(TAGS[t]);
          if(t !== 'BR') cleanInto(n, el);
          dst.appendChild(el);
        } else cleanInto(n, dst);
      }
    });
  }
  function safeFragment(html){
    var frag = document.createDocumentFragment();
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    cleanInto(doc.body, frag);
    return frag;
  }
  function wordHtml(){
    if(!ed.textContent.trim()) return '';
    var tmp = document.createElement('div');
    tmp.appendChild(safeFragment(ed.innerHTML));
    return tmp.innerHTML;
  }

  // Sélection mémorisée pour que les boutons agissent au bon endroit
  var savedRange = null;
  function inEditor(node){ return node && ed.contains(node.nodeType === 3 ? node.parentNode : node); }
  function refreshState(){
    var sel = window.getSelection();
    if(sel.rangeCount && inEditor(sel.anchorNode)){
      savedRange = sel.getRangeAt(0).cloneRange();
      document.querySelectorAll('.fmt').forEach(function(b){
        var on = false; try{ on = document.queryCommandState(b.dataset.cmd); }catch(e){}
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }
  document.addEventListener('selectionchange', refreshState);
  function ensureFocus(){
    if(document.activeElement !== ed) ed.focus();
    var sel = window.getSelection();
    if(!sel.rangeCount || !inEditor(sel.anchorNode)){
      var r = savedRange;
      if(!r){ r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
      sel.removeAllRanges(); sel.addRange(r);
    }
  }

  // Les boutons ne doivent pas voler le focus à l'éditeur
  document.querySelectorAll('.rtb button, .emo-pop button').forEach(function(b){
    b.addEventListener('mousedown', function(e){ e.preventDefault(); });
  });
  document.querySelectorAll('.fmt').forEach(function(b){
    b.addEventListener('click', function(){ ensureFocus(); document.execCommand(b.dataset.cmd); refreshState(); updateCount(); });
  });

  var pop = $('#emo-pop'), tog = $('#emo-toggle');
  tog.addEventListener('click', function(){
    var open = pop.hidden;
    pop.hidden = !open; tog.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  pop.addEventListener('click', function(e){
    var b = e.target.closest('.emo'); if(!b) return;
    ensureFocus(); insertText(b.textContent);
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !pop.hidden){ pop.hidden = true; tog.setAttribute('aria-expanded','false'); tog.focus(); }
  });

  function selLen(){ var sel = window.getSelection(); return (sel.rangeCount && inEditor(sel.anchorNode)) ? chars(sel.toString()).length : 0; }
  function insertText(text){
    var room = MAXW - (len() - selLen());
    if(room <= 0) return;
    text = chars(text).slice(0, room).join('');
    document.execCommand('insertText', false, text);
  }

  // Collage en texte brut, limité à la taille max
  ed.addEventListener('paste', function(e){
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    insertText(t);
  });
  ed.addEventListener('drop', function(e){ e.preventDefault(); });
  ed.addEventListener('beforeinput', function(e){
    if(e.inputType === 'insertText' && e.data){
      if(len() - selLen() + chars(e.data).length > MAXW) e.preventDefault();
    }
  });
  ed.addEventListener('input', function(){
    if(!ed.textContent && ed.innerHTML) ed.innerHTML = '';   // garde le placeholder
    updateCount();
    $('#mot-err').textContent = '';
  });


  /* ===== Liste des jeux (choix obligatoire dans la liste) ===== */
  var GAMES = ["Grand Theft Auto V", "Satisfactory", "ELDEN RING", "Lycans", "Age of Empires IV", "League of Legends", "PUBG: BATTLEGROUNDS", "WARDOGS", "Marathon", "Resonance: A Plague Tale Legacy", "MECCHA CHAMELEON", "Zwift", "Big Walk", "World of Warcraft", "OneState", "Corsair Cove", "Guild Wars 2", "Shift at Midnight", "OK Boomer", "Mewgenics", "Street Fighter 6", "Peekablock", "Farming Simulator 25", "Jackbox Party Packs", "Pizza House Simulator", "Hozy", "Marbles on Stream", "S.O.N.A.R.: Submarine Operators Not Actually Ready", "Subnautica 2", "Counter-Strike", "Minecraft", "DayZ", "Keep Talking and Nobody Explodes", "Hades II"];
  var jeu = $('#jeu'), jlist = $('#jeu-list'), jbtn = $('#jeu-btn'), jerr = $('#jeu-err');
  var shown = [], activeIdx = -1;
  function norm(t){ return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function renderList(){
    var q = norm(jeu.value);
    shown = GAMES.filter(function(g){ return !q || norm(g).indexOf(q) > -1; });
    jlist.textContent = '';
    if(!shown.length){
      var li0 = document.createElement('li'); li0.className = 'combo-empty'; li0.setAttribute('role','presentation');
      li0.textContent = 'Aucun jeu ne correspond.'; jlist.appendChild(li0);
    }
    shown.forEach(function(g,i){
      var li = document.createElement('li'); li.setAttribute('role','option'); li.id = 'jeu-opt-' + i;
      li.setAttribute('aria-selected','false'); li.textContent = g;
      li.addEventListener('mousedown', function(e){ e.preventDefault(); });
      li.addEventListener('click', function(){ chooseGame(g); });
      jlist.appendChild(li);
    });
    activeIdx = -1; jeu.removeAttribute('aria-activedescendant');
  }
  function openList(){ renderList(); jlist.hidden = false; jeu.setAttribute('aria-expanded','true'); }
  function closeList(){ jlist.hidden = true; jeu.setAttribute('aria-expanded','false'); activeIdx = -1; jeu.removeAttribute('aria-activedescendant'); }
  function setActive(i){
    var opts = jlist.querySelectorAll('[role=option]'); if(!opts.length) return;
    activeIdx = (i + opts.length) % opts.length;
    opts.forEach(function(o,k){ o.classList.toggle('on', k === activeIdx); o.setAttribute('aria-selected', k === activeIdx ? 'true':'false'); });
    jeu.setAttribute('aria-activedescendant', 'jeu-opt-' + activeIdx);
    opts[activeIdx].scrollIntoView({block:'nearest'});
  }
  function chooseGame(g){ jeu.value = g; jerr.textContent = ''; closeList(); }
  function matchedGame(){
    var v = norm(jeu.value); if(!v) return '';
    for(var i=0;i<GAMES.length;i++){ if(norm(GAMES[i]) === v) return GAMES[i]; }
    return null;   // texte qui ne correspond à aucun jeu
  }
  jeu.addEventListener('focus', function(){ if(jlist.hidden) openList(); });
  jeu.addEventListener('input', function(){ jerr.textContent = ''; openList(); });
  jeu.addEventListener('keydown', function(e){
    if(e.key === 'ArrowDown'){ e.preventDefault(); if(jlist.hidden) openList(); setActive(activeIdx + 1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); if(jlist.hidden) openList(); setActive(activeIdx < 0 ? -1 : activeIdx - 1); }
    else if(e.key === 'Enter' && !jlist.hidden){
      if(activeIdx > -1){ e.preventDefault(); chooseGame(shown[activeIdx]); }
      else if(jeu.value.trim() && shown.length === 1){ e.preventDefault(); chooseGame(shown[0]); }
    }
    else if(e.key === 'Escape' && !jlist.hidden){ e.preventDefault(); closeList(); }
    else if(e.key === 'Tab'){ closeList(); }
  });
  jbtn.addEventListener('mousedown', function(e){ e.preventDefault(); });
  jbtn.addEventListener('click', function(){
    if(!jlist.hidden){ closeList(); return; }
    jeu.focus(); if(jlist.hidden) openList();
  });
  document.addEventListener('click', function(e){ if(!e.target.closest('.combo')) closeList(); });


  /* ===== Clip : uniquement un clip de la chaîne de Tone ===== */
  var CHANNEL = 'toneeuw';
  var EXEMPLE = 'twitch.tv/toneeuw/clip/NomDuClip';
  function checkClip(raw){
    var v = (raw || '').trim();
    if(!v) return { ok:true, url:'' };
    var u;
    try{ u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v); }catch(e){ u = null; }
    if(!u || !/\.[a-z]{2,}$/i.test(u.hostname)){
      return { ok:false, msg:"Ce texte n'est pas un lien. Colle l'adresse complète du clip, par exemple " + EXEMPLE + "." };
    }
    var host = u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    var segs = u.pathname.split('/').filter(Boolean);
    if(host !== 'twitch.tv' && host !== 'clips.twitch.tv'){
      return { ok:false, msg:"Ce lien ne vient pas de Twitch. Seuls les clips de la chaîne Twitch de Tone sont acceptés." };
    }
    var needsChannel = "Ce lien ne permet pas de savoir de quelle chaîne vient le clip. Ouvre le clip sur Twitch puis copie l'adresse affichée dans la barre du navigateur : elle doit contenir le nom de la chaîne, par exemple " + EXEMPLE + ".";
    if(host === 'clips.twitch.tv'){
      if(REMOTE && segs.length) return { ok:true, url:v };   // la chaîne est vérifiée auprès de Twitch à l'envoi
      return { ok:false, msg:needsChannel };
    }
    if(!segs.length){
      return { ok:false, msg:"Ce lien mène à la page d'accueil de Twitch, pas à un clip. Colle le lien d'un clip de la chaîne de Tone." };
    }
    if(segs[0].toLowerCase() === 'clip'){
      if(REMOTE && segs[1]) return { ok:true, url:v };      // idem
      return { ok:false, msg:needsChannel };
    }
    var channel = segs[0].toLowerCase();
    if(segs[1] !== 'clip' || !segs[2]){
      if(channel === CHANNEL){
        return { ok:false, msg:"Ce lien mène à la chaîne de Tone, pas à un clip précis. Ouvre le clip que tu veux choisir et copie son adresse, qui doit ressembler à " + EXEMPLE + "." };
      }
      return { ok:false, msg:"Ce lien n'est pas celui d'un clip, et il ne vient pas de la chaîne de Tone. Seuls les clips de sa chaîne sont acceptés." };
    }
    if(channel !== CHANNEL){
      return { ok:false, msg:"Ce clip vient de la chaîne « " + segs[0] + " », pas de celle de Tone. Choisis un clip de sa chaîne (" + CHANNEL + ")." };
    }
    if(!/^[A-Za-z0-9_-]+$/.test(segs[2])){
      return { ok:false, msg:"Le lien du clip semble incomplet ou abîmé. Recopie-le en entier depuis la barre d'adresse." };
    }
    return { ok:true, url:'https://www.twitch.tv/' + CHANNEL + '/clip/' + segs[2] };
  }
  var clipIn = $('#clip'), clipErr = $('#clip-err');
  clipIn.addEventListener('input', function(){ clipErr.textContent = ''; });
  clipIn.addEventListener('change', function(){
    var r = checkClip(clipIn.value);
    clipErr.textContent = r.ok ? '' : r.msg;
  });

  updateResumeBtn(); setInterval(updateResumeBtn, 30000);

  /* ===== Envoi ===== */
  // Dessin en JPEG ; avec le serveur, on le garde sous ~280 Ko (limite : 300 Ko).
  function exportDrawing(){
    if(isBlank()) return null;
    if(!REMOTE) return cv.toDataURL('image/jpeg', .85);
    var qs = [.85, .7, .55, .4], d, i;
    for(i = 0; i < qs.length; i++){
      d = cv.toDataURL('image/jpeg', qs[i]);
      if((d.length - 23) * .75 <= 280000) return d;
    }
    var c2 = document.createElement('canvas'); c2.width = 560; c2.height = 364;
    c2.getContext('2d').drawImage(cv, 0, 0, 560, 364);
    return c2.toDataURL('image/jpeg', .6);
  }
  var form = $('#fiche-form');
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var pseudo = $('#pseudo').value.trim();
    $('#send-err').textContent = '';
    if(!pseudo){
      $('#pseudo-err').textContent = 'Indique ton pseudo pour envoyer ta fiche.';
      $('#pseudo').focus();
      return;
    }
    $('#pseudo-err').textContent = '';
    var gameValue = matchedGame();
    if(gameValue === null){ jerr.textContent = 'Choisis un jeu dans la liste. Tu peux taper son nom pour le retrouver.'; jeu.focus(); return; }
    jerr.textContent = '';
    var clipCheck = checkClip(clipIn.value);
    if(!clipCheck.ok){ clipErr.textContent = clipCheck.msg; clipIn.focus(); return; }
    clipErr.textContent = '';
    if(len() > MAXW){ $('#mot-err').textContent = 'Ton mot dépasse ' + MAXW + ' caractères. Raccourcis-le pour l\'envoyer.'; ed.focus(); return; }
    $('#mot-err').textContent = '';
    var f = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2,7),
      at: new Date().toISOString(),
      status: 'pending',
      pseudo: pseudo,
      game: gameValue,
      clip: clipCheck.url,
      word: wordHtml(),
      drawing: exportDrawing()
    };
    var btn = $('#send'); btn.disabled = true;
    var res = await saveFiche(f);
    btn.disabled = false;
    if(res !== true){
      var spots = { pseudo:[$('#pseudo-err'), $('#pseudo')], game:[jerr, jeu], clip:[clipErr, clipIn], word:[$('#mot-err'), ed] };
      var spot = res && res.field && spots[res.field];
      if(res && res.message && spot){ spot[0].textContent = res.message; spot[1].focus(); }
      else $('#send-err').textContent = (res && res.message) || "La fiche n'a pas pu être envoyée. Réessaie dans un instant.";
      return;
    }
    $('#done-text').textContent = 'Merci ' + pseudo + ', ta fiche est enregistrée.\nTone la découvrira le 30 novembre.\n\nChaque fiche est validée par un modérateur.';
    $('#form-zone').hidden = true; $('#done').hidden = false;
    $('#fiche').scrollIntoView({block:'start'});
  });
  $('#again').addEventListener('click', function(){
    form.reset(); undoStack.length = 0; blank(); ed.innerHTML = ''; updateCount(); closeList(); jerr.textContent = ''; clipErr.textContent = '';
    $('#done').hidden = true; $('#form-zone').hidden = false;
    $('#pseudo').focus();
  });

  /* ===== Espace streamer ===== */
  // Le résumé s'ouvre le 30 novembre ; les modérateurs connectés y ont accès à tout moment.
  function isOpen(){ return Date.now() >= UNLOCK.getTime() || previewing || (REMOTE && hasRole(['moderateur'])); }

  function countdown(){
    var diff = UNLOCK.getTime() - Date.now();
    if(diff <= 0){ enterStreamer(); return; }
    var days = Math.floor(diff / 864e5), hours = Math.floor(diff % 864e5 / 36e5), mins = Math.floor(diff % 36e5 / 6e4);
    $('#count').textContent = days + (days > 1 ? ' jours' : ' jour');
    $('#count-sub').textContent = 'et ' + hours + ' h ' + mins + ' min avant de tout découvrir.';
  }

  function el(tag, cls, text){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function plural(n, one, many){ return n + ' ' + (n > 1 ? many : one); }
  function validDrawing(d){
    return typeof d === 'string' && (/^data:image\/(jpeg|png);base64,/.test(d) ||
      (REMOTE && d.indexOf(SB_URL + '/storage/v1/object/public/dessins/') === 0));
  }

  // Lien de clip Twitch -> { url, slug } ou null
  function clipInfo(raw){
    try{
      var u = new URL(raw);
      if(u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      var segs = u.pathname.split('/').filter(Boolean);
      return { url:u.href, slug: segs.length ? segs[segs.length - 1] : u.hostname };
    }catch(e){ return null; }
  }
  // Miniature : champ f.clipThumb, renseigné par la fonction serveur (API Twitch, « Get Clips » -> thumbnail_url)
  function thumbOk(t){
    try{
      var u = new URL(t); var h = u.hostname.toLowerCase();
      return u.protocol === 'https:' && (/(^|\.)twitch\.tv$/.test(h) || /(^|\.)jtvnw\.net$/.test(h) || /(^|\.)twitchcdn\.net$/.test(h));
    }catch(e){ return false; }
  }
  function clipTile(info, thumb, title){
    var label = title || info.slug;
    var a = el('a','clip'); a.href = info.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Ouvrir le clip ' + label + ' sur Twitch');
    if(thumb && thumbOk(thumb)){
      var img = document.createElement('img'); img.src = thumb; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function(){ img.remove(); });   // sans miniature : on garde le fond de remplacement
      a.appendChild(img);
    }
    var play = el('span','play'); play.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z" fill="#fff"/></svg>';
    a.appendChild(play);
    a.appendChild(el('span','slug', label));
    return a;
  }


  /* ===== Images des jeux =====
     Avec Supabase : la fonction « submit-fiche » (requête GET) renvoie la jaquette Twitch de chaque jeu de la liste.
     En mode démo : seulement quelques jeux (identifiants ci-dessous), les autres affichent leurs initiales. */
  var GAME_ART = {
    "Grand Theft Auto V":"32982_IGDB", "ELDEN RING":"512953_IGDB", "Satisfactory":"506456_IGDB", "Lycans":"1494074023_IGDB",
    "Age of Empires IV":"498482_IGDB", "League of Legends":"21779", "WARDOGS":"743893402_IGDB",
    "Minecraft":"27471_IGDB", "Marathon":"18503_IGDB", "Resonance: A Plague Tale Legacy":"570615518_IGDB", "Zwift":"490959_IGDB",
    "Big Walk":"676802825_IGDB", "World of Warcraft":"18122", "OneState":"535020156_IGDB", "Corsair Cove":"596701144_IGDB",
    "OK Boomer":"1922096936_IGDB"
  };
  var GAME_IMG = {};
  async function loadGameArt(){
    if(!REMOTE) return;
    try{
      var r = await fetch(SB_URL + '/functions/v1/submit-fiche', { headers:{ 'apikey':SB_KEY } });
      var j = await r.json();
      if(r.ok && j && j.games && typeof j.games === 'object') GAME_IMG = j.games;
    }catch(e){}
  }
  var ART_READY = loadGameArt();
  function gameArtUrl(name){
    var u = GAME_IMG[name] || (GAME_ART[name] ? 'https://static-cdn.jtvnw.net/ttv-boxart/' + GAME_ART[name] + '-285x380.jpg' : '');
    return u && thumbOk(u) ? u : '';
  }
  function gameInitials(name){
    var w = String(name).replace(/[^A-Za-z0-9À-ɏ ]+/g,' ').split(/\s+/).filter(Boolean);
    var t = w.length > 1 ? w.slice(0,3).map(function(x){ return x.charAt(0); }).join('') : (w[0] || '?').slice(0,2);
    return t.toUpperCase();
  }
  // Vignette portrait (format des jaquettes Twitch, 3:4) ; sans image, les initiales du jeu
  function gameBanner(name, small){
    var box = el('span', 'gbanner' + (small ? ' sm' : '')); box.setAttribute('aria-hidden','true');
    box.appendChild(el('span','gi', gameInitials(name)));
    var url = gameArtUrl(name);
    if(url){
      var img = document.createElement('img'); img.className = 'fg'; img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function(){ img.remove(); });
      box.appendChild(img);
    }
    return box;
  }

  var curTab = 'fiches', LIST = [], DRAWS = [], timer = null;

  function demoDrawing(seed){
    var c = document.createElement('canvas'); c.width = 800; c.height = 520;
    var x = c.getContext('2d'); x.fillStyle = '#dededa'; x.fillRect(0,0,800,520);
    var r = seed * 37 % 11;
    x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = 8 + seed % 3 * 3;
    x.strokeStyle = seed % 2 ? '#2540ff' : '#101010';
    x.beginPath(); x.arc(400, 215 + r, 92, 0, 7); x.stroke();                                   // tête
    x.beginPath(); x.moveTo(305, 190 + r); x.lineTo(495, 190 + r); x.stroke();                  // casquette
    x.fillStyle = '#101010'; x.fillRect(335, 215 + r, 52, 22); x.fillRect(413, 215 + r, 52, 22); // lunettes
    x.beginPath(); x.moveTo(370, 270 + r); x.quadraticCurveTo(400, 290 + r, 430, 270 + r); x.stroke();
    x.beginPath(); x.moveTo(300, 470); x.lineTo(330, 330); x.lineTo(470, 330); x.lineTo(500, 470); x.stroke(); // capuche
    return c.toDataURL('image/jpeg', .8);
  }
  var DEMO = null;
  function getDemo(){
    if(DEMO) return DEMO;
    var G = 'Grand Theft Auto V', E = 'ELDEN RING', S = 'Satisfactory';
    var T = 'https://www.twitch.tv/toneeuw/clip/';
    DEMO = [
      { id:'d1', status:'approved', pseudo:'Exemple_1', game:G, clip:T+'ExempleClipUn', word:'<b>Joyeux anniv</b> 🎂', drawing:demoDrawing(1) },
      { id:'d2', status:'approved', pseudo:'Exemple_2', game:E, clip:T+'ExempleClipUn', word:'Longue vie au stream 🔥', drawing:demoDrawing(2) },
      { id:'d3', status:'approved', pseudo:'Exemple_3', game:G, clip:T+'ExempleClipDeux', word:'<i>Merci pour les lives</i>', drawing:demoDrawing(3) },
      { id:'d4', status:'pending',  pseudo:'Exemple_4', game:S, clip:'', word:'Bon anniv Tone !', drawing:demoDrawing(4) },
      { id:'d5', status:'pending',  pseudo:'Exemple_5', game:G, clip:T+'ExempleClipTrois', word:'', drawing:demoDrawing(5) },
      { id:'d6', status:'rejected', pseudo:'Exemple_6', game:E, clip:'', word:'<u>Gros</u> bisous 💙', drawing:null }
    ];
    return DEMO;
  }
  // Toutes les fiches (ou les fiches d'exemple en aperçu si aucune vraie fiche)
  function allFiches(){
    var all = loadFiches();
    if(!all.length && previewing) return { list:getDemo(), demo:true };
    return { list:all, demo:false };
  }

  function renderStreamer(){
    clearInterval(timer);
    if(!isOpen()){
      $('#gate').hidden = false; $('#board').hidden = true;
      countdown(); timer = setInterval(countdown, 30000);
      return;
    }
    $('#gate').hidden = true; $('#board').hidden = false;
    var r = allFiches(), demo = r.demo;
    var list = r.list.filter(function(f){ return statusOf(f) === 'approved'; });
    LIST = list;
    DRAWS = list.filter(function(f){ return validDrawing(f.drawing); });
    $('#demo-note').hidden = !demo;
    renderFiches(demo); renderJeux(); renderClips(); renderDessins();
    var words = canSeeWords();
    document.querySelector('[data-tab="mots"]').hidden = !words;
    if(words) renderMots(); else { $('#wall').textContent = ''; if(curTab === 'mots') curTab = 'fiches'; }
    showTab(curTab, false);
  }

  var TITLES = { fiches:'Les fiches', jeux:'Les jeux', clips:'Les clips', dessins:'Les dessins', mots:'Les mots' };
  function tabCount(name){
    if(name === 'fiches') return plural(LIST.length, 'fiche', 'fiches');
    if(name === 'jeux'){ var g = gameStats(); return g.length ? plural(g.length, 'jeu cité', 'jeux cités') : 'Aucun jeu cité pour l\'instant'; }
    if(name === 'clips'){ var c = clipStats(); return c.length ? plural(c.length, 'clip différent', 'clips différents') : 'Aucun clip pour l\'instant'; }
    if(name === 'mots'){ var m = wordsList().length; return m ? plural(m, 'mot', 'mots') : 'Aucun mot pour l\'instant'; }
    return DRAWS.length ? plural(DRAWS.length, 'dessin', 'dessins') : 'Aucun dessin pour l\'instant';
  }
  function showTab(name, focus){
    curTab = name;
    Object.keys(TITLES).forEach(function(k){ $('#tab-' + k).hidden = k !== name; });
    document.querySelectorAll('.tab[data-tab]').forEach(function(t){
      if(t.dataset.tab === name) t.setAttribute('aria-current','page'); else t.removeAttribute('aria-current');
    });
    $('#board-title').textContent = TITLES[name];
    $('#board-count').textContent = tabCount(name);
    if(focus){ $('#board-title').focus({preventScroll:true}); window.scrollTo(0,0); }
  }
  document.querySelectorAll('.tab[data-tab]').forEach(function(t){
    t.addEventListener('click', function(){ showTab(t.dataset.tab, true); });
  });

  function emptyBox(text){ var d = el('div','empty concrete', text); return d; }

  /* --- Les fiches --- */
  function row(dl, term, node){
    dl.appendChild(el('dt', null, term));
    var dd = document.createElement('dd'); dd.appendChild(node); dl.appendChild(dd);
  }
  function card(f, demo, mod){
    var c = el('article','card concrete');
    if(demo) c.appendChild(el('span','badge','exemple'));

    if(validDrawing(f.drawing)){
      var btn = el('button','pic'); btn.type = 'button';
      btn.setAttribute('aria-label', 'Agrandir le dessin de ' + f.pseudo);
      var img = document.createElement('img'); img.src = f.drawing; img.alt = 'Dessin de ' + f.pseudo;
      btn.appendChild(img);
      btn.addEventListener('click', function(){ var L = mod ? MDRAWS : DRAWS; openZoom(L.indexOf(f), L); });
      c.appendChild(btn);
    } else {
      c.appendChild(el('div','pic none','Pas de dessin'));
    }

    c.appendChild(el('h3','pseudo', f.pseudo));
    var dl = document.createElement('dl');
    if(f.game){
      var gr = el('div','grow'); gr.appendChild(gameBanner(f.game, true));
      gr.appendChild(el('dt', null, 'Jeu préféré'));
      var gd = document.createElement('dd'); gd.appendChild(el('span','gname', f.game)); gr.appendChild(gd);
      dl.appendChild(gr);
    }
    if(f.clip){
      var info = clipInfo(f.clip);
      row(dl, 'Clip préféré', info ? clipTile(info, f.clipThumb, f.clipTitle) : document.createTextNode(f.clip));
    }
    if(f.word && mod){
      var w = el('div','word'); w.appendChild(safeFragment(f.word));
      row(dl, 'Son mot', w);
    }
    c.appendChild(dl);
    if(mod){
      c.appendChild(modActions(f));
    }
    return c;
  }
  function renderFiches(demo){
    var grid = $('#grid'); grid.textContent = '';
    if(!LIST.length){ grid.appendChild(emptyBox("Aucune fiche validée pour l'instant.")); return; }
    LIST.forEach(function(f){ grid.appendChild(card(f, demo)); });
  }

  /* --- Les jeux --- */
  function gameStats(){
    var map = {};
    LIST.forEach(function(f){
      if(!f.game) return;
      (map[f.game] = map[f.game] || { name:f.game, who:[] }).who.push(f.pseudo);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return b.who.length - a.who.length || a.name.localeCompare(b.name, 'fr'); });
  }
  function whoList(names){
    var ul = el('ul','who'); names.forEach(function(n){ ul.appendChild(el('li', null, n)); }); return ul;
  }
  function renderJeux(){
    var ol = $('#rank'); ol.textContent = '';
    var stats = gameStats();
    if(!stats.length){ ol.appendChild(emptyBox("Aucun jeu n'a encore été choisi.")); return; }
    var max = stats[0].who.length;
    stats.forEach(function(g, i){
      var li = el('li','concrete');
      li.appendChild(el('span','pos', String(i + 1)));
      var name = el('span','name', g.name);
      if(i === 0){
        var crown = el('span'); crown.setAttribute('aria-hidden','true');
        crown.innerHTML = '<svg viewBox="0 0 120 100" width="34" height="28"><path d="M8 92 16 28 42 62 60 16 78 62 104 28 112 92Z" fill="none" stroke="#101010" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
        name.appendChild(crown);
      }
      li.appendChild(name);
      li.appendChild(el('span','votes', plural(g.who.length, 'vote', 'votes')));
      var bar = el('div','bar'); var fill = document.createElement('i'); fill.style.width = (g.who.length / max * 100) + '%';
      bar.appendChild(fill); li.appendChild(bar);
      var det = document.createElement('details');
      det.appendChild(el('summary', null, 'Qui l\'a choisi'));
      det.appendChild(whoList(g.who));
      li.appendChild(det);
      var rb = el('div','rbody'); while(li.firstChild) rb.appendChild(li.firstChild);
      li.appendChild(gameBanner(g.name)); li.appendChild(rb);
      ol.appendChild(li);
    });
  }


  /* --- Les mots (streamer et modérateurs uniquement) --- */
  function hasWord(f){ return !!(f.word && String(f.word).replace(/<[^>]*>/g,'').trim()); }
  function wordsList(){ return LIST.filter(hasWord); }
  function renderMots(){
    var wall = $('#wall'); wall.textContent = '';
    var list = wordsList();
    if(!list.length){ wall.appendChild(emptyBox("Aucun mot n'a encore été laissé.")); return; }
    list.forEach(function(f){
      var n = el('figure','note concrete');
      var t = el('div','txt'); t.appendChild(safeFragment(f.word));
      n.appendChild(t);
      n.appendChild(el('figcaption','by', f.pseudo));
      wall.appendChild(n);
    });
  }

  /* --- Les clips --- */
  function clipStats(){
    var map = {};
    LIST.forEach(function(f){
      var info = f.clip && clipInfo(f.clip); if(!info) return;
      var m = map[info.url] = map[info.url] || { info:info, thumb:null, title:'', who:[] };
      if(f.clipThumb && !m.thumb) m.thumb = f.clipThumb;
      if(f.clipTitle && !m.title) m.title = f.clipTitle;
      m.who.push(f.pseudo);
    });
    return Object.keys(map).map(function(k){ return map[k]; })
      .sort(function(a,b){ return b.who.length - a.who.length; });
  }
  function renderClips(){
    var grid = $('#clip-grid'); grid.textContent = '';
    var stats = clipStats();
    if(!stats.length){ grid.appendChild(emptyBox("Aucun clip n'a encore été choisi.")); return; }
    stats.forEach(function(c){
      var card = el('article','card concrete');
      if(c.who.length > 1) card.appendChild(el('span','times','×' + c.who.length));
      card.appendChild(clipTile(c.info, c.thumb, c.title));
      card.appendChild(el('h3', null, c.title || c.info.slug));
      var by = el('p', null, 'Choisi par'); by.style.margin = '10px 0 0'; by.style.fontWeight = '700';
      card.appendChild(by);
      card.appendChild(whoList(c.who));
      grid.appendChild(card);
    });
  }

  /* --- Les dessins --- */
  function renderDessins(){
    var grid = $('#gallery'); grid.textContent = '';
    if(!DRAWS.length){ grid.appendChild(emptyBox("Aucun dessin n'a encore été envoyé.")); return; }
    DRAWS.forEach(function(f, i){
      var c = el('figure','card concrete'); c.style.margin = '0';
      var btn = el('button','pic'); btn.type = 'button';
      btn.setAttribute('aria-label', 'Agrandir le dessin de ' + f.pseudo);
      var img = document.createElement('img'); img.src = f.drawing; img.alt = 'Dessin de ' + f.pseudo;
      btn.appendChild(img);
      btn.addEventListener('click', function(){ openZoom(i, DRAWS); });
      c.appendChild(btn);
      c.appendChild(el('h3','pseudo', f.pseudo));
      grid.appendChild(c);
    });
  }


  /* ===== Espace modérateur ===== */
  var mTab = 'pending', MLIST = [], MDRAWS = [], MDEMO = false, toastTimer = null;
  var MTITLES = { pending:'Fiches à valider', approved:'Fiches validées', rejected:'Fiches refusées' };
  var MEMPTY = {
    pending:"Rien à valider pour l'instant.",
    approved:"Aucune fiche validée pour l'instant.",
    rejected:"Aucune fiche refusée."
  };

  function toast(msg){
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2800);
  }

  function modActions(f){
    var st = statusOf(f), box = el('div','mod-actions');
    function btn(label, cls, target, msg){
      var b = el('button','mbtn' + (cls ? ' ' + cls : ''), label); b.type = 'button';
      b.addEventListener('click', function(){ moderate(f, target, msg, b); });
      box.appendChild(b);
    }
    if(st === 'pending'){ btn('Valider','ok','approved','validée'); btn('Refuser','', 'rejected','refusée'); }
    if(st === 'approved'){ btn('Remettre en attente','', 'pending','remise en attente'); btn('Refuser','', 'rejected','refusée'); }
    if(st === 'rejected'){ btn('Valider','ok','approved','validée'); btn('Remettre en attente','', 'pending','remise en attente'); }
    return box;
  }

  async function moderate(f, target, msg, src){
    var cards = $('#mgrid').children, idx = Array.prototype.indexOf.call(cards, src.closest('.card'));
    var ok = true;
    if(MDEMO){ f.status = target; }
    else { ok = await updateStatus(f.id, target); }
    if(!ok){ toast("L'action n'a pas pu être enregistrée. Réessaie."); return; }
    toast('Fiche de ' + f.pseudo + ' ' + msg + '.');
    renderMod();
    // le focus passe à la fiche suivante pour enchaîner au clavier
    var next = $('#mgrid').children[Math.max(0, Math.min(idx, $('#mgrid').children.length - 1))];
    var b = next && next.querySelector('.mbtn');
    if(b) b.focus(); else $('#mboard-title').focus({preventScroll:true});
  }

  function renderMod(){
    if(!REMOTE && !previewing){ $('#mgate').hidden = false; $('#mboard').hidden = true; return; }
    $('#mgate').hidden = true; $('#mboard').hidden = false;
    var r = allFiches(); MLIST = r.list; MDEMO = r.demo;
    $('#mdemo-note').hidden = !MDEMO;
    var counts = { pending:0, approved:0, rejected:0 };
    MLIST.forEach(function(f){ counts[statusOf(f)]++; });
    Object.keys(counts).forEach(function(k){ $('#n-' + k).textContent = counts[k]; });

    var shown = MLIST.filter(function(f){ return statusOf(f) === mTab; });
    // les plus anciennes d'abord pour traiter dans l'ordre d'arrivée (les exemples gardent leur ordre)
    shown.sort(function(a,b){ return String(a.at || '').localeCompare(String(b.at || '')); });
    MDRAWS = shown.filter(function(f){ return validDrawing(f.drawing); });

    $('#mboard-title').textContent = MTITLES[mTab];
    $('#mboard-count').textContent = shown.length ? plural(shown.length, 'fiche', 'fiches') : MEMPTY[mTab];
    document.querySelectorAll('[data-mtab]').forEach(function(t){
      if(t.dataset.mtab === mTab) t.setAttribute('aria-current','page'); else t.removeAttribute('aria-current');
    });
    var grid = $('#mgrid'); grid.textContent = '';
    shown.forEach(function(f){ grid.appendChild(card(f, MDEMO, true)); });
  }
  document.querySelectorAll('[data-mtab]').forEach(function(t){
    t.addEventListener('click', function(){
      mTab = t.dataset.mtab; renderMod();
      $('#mboard-title').focus({preventScroll:true}); window.scrollTo(0,0);
    });
  });

  /* --- Agrandir un dessin --- */
  var zoom = $('#zoom'), zIdx = 0, zList = [];
  function openZoom(i, list){
    if(list) zList = list;
    if(i < 0 || !zList.length) return;
    zIdx = (i + zList.length) % zList.length;
    var f = zList[zIdx];
    $('#zoom-img').src = f.drawing; $('#zoom-img').alt = 'Dessin de ' + f.pseudo;
    $('#zoom-cap').textContent = f.pseudo;
    if(!zoom.open) zoom.showModal();
  }
  zoom.addEventListener('keydown', function(e){
    if(e.key === 'ArrowLeft'){ openZoom(zIdx - 1); }
    if(e.key === 'ArrowRight'){ openZoom(zIdx + 1); }
  });
  zoom.addEventListener('click', function(){ zoom.close(); });   // un clic n'importe où referme
})();
