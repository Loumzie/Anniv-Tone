(function(){
  'use strict';

  /* ===== Réglages ===== */
  var UNLOCK = new Date('2026-11-30T00:00:00');   // ouverture de l'espace streamer
  var KEY = 'anniv-fiches-v1';

  /* ===== Stockage =====
     Ici : localStorage du navigateur (démo uniquement, rien n'est partagé entre viewers).
     BACKEND : pour la vraie collecte, remplace saveFiche() / loadFiches() par des appels à ton backend
     (Supabase, Firebase, un endpoint maison...). Le format d'une fiche :
     { id, at, pseudo, game, clip, word, drawing (data URL JPEG ou null) } */
  function loadFiches(){
    try{ return JSON.parse(localStorage.getItem(KEY) || '[]'); }catch(e){ return []; }
  }
  async function saveFiche(f){
    try{
      var all = loadFiches(); all.unshift(f);
      localStorage.setItem(KEY, JSON.stringify(all));
      return true;
    }catch(e){ return false; }
  }

  /* Modération : status = 'pending' (par défaut) | 'approved' | 'rejected'.
     BACKEND : remplace updateStatus() par une requête sécurisée (réservée aux modérateurs)
     et n'envoie à l'espace streamer que les fiches 'approved'. */
  async function updateStatus(id, st){
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
  function canSeeWords(){ return viewRole === 'streamer'; }
  function resumeAvailable(){ return Date.now() >= UNLOCK.getTime() || previewing; }
  function updateResumeBtn(){ $('#to-resume').hidden = !resumeAvailable(); }
  function show(view){
    $('#view-viewer').hidden = view !== 'viewer';
    $('#view-streamer').hidden = view !== 'streamer';
    if(view === 'viewer') updateResumeBtn();
    $('#view-mod').hidden = view !== 'mod';
    window.scrollTo(0,0);
    if(view === 'streamer') renderStreamer();
    if(view === 'mod') renderMod();
  }
  $('#to-streamer').addEventListener('click', function(){ viewRole = 'streamer'; show('streamer'); });
  $('#to-resume').addEventListener('click', function(){ viewRole = 'public'; show('streamer'); });
  $('#to-mod').addEventListener('click', function(){ show('mod'); });
  $('#back1').addEventListener('click', function(){ show('viewer'); });
  $('#mback1').addEventListener('click', function(){ show('viewer'); });
  $('#mback2').addEventListener('click', function(){ show('viewer'); });
  $('#back2').addEventListener('click', function(){ show('viewer'); });
  // APERCU : retire ce bouton et previewing en production
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
  var GAMES = ["Grand Theft Auto V", "Satisfactory", "ELDEN RING", "Lycans", "Age of Empires IV", "League of Legends", "PUBG: BATTLEGROUNDS", "WARDOGS", "Marathon", "Resonance: A Plague Tale Legacy", "MECCHA CHAMELEON", "Zwift", "Big Walk", "World of Warcraft", "OneState", "Corsair Cove", "Guild Wars 2", "Shift at Midnight", "OK Boomer", "Mewgenics", "Street Fighter 6", "Peekablock", "Farming Simulator 25", "Jackbox Party Packs", "Pizza House Simulator", "Hozy", "Marbles on Stream", "S.O.N.A.R.: Submarine Operators Not Actually Ready", "Subnautica 2", "Counter-Strike", "Minecraft", "DayZ", "Keep Talking and Nobody Explodes"];
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
      return { ok:false, msg:needsChannel };
    }
    if(!segs.length){
      return { ok:false, msg:"Ce lien mène à la page d'accueil de Twitch, pas à un clip. Colle le lien d'un clip de la chaîne de Tone." };
    }
    if(segs[0].toLowerCase() === 'clip'){
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
      drawing: isBlank() ? null : cv.toDataURL('image/jpeg', .85)
    };
    var btn = $('#send'); btn.disabled = true;
    var ok = await saveFiche(f);
    btn.disabled = false;
    if(!ok){ $('#send-err').textContent = "La fiche n'a pas pu être envoyée. Réessaie dans un instant."; return; }
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
  function isOpen(){ return Date.now() >= UNLOCK.getTime() || previewing; }

  function countdown(){
    var diff = UNLOCK.getTime() - Date.now();
    if(diff <= 0){ renderStreamer(); return; }
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
  function validDrawing(d){ return typeof d === 'string' && /^data:image\/(jpeg|png);base64,/.test(d); }

  // Lien de clip Twitch -> { url, slug } ou null
  function clipInfo(raw){
    try{
      var u = new URL(raw);
      if(u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      var segs = u.pathname.split('/').filter(Boolean);
      return { url:u.href, slug: segs.length ? segs[segs.length - 1] : u.hostname };
    }catch(e){ return null; }
  }
  // BACKEND : miniature = champ optionnel f.clipThumb, à renseigner côté serveur (API Twitch, "Get Clips" -> thumbnail_url)
  function thumbOk(t){
    try{
      var u = new URL(t); var h = u.hostname.toLowerCase();
      return u.protocol === 'https:' && (/(^|\.)twitch\.tv$/.test(h) || /(^|\.)jtvnw\.net$/.test(h) || /(^|\.)twitchcdn\.net$/.test(h));
    }catch(e){ return false; }
  }
  function clipTile(info, thumb){
    var a = el('a','clip'); a.href = info.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Ouvrir le clip ' + info.slug + ' sur Twitch');
    if(thumb && thumbOk(thumb)){
      var img = document.createElement('img'); img.src = thumb; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function(){ img.remove(); });   // sans miniature : on garde le fond de remplacement
      a.appendChild(img);
    }
    var play = el('span','play'); play.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z" fill="#fff"/></svg>';
    a.appendChild(play);
    a.appendChild(el('span','slug', info.slug));
    return a;
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
    document.querySelectorAll('.tab').forEach(function(t){
      if(t.dataset.tab === name) t.setAttribute('aria-current','page'); else t.removeAttribute('aria-current');
    });
    $('#board-title').textContent = TITLES[name];
    $('#board-count').textContent = tabCount(name);
    if(focus){ $('#board-title').focus({preventScroll:true}); window.scrollTo(0,0); }
  }
  document.querySelectorAll('.tab').forEach(function(t){
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
    if(f.game) row(dl, 'Jeu préféré', document.createTextNode(f.game));
    if(f.clip){
      var info = clipInfo(f.clip);
      row(dl, 'Clip préféré', info ? clipTile(info, f.clipThumb) : document.createTextNode(f.clip));
    }
    if(f.word && mod){
      var w = el('div','word'); w.appendChild(safeFragment(f.word));
      row(dl, 'Son mot', w);
    }
    c.appendChild(dl);
    if(mod){
      if(f.at){
        var d = new Date(f.at);
        if(!isNaN(d)) c.insertBefore(el('p','meta','Reçue le ' + d.toLocaleString('fr-FR', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' })), dl);
      }
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
      var m = map[info.url] = map[info.url] || { info:info, thumb:null, who:[] };
      if(f.clipThumb && !m.thumb) m.thumb = f.clipThumb;
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
      card.appendChild(clipTile(c.info, c.thumb));
      card.appendChild(el('h3', null, c.info.slug));
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
    if(!previewing){ $('#mgate').hidden = false; $('#mboard').hidden = true; return; }
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
    $('#z-prev').hidden = $('#z-next').hidden = zList.length < 2;
    if(!zoom.open) zoom.showModal();
  }
  $('#z-prev').addEventListener('click', function(){ openZoom(zIdx - 1); });
  $('#z-next').addEventListener('click', function(){ openZoom(zIdx + 1); });
  zoom.addEventListener('keydown', function(e){
    if(e.key === 'ArrowLeft'){ openZoom(zIdx - 1); }
    if(e.key === 'ArrowRight'){ openZoom(zIdx + 1); }
  });
  zoom.addEventListener('click', function(e){ if(e.target === zoom) zoom.close(); });
})();
