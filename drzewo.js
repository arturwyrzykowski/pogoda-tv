/* Pory roku na żywo: drzewo na górnej krawędzi panelu pogody (wolne miejsce w nagłówku).
   - wygląd wg daty: przedwiośnie (pąki), wiosna (kwiaty), lato, późne lato (jabłka), złota jesień, późna jesień, zima (gołe gałęzie)
   - na żywo z Open-Meteo: wiatr -> kołysanie i spadające liście, opad śniegu -> płatki, pokrywa śnieżna -> śnieg na gałęziach i ziemi
   - lekko dla TV: kołysze się cały element (transform), liście/płatki tylko transform+opacity
   Testy: #pora=przedwiosnie|wiosna|lato|pozne-lato|jesien|pozna-jesien|zima, #snieg (pada + pokrywa) */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var tree = $("tree"), sway = tree.querySelector(".tr-sway"), svg = $("treeSvg"), lbl = $("treeLbl"), snowL = $("snowLayer");

  // ---------- budowa drzewa (stałe ziarno = zawsze to samo drzewo) ----------
  var seed = 20261011;
  function rnd(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  var branches = [], clusters = [];
  function grow(x, y, ang, len, w, depth){
    var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    var mx = (x + x2) / 2 + (rnd() - 0.5) * len * 0.18, my = (y + y2) / 2 + (rnd() - 0.5) * len * 0.12;
    branches.push({ x:x, y:y, mx:mx, my:my, x2:x2, y2:y2, w:w, d:depth });
    if (depth <= 3){
      var n = depth === 0 ? 2 : depth === 3 ? 2 : 1;
      for (var i = 0; i < n; i++) clusters.push({ x:x2 + (rnd() - 0.5) * 16, y:y2 + (rnd() - 0.35) * 14, r:7 + rnd() * 6, k:rnd(), c:rnd() });
    }
    if (depth === 0) return;
    var kids = depth >= 5 ? 2 : (rnd() < 0.35 ? 3 : 2);
    for (var j = 0; j < kids; j++){
      var a = ang + (j - (kids - 1) / 2) * (0.46 + rnd() * 0.14) + (rnd() - 0.5) * 0.22;
      a += (-Math.PI / 2 - a) * 0.12;                        // lekko ku gorze = okragla korona
      a = Math.max(-Math.PI + 0.25, Math.min(-0.25, a));       // galezie nie rosna w dol
      grow(x2, y2, a, len * (0.74 + rnd() * 0.1), w * 0.66, depth - 1);
    }
  }
  grow(100, 196, -Math.PI / 2, 34, 11, 6);

  var SEASONS = {
    "przedwiosnie": { name:"przedwiośnie", leaves:["#a6e07f","#8fd06c"], keep:0.55, scale:0.35, ground:"#3b4a2c" },
    "wiosna":       { name:"wiosna",       leaves:["#86d36d","#68bd5c","#9be07a"], keep:1, scale:0.8, ground:"#3f6b34", blossom:["#ffd3e6","#ffffff","#ffb3d1"] },
    "lato":         { name:"lato",         leaves:["#3f9a4a","#2f7f3d","#56b25a"], keep:1, scale:1, ground:"#2f5a2c" },
    "pozne-lato":   { name:"późne lato",   leaves:["#3f8f45","#5aa24a","#7aa83f"], keep:1, scale:1, ground:"#4a5a2c", fruit:"#e04a3a" },
    "jesien":       { name:"złota jesień", leaves:["#f2b531","#e8892b","#d4562a","#e0c040","#8aa84a"], keep:0.92, scale:0.95, ground:"#5a4426", fall:["#f2b531","#e8892b","#d4562a"] },
    "pozna-jesien": { name:"późna jesień", leaves:["#b8682e","#9a5a2a","#d08a3a"], keep:0.2, scale:0.8, ground:"#4a3a26", fall:["#b8682e","#d08a3a","#9a5a2a"] },
    "zima":         { name:"zima",         leaves:[], keep:0, scale:0, ground:"#3a4250" }
  };
  function seasonFor(d){
    var m = d.getMonth() + 1, day = d.getDate(), md = m * 100 + day;
    if (md >= 1201 || md < 301) return "zima";
    if (md < 415) return "przedwiosnie";
    if (md < 521) return "wiosna";
    if (md < 811) return "lato";
    if (md < 916) return "pozne-lato";
    if (md < 1021) return "jesien";
    return "pozna-jesien";
  }

  var live = { wind:8, snowing:false, snowCover:false };
  var forced = (/pora=([a-z-]+)/.exec(location.hash) || [])[1];
  var testSnow = /snieg/.test(location.hash);
  var cur = null;

  function f1(v){ return v.toFixed(1); }
  function draw(key){
    var S = SEASONS[key], s = "", snow = live.snowCover || testSnow;
    // ziemia
    s += '<ellipse cx="100" cy="197" rx="62" ry="6" fill="' + (snow ? "#dfe8f2" : S.ground) + '" opacity="' + (snow ? 0.9 : 0.75) + '"/>';
    // galezie
    var bc = "#5b3d27";
    branches.forEach(function(b){
      s += '<path d="M' + f1(b.x) + " " + f1(b.y) + "Q" + f1(b.mx) + " " + f1(b.my) + " " + f1(b.x2) + " " + f1(b.y2) + '" stroke="' + bc + '" stroke-width="' + f1(Math.max(0.8, b.w)) + '" stroke-linecap="round" fill="none"/>';
    });
    // snieg na galeziach
    if (snow){
      branches.forEach(function(b){
        if (b.w < 1.2) return;
        var o = b.w * 0.42;
        s += '<path d="M' + f1(b.x) + " " + f1(b.y - o) + "Q" + f1(b.mx) + " " + f1(b.my - o) + " " + f1(b.x2) + " " + f1(b.y2 - o) + '" stroke="#f4f8ff" stroke-width="' + f1(b.w * 0.45) + '" stroke-linecap="round" fill="none" opacity=".95"/>';
      });
    }
    // liscie
    if (S.leaves.length){
      clusters.forEach(function(c){
        if (c.k > S.keep) return;
        var col = S.leaves[Math.floor(c.c * S.leaves.length)];
        s += '<circle cx="' + f1(c.x) + '" cy="' + f1(c.y) + '" r="' + f1(c.r * S.scale) + '" fill="' + col + '" opacity=".93"/>';
      });
      if (snow) clusters.forEach(function(c){ if (c.k <= S.keep && c.k < 0.5) s += '<circle cx="' + f1(c.x) + '" cy="' + f1(c.y - c.r * S.scale * 0.6) + '" r="' + f1(c.r * S.scale * 0.55) + '" fill="#f4f8ff"/>'; });
    }
    if (S.blossom) clusters.forEach(function(c){
      if (c.k > 0.65) return;
      for (var i = 0; i < 3; i++){
        var a = c.c * 6.28 + i * 2.1;
        s += '<circle cx="' + f1(c.x + Math.cos(a) * c.r * 0.55) + '" cy="' + f1(c.y + Math.sin(a) * c.r * 0.55) + '" r="2.2" fill="' + S.blossom[i % S.blossom.length] + '"/>';
      }
    });
    if (S.fruit) clusters.forEach(function(c){ if (c.k < 0.07) s += '<circle cx="' + f1(c.x + 2) + '" cy="' + f1(c.y + 3) + '" r="3" fill="' + S.fruit + '"/><circle cx="' + f1(c.x + 1.2) + '" cy="' + f1(c.y + 2) + '" r=".9" fill="#fff" opacity=".6"/>'; });
    svg.innerHTML = s;
    lbl.textContent = S.name + (live.snowing || testSnow ? " · pada śnieg" : snow ? " · śnieg" : "");
  }

  function update(){
    var key = SEASONS[forced] ? forced : seasonFor(new Date());
    var sig = key + "|" + live.snowCover + "|" + live.snowing;
    if (sig !== cur){ cur = sig; draw(key); }
    // kolysanie od wiatru (na zywo)
    var w = Math.min(60, live.wind || 0);
    tree.style.setProperty("--sa", (0.5 + w / 15).toFixed(2) + "deg");
    tree.style.setProperty("--sd", Math.max(2.2, 6.5 - w / 11).toFixed(2) + "s");
    snowL.classList.toggle("on", live.snowing || testSnow);
  }

  // ---------- pozycja: wolne miejsce w naglowku, korzenie na gornej krawedzi panelu ----------
  function place(){
    var hero = document.querySelector(".hero"), al = $("alerts"), mid = document.querySelector(".head-mid"), right = document.querySelector(".head-right");
    if (!hero || !mid || !right || window.innerWidth <= 900){ tree.classList.remove("on"); return; }
    var anchor = (al && !al.hidden) ? al : hero, top = anchor.getBoundingClientRect().top;
    var l = mid.getBoundingClientRect().right + 24, r = right.getBoundingClientRect().left - 24, free = r - l;
    var size = Math.min(top - 12, 240, free);
    if (size < 70){ tree.classList.remove("on"); return; }
    tree.style.width = size + "px"; tree.style.height = size + "px";
    tree.style.left = (l + (free - size) / 2) + "px"; tree.style.top = (top - size + 3) + "px";
    tree.classList.add("on");
    snowL.style.height = top + "px";
  }

  // ---------- spadajace liscie / platki kwiatow ----------
  function dropLeaf(){
    var key = SEASONS[forced] ? forced : seasonFor(new Date()), S = SEASONS[key];
    var cols = S.fall || (S.blossom && key === "wiosna" ? S.blossom : null);
    if (cols && tree.classList.contains("on") && !document.hidden){
      var c = clusters[Math.floor(rnd() * clusters.length)], sz = tree.clientWidth / 200;
      var el = document.createElement("i");
      el.className = "tr-leaf";
      el.style.left = (c.x * sz) + "px"; el.style.top = (c.y * sz) + "px";
      el.style.background = cols[Math.floor(Math.random() * cols.length)];
      var drift = (Math.random() - 0.3) * (20 + (live.wind || 0) * 2);
      el.style.setProperty("--dx", drift.toFixed(0) + "px");
      el.style.setProperty("--dy", ((196 - c.y) * sz).toFixed(0) + "px");
      var ld = 3 + Math.random() * 2.5;
      el.style.setProperty("--ld", ld.toFixed(1) + "s");
      el.addEventListener("animationend", function(){ el.remove(); });
      setTimeout(function(){ if (el.parentNode) el.remove(); }, (ld + 1) * 1000);   // zapas, gdyby TV nie zglosil konca animacji
      tree.appendChild(el);
    }
    var gap = Math.max(1500, 7000 - (live.wind || 0) * 150) * (0.6 + Math.random() * 0.8);
    setTimeout(dropLeaf, gap);
  }

  // ---------- platki sniegu (tylko gdy naprawde pada) ----------
  (function(){
    for (var i = 0; i < 55; i++){
      var f = document.createElement("i");
      f.className = "flake";
      var s = 2.5 + Math.random() * 4;
      f.style.width = f.style.height = s.toFixed(1) + "px";
      f.style.left = (Math.random() * 100).toFixed(1) + "%";
      f.style.opacity = (0.45 + Math.random() * 0.45).toFixed(2);
      f.style.animationDuration = (7 + Math.random() * 7).toFixed(1) + "s";
      f.style.animationDelay = (-Math.random() * 14).toFixed(1) + "s";
      f.style.setProperty("--fx", ((Math.random() - 0.5) * 60).toFixed(0) + "px");
      snowL.appendChild(f);
    }
  })();

  // ---------- dane na zywo z Open-Meteo ----------
  var SNOW_CODES = { 71:1, 73:1, 75:1, 77:1, 85:1, 86:1 };
  function onMeteo(j){
    var c = j.current || {};
    live.wind = c.wind_speed_10m || 0;
    live.snowing = !!SNOW_CODES[c.weather_code] || (c.snowfall || 0) > 0;
    live.snowCover = (c.snow_depth || 0) >= 0.01 || live.snowing;
    update();
  }
  if (window.METEO_HOOKS) window.METEO_HOOKS.push(onMeteo);
  if (window.LAST_METEO) onMeteo(window.LAST_METEO);

  update(); place();
  window.addEventListener("resize", place);
  window.addEventListener("load", function(){ setTimeout(place, 300); });
  setTimeout(place, 1500);
  setInterval(function(){ update(); place(); }, 60000);
  setTimeout(dropLeaf, 4000);
})();
