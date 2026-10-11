/* Panel monitoringu (Zambski Kościelne):
   - Narew: historia z wodowskazu IMGW-PIB (hydro.imgw.pl), wykres 24 h / 7 dni
   - Temperatura: historia godzinowa Open-Meteo, wykres 24 h / 7 dni
   - Radar opadów: RainViewer (kafle z6/512) na własnej mapie Natural Earth
   - Księżyc i nocne niebo: obliczenia lokalne (algorytmy jak w SunCalc, V. Agafonkin, BSD) + zachmurzenie Open-Meteo
   - Ostrzeżenia: oficjalne IMGW-PIB (powiat pułtuski, TERYT 1424) + progi z prognozy Open-Meteo
   Lekko dla TV: SVG/canvas bez nieskończonych animacji, radar animuje się tylko gdy widoczny. */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var LAT = 52.7559, LON = 21.2154;
  var H = 3600 * 1000, DAY = 24 * H;
  var p2 = function(n){ return (n < 10 ? "0" : "") + n; };
  var hm = function(t){ var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };
  var DN = ["Ndz","Pon","Wt","Śr","Czw","Pt","Sob"];
  function dayLbl(t){
    var d = new Date(t), n = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var k = Math.round((a - b) / DAY);
    if (k === 0) return "dziś"; if (k === 1) return "jutro"; if (k === -1) return "wczoraj";
    return p2(d.getDate()) + "." + p2(d.getMonth() + 1);
  }
  var when = function(t){ return dayLbl(t) + " " + hm(t); };
  var fmt1 = function(v){ return (Math.round(v * 10) / 10).toFixed(1).replace(".", ","); };
  var sign = function(v, unit){ return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v) + (unit || ""); };
  function lsGet(k, def){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch(e){ return def; } }
  function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function getJSON(url, ms){
    return Promise.race([
      fetch(url, { cache:"no-store" }).then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error("timeout")); }, ms || 20000); })
    ]);
  }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }

  /* ================= WYKRES (SVG) ================= */
  // pts: [{t,v}] posortowane; o: {from,to,range,color,unit,dec,minSpan,refs:[{v,label,color}],gap,markMinMax,anim}
  function drawChart(svg, pts, o){
    var box = svg.parentNode, W = box.clientWidth, Hh = box.clientHeight;
    if (W < 40 || Hh < 40){ svg._pending = o; return; }   // panel jeszcze bez rozmiaru - narysuje ResizeObserver
    svg._pending = null;
    var L = 38, R = 12, T = 12, B = 20, pw = W - L - R, ph = Hh - T - B;
    var data = pts.filter(function(p){ return p.t >= o.from && p.t <= o.to && isFinite(p.v); });
    var s = '<defs><linearGradient id="g_' + svg.id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.color + '" stop-opacity=".28"/><stop offset="1" stop-color="' + o.color + '" stop-opacity="0"/></linearGradient></defs>';
    if (data.length < 2){
      svg.innerHTML = s + '<text class="ch-lbl" x="' + (W / 2) + '" y="' + (Hh / 2) + '" text-anchor="middle">' + esc(o.empty || "za mało danych do wykresu") + '</text>';
      return;
    }
    var mn = Infinity, mx = -Infinity;
    data.forEach(function(p){ if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; });
    var dmn = mn, dmx = mx;
    (o.refs || []).forEach(function(r){ if (r.v <= mx + (mx - mn + o.minSpan) * 1.2 && r.v >= mn - (mx - mn + o.minSpan)) { mn = Math.min(mn, r.v); mx = Math.max(mx, r.v); } });
    if (mx - mn < o.minSpan){ var c = (mx + mn) / 2; mn = c - o.minSpan / 2; mx = c + o.minSpan / 2; }
    var pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    var X = function(t){ return L + (t - o.from) / (o.to - o.from) * pw; };
    var Y = function(v){ return T + (1 - (v - mn) / (mx - mn)) * ph; };
    // siatka + etykiety Y
    for (var i = 0; i <= 2; i++){
      var v = mn + (mx - mn) * (i / 2), y = Y(v);
      s += '<line class="ch-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
      s += '<text class="ch-lbl" x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + (o.dec ? fmt1(v) : Math.round(v)) + '</text>';
    }
    // os czasu
    var ticks = [], d0 = new Date(o.from);
    if (o.range === "7d"){
      var t0 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1).getTime();
      for (var t = t0; t <= o.to; t += DAY) ticks.push([t, DN[new Date(t).getDay()]]);
    } else {
      var st = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), Math.ceil(d0.getHours() / 6) * 6).getTime();
      if (st < o.from) st += 6 * H;
      for (var t2 = st; t2 <= o.to; t2 += 6 * H) ticks.push([t2, hm(t2)]);
    }
    ticks.forEach(function(k){
      var x = X(k[0]);
      s += '<line class="ch-grid" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + T + '" y2="' + (T + ph) + '" stroke-dasharray="2 4"/>';
      s += '<text class="ch-lbl" x="' + x.toFixed(1) + '" y="' + (Hh - 4) + '" text-anchor="' + (o.range === "7d" ? "start" : "middle") + '"' + (o.range === "7d" ? ' dx="4"' : "") + '>' + k[1] + '</text>';
    });
    // linie odniesienia (stan ostrzegawczy / alarmowy)
    (o.refs || []).forEach(function(r){
      if (r.v < mn || r.v > mx) return;
      var y = Y(r.v);
      s += '<line class="ch-ref" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + r.color + '"/>';
      s += '<text class="ch-lbl" x="' + (W - R) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end" fill="' + r.color + '" style="fill:' + r.color + '">' + esc(r.label) + '</text>';
    });
    // linia (przerwy przy brakach danych)
    var segs = [], cur = [];
    data.forEach(function(p, k){
      if (k && p.t - data[k - 1].t > (o.gap || 3 * H)){ if (cur.length) segs.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segs.push(cur);
    var line = "", area = "", len = 0;
    segs.forEach(function(sg){
      var d = "";
      sg.forEach(function(p, k){
        var x = X(p.t), y = Y(p.v);
        d += (k ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        if (k){ var q = sg[k - 1]; len += Math.sqrt(Math.pow(x - X(q.t), 2) + Math.pow(y - Y(q.v), 2)); }
      });
      line += d;
      if (sg.length > 1) area += d + "L" + X(sg[sg.length - 1].t).toFixed(1) + " " + (T + ph) + "L" + X(sg[0].t).toFixed(1) + " " + (T + ph) + "Z";
    });
    len = Math.ceil(len) + 10;
    s += '<g class="' + (o.anim ? "ch-anim" : "") + '">';
    s += '<path class="ch-area" d="' + area + '" fill="url(#g_' + svg.id + ')"/>';
    s += '<path class="ch-line" d="' + line + '" stroke="' + o.color + '" style="--len:' + len + ';stroke-dasharray:' + len + '"/>';
    s += '<g class="ch-dots">';
    if (o.markMinMax){
      var pmn = data[0], pmx = data[0];
      data.forEach(function(p){ if (p.v < pmn.v) pmn = p; if (p.v > pmx.v) pmx = p; });
      var lastP = data[data.length - 1];
      [[pmx, -8, "max "], [pmn, 16, "min "]].forEach(function(m){
        if (m[0] === lastP || X(lastP.t) - X(m[0].t) < 50) return;   // nie zaslaniaj biezacego odczytu
        var x = X(m[0].t), y = Y(m[0].v), anc = x < L + 40 ? "start" : x > W - R - 40 ? "end" : "middle";
        s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.5" fill="' + o.color + '"/>';
        s += '<text class="ch-lbl" x="' + x.toFixed(1) + '" y="' + (y + m[1]).toFixed(1) + '" text-anchor="' + anc + '">' + m[2] + fmt1(m[0].v) + '°</text>';
      });
    }
    var lp = data[data.length - 1], lx = X(lp.t), ly = Y(lp.v);
    s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="7" fill="' + o.color + '" opacity=".22"/>';
    s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3.8" fill="' + o.color + '" stroke="#000" stroke-width="1.5"/>';
    s += '<text class="ch-val" x="' + (lx - 9).toFixed(1) + '" y="' + (ly - 10).toFixed(1) + '" text-anchor="end">' + (o.dec ? fmt1(lp.v) : Math.round(lp.v)) + (o.unit || "") + '</text>';
    s += '</g></g>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
    svg.innerHTML = s;
    void dmn; void dmx;
  }

  /* ================= PANEL: przełączanie widoków ================= */
  var VIEWS = ["narew", "temp", "radar", "sky"];
  var VEL = { narew:"vNarew", temp:"vTemp", radar:"vRadar", sky:"vSky" };
  var mon = $("mon"), cur = null, vi = -1, range = "24", rotT = null, pauseUntil = 0;
  var isNight = false;
  function dwell(v){ return v === "radar" ? 22000 : v === "sky" ? (isNight ? 30000 : 12000) : 16000; }
  function show(v, opts){
    opts = opts || {};
    cur = v; vi = VIEWS.indexOf(v);
    VIEWS.forEach(function(k){ $(VEL[k]).classList.toggle("on", k === v); });
    var bs = mon.querySelectorAll(".mon-tabs button");
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-v") === v);
    var rg = $("monRange");
    rg.hidden = !(v === "narew" || v === "temp");
    rg.textContent = range === "24" ? "24 h" : "7 dni";
    render(v, true);
    radarActive(v === "radar" || !$("radarBig").hidden);
    // pasek postepu
    var pr = $("monProg"), d = opts.ms || dwell(v);
    pr.classList.remove("run"); void pr.offsetWidth;
    if (opts.rest) return;   // na radarze domyslnym bez paska odliczania
    pr.style.animationDuration = d + "ms"; pr.classList.add("run");
  }
  function render(v, anim){
    if (v === "narew") renderNarew(anim);
    else if (v === "temp") renderTemp(anim);
    else if (v === "radar") placeRadar();
    else if (v === "sky") renderSky();
  }
  function next(){
    clearTimeout(rotT);
    if (Date.now() < pauseUntil || !$("radarBig").hidden){ rotT = setTimeout(next, 5000); return; }
    show("radar", { rest:true });   // domyslnie panel stoi na radarze (bez automatycznego przelaczania)
  }
  function manual(v){
    pauseUntil = Date.now() + 90000;   // reczny wybor: 90 s bez automatu
    show(v, { ms:90000 });
    clearTimeout(rotT); rotT = setTimeout(next, 90000);
  }
  function toggleRange(){
    range = range === "24" ? "7d" : "24";
    if (cur === "narew" || cur === "temp") manual(cur); else manual("narew");
  }
  (function(){
    var bs = mon.querySelectorAll(".mon-tabs button");
    for (var i = 0; i < bs.length; i++) bs[i].addEventListener("click", function(){ manual(this.getAttribute("data-v")); });
    $("monRange").addEventListener("click", toggleRange);
  })();
  // przerysuj, gdy panel zmieni rozmiar (wczytanie czcionek, pasek ostrzezen, obrot ekranu)
  if (window.ResizeObserver){
    var lastSz = "";
    new ResizeObserver(function(){
      var b = document.querySelector(".mon-body"), sz = b.clientWidth + "x" + b.clientHeight;
      if (sz === lastSz) return; lastSz = sz;
      clearTimeout(rsT); rsT = setTimeout(function(){ if (cur) render(cur, !!($("nwChart")._pending || $("thChart")._pending)); placeRadar(); }, 150);
    }).observe(document.querySelector(".mon-body"));
  }
  window.addEventListener("load", function(){ setTimeout(function(){ if (cur) render(cur, false); placeRadar(); }, 300); });
  var rsT = null;
  window.addEventListener("resize", function(){ clearTimeout(rsT); rsT = setTimeout(function(){ if (cur) render(cur, false); placeRadar(); }, 250); });

  /* ================= NAREW ================= */
  var NW = { id:"152210060", warn:420, alarm:480 };
  var HB = "https://hydro-back.imgw.pl";
  var nw = null; // {pts, cur:{t,v}, prev:{t,v}, src, since, tw, twT}
  function near(pts, t, tol){
    var best = null, bd = Infinity;
    for (var i = 0; i < pts.length; i++){ var d = Math.abs(pts[i].t - t); if (d < bd){ bd = d; best = pts[i]; } }
    return bd <= tol ? best : null;
  }
  function loadNarew(){
    var hist = null, curS = null, prevS = null, tw = null, twT = null;
    var pHist = getJSON(HB + "/station/hydro/status/data?id=" + NW.id + "&hoursInterval=168").then(function(d){
      hist = (d.operational || []).map(function(o){ return { t:Date.parse(o.date), v:+o.value }; })
        .filter(function(p){ return isFinite(p.t) && isFinite(p.v); }).sort(function(a, b){ return a.t - b.t; });
      if (d.warningValues && d.warningValues.length) NW.warn = +d.warningValues[d.warningValues.length - 1].value || NW.warn;
      if (d.alarmValues && d.alarmValues.length) NW.alarm = +d.alarmValues[d.alarmValues.length - 1].value || NW.alarm;
    }).catch(function(){});
    var pStat = getJSON(HB + "/station/hydro/status?id=" + NW.id).then(function(d){
      var s = d.status || {};
      if (s.currentState) curS = { t:Date.parse(s.currentState.date), v:+s.currentState.value };
      if (s.previousState) prevS = { t:Date.parse(s.previousState.date), v:+s.previousState.value };
    }).catch(function(){});
    // oficjalne API danych publicznych (czas w UTC): temperatura wody + zapas, gdy hydro-back nie odpowie
    var pPub = getJSON("https://danepubliczne.imgw.pl/api/data/hydro/id/" + NW.id).then(function(a){
      var d = a[0];
      if (d.temperatura_wody){ tw = parseFloat(d.temperatura_wody); twT = Date.parse(String(d.temperatura_wody_data_pomiaru).replace(" ", "T") + "Z"); }
      var v = parseInt(d.stan_wody, 10), t = Date.parse(String(d.stan_wody_data_pomiaru).replace(" ", "T") + "Z");
      if (!isNaN(v) && isFinite(t)) return { t:t, v:v, w:parseInt(d.stan_ostrzegawczy, 10), a:parseInt(d.stan_alarmowy, 10) };
    }).catch(function(){});
    return Promise.all([pHist, pStat, pPub]).then(function(r){
      var pub = r[2];
      if (!curS && pub){ curS = { t:pub.t, v:pub.v }; if (pub.w) NW.warn = pub.w; if (pub.a) NW.alarm = pub.a; }
      if (!curS && hist && hist.length) curS = hist[hist.length - 1];
      // wlasna historia (zapas) - zapisujemy kazdy rzeczywisty odczyt
      var own = lsGet("narewOwn", []);
      if (curS && (!own.length || own[own.length - 1].t !== curS.t)) own.push({ t:curS.t, v:curS.v });
      own = own.filter(function(p){ return Date.now() - p.t < 8 * DAY; });
      lsSet("narewOwn", own);
      if (!curS){ if (!nw) { $("narewDesc").textContent = "brak danych"; $("nwFoot").textContent = "IMGW-PIB · brak połączenia z serwerem"; } return; }
      var src = "imgw", pts = hist;
      if (!pts || pts.length < 2){ src = "own"; pts = own.slice(); }
      if (curS && (!pts.length || curS.t > pts[pts.length - 1].t)) pts.push(curS);
      if (!prevS){ for (var i = pts.length - 1; i >= 0; i--) if (pts[i].t < curS.t){ prevS = pts[i]; break; } }
      nw = { pts:pts, cur:curS, prev:prevS, src:src, since:own.length ? own[0].t : curS.t, tw:tw, twT:twT, fresh:true };
      updateNarewHero();
      if (cur === "narew") renderNarew(true);
    });
  }
  function narewStats(){
    var c = nw.cur, d3 = near(nw.pts, c.t - 3 * H, 50 * 60000), d24 = near(nw.pts, c.t - DAY, 50 * 60000);
    var tr = d3 ? c.v - d3.v : null;
    var trend = tr === null ? null : tr >= 2 ? ["▲ rośnie", "var(--sun)", "▲" + tr] : tr <= -2 ? ["▼ opada", "var(--cold)", "▼" + (-tr)] : ["▬ stabilnie", "var(--ink-dim)", "▬"];
    var state = ["w normie", "var(--good)"];
    if (c.v >= NW.alarm) state = ["stan alarmowy", "var(--hot)"]; else if (c.v >= NW.warn) state = ["stan ostrzegawczy", "var(--warn)"];
    return { trend:trend, state:state, d24:d24 ? c.v - d24.v : null };
  }
  function updateNarewHero(){
    var s = narewStats(), c = nw.cur;
    $("narew").textContent = Math.round(c.v);
    $("narew").style.color = s.state[1];
    $("narewDesc").textContent = (s.state[0] === "w normie" ? "w normie" : s.state[0].replace("stan ", "")) + (s.trend ? " " + s.trend[2] : "");
    $("narewDesc").style.color = s.state[1];
    $("narew").parentNode.title = "IMGW-PIB, pomiar " + when(c.t) + " · ostrzegawczy " + NW.warn + " cm, alarmowy " + NW.alarm + " cm";
  }
  function renderNarew(anim){
    if (!nw) return;
    var s = narewStats(), c = nw.cur;
    $("nwNow").innerHTML = Math.round(c.v) + "<small>cm</small>";
    $("nwNow").style.color = s.state[1];
    $("nwTrend").textContent = s.trend ? s.trend[0] : "trend: za mało danych";
    $("nwTrend").style.color = s.trend ? s.trend[1] : "var(--ink-faint)";
    $("nwState").textContent = s.state[0];
    $("nwState").style.color = s.state[1];
    $("nwPrev").textContent = nw.prev ? sign(Math.round(c.v - nw.prev.v), " cm") + " (" + hm(nw.prev.t) + ")" : "—";
    $("nwDay").textContent = s.d24 === null ? "brak danych" : sign(Math.round(s.d24), " cm");
    $("nwTw").innerHTML = nw.tw != null && isFinite(nw.tw) ? "woda <b>" + fmt1(nw.tw) + "°C</b>" : "";
    var to = Date.now(), from = to - (range === "7d" ? 7 : 1) * DAY;
    var foot = $("nwFoot");
    if (nw.src === "own"){
      foot.className = "mv-foot note";
      foot.textContent = "Brak historii z IMGW — własny zapis od " + when(nw.since) + " · pomiar " + when(c.t);
    } else {
      foot.className = "mv-foot";
      foot.textContent = "IMGW-PIB · wodowskaz Zambski Kościelne · ostatni pomiar " + when(c.t);
    }
    drawChart($("nwChart"), nw.pts, { from:from, to:to, range:range, color:"#57b6ff", unit:" cm", dec:false, minSpan:10, gap:range === "7d" ? 4 * H : 2 * H,
      refs:[{ v:NW.warn, label:"ostrzegawczy " + NW.warn, color:"#ffcf5c" }, { v:NW.alarm, label:"alarmowy " + NW.alarm, color:"#ff8a6b" }],
      anim:anim || nw.fresh, empty:"za mało pomiarów w tym zakresie" });
    nw.fresh = false;
  }

  /* ================= TEMPERATURA ================= */
  var th = lsGet("tempCache", null);  // {pts:[{t,v}], cur:{t,v}, src}
  var thFresh = false;
  function onMeteoTemp(j){
    var Hh = j.hourly, now = Date.now(), pts = [];
    for (var i = 0; i < Hh.time.length; i++){
      var t = new Date(Hh.time[i]).getTime();     // czas lokalny (timezone=Europe/Warsaw)
      if (t <= now && now - t <= 7 * DAY + H && Hh.temperature_2m[i] != null) pts.push({ t:t, v:Hh.temperature_2m[i] });
    }
    var c = { t:now, v:j.current.temperature_2m };
    // wlasne odczyty biezace (dopisywane przy kazdym odswiezeniu, zostaja po restarcie)
    var own = lsGet("tempOwn", []);
    own.push(c); own = own.filter(function(p){ return now - p.t < 7 * DAY; });
    lsSet("tempOwn", own);
    pts.push(c);
    th = { pts:pts, cur:c, src:"om", at:now };
    lsSet("tempCache", th);
    thFresh = true;
    if (cur === "temp") renderTemp(true);
  }
  function renderTemp(anim){
    if (!th){ $("thFoot").textContent = "Open-Meteo · czekam na dane"; return; }
    var to = Date.now(), from = to - (range === "7d" ? 7 : 1) * DAY;
    var pts = th.pts, sel = pts.filter(function(p){ return p.t >= from; });
    var c = th.cur;
    $("thNow").innerHTML = fmt1(c.v) + "<small>°C</small>";
    $("thNow").className = "mv-big";
    $("thNow").style.color = c.v <= 0 ? "var(--cold)" : c.v >= 24 ? "var(--hot)" : "var(--ink)";
    if (sel.length){
      var mn = sel[0], mx = sel[0];
      sel.forEach(function(p){ if (p.v < mn.v) mn = p; if (p.v > mx.v) mx = p; });
      $("thMin").textContent = fmt1(mn.v) + "° (" + (range === "7d" ? dayLbl(mn.t) + " " : "") + hm(mn.t) + ")";
      $("thMax").textContent = fmt1(mx.v) + "° (" + (range === "7d" ? dayLbl(mx.t) + " " : "") + hm(mx.t) + ")";
    }
    var y = near(pts, c.t - DAY, 50 * 60000);
    $("thTrend").textContent = y ? "względem wczoraj " + (c.v - y.v >= 0 ? "+" : "−") + fmt1(Math.abs(c.v - y.v)) + "°" : "";
    $("thTrend").style.color = "var(--ink-dim)";
    $("thSpan").textContent = range === "7d" ? "ostatnie 7 dni" : "ostatnie 24 h";
    var stale = Date.now() - (th.at || 0) > 30 * 60000;
    $("thFoot").className = "mv-foot" + (stale ? " note" : "");
    $("thFoot").textContent = (stale ? "Dane z pamięci (" + when(th.at) + ") · " : "") + "Open-Meteo · godzinowo + bieżący odczyt " + hm(c.t);
    drawChart($("thChart"), pts, { from:from, to:to, range:range, color:"#ffd166", unit:"°", dec:true, minSpan:4, gap:3 * H, markMinMax:true, anim:anim || thFresh });
    thFresh = false;
  }

  /* ================= RADAR (RainViewer) ================= */
  // tylko NAJNOWSZY stan radaru (bez animacji godzin); nowy pomiar podmienia sie sam, gdy wszystkie kafle sa gotowe
  var RV = { host:"", shown:null, pending:null, active:false, err:false };
  var TILES = [[35,20],[36,20],[35,21],[36,21]];   // z6, 512 px: obszar mapy-radar.svg (wycinek 34,228 720x480)
  var VX = 34, VY = 228, SITE_X = 394.2 - VX, SITE_Y = 471.0 - VY;
  var rctx = $("rCanvas").getContext("2d");
  // Paleta RainViewer "Universal Blue" (dBZ, kolor, alfa) - do odczytania natezenia z pikseli
  var UB = [[-10,0x636159,20],[-9,0x66635a,25],[-8,0x69665c,30],[-7,0x6c685d,36],[-6,0x6f6b5f,41],[-5,0x726e61,46],[-4,0x757062,52],[-3,0x787364,57],[-2,0x7c7565,62],[-1,0x7f7867,68],[0,0x827b69,73],[1,0x857d6a,78],[2,0x88806c,84],[3,0x8b826d,89],[4,0x8e856f,94],[5,0x928871,100],[6,0x9e9375,110],[7,0xaa9e79,120],[8,0xb6a97e,130],[9,0xc2b482,140],[10,0xcec087,150],[11,0xd2c48b,160],[12,0xd6c88f,170],[13,0xdacc93,180],[14,0xded097,190],[15,0x88ddee,255],[16,0x6cd1eb,255],[17,0x51c5e8,255],[18,0x36bae5,255],[19,0x1baee2,255],[20,0x00a3e0,255],[21,0x009ad5,255],[22,0x0091ca,255],[23,0x0088bf,255],[24,0x007fb4,255],[25,0x0077aa,255],[26,0x0070a3,255],[27,0x00699c,255],[28,0x006295,255],[29,0x005b8e,255],[30,0x005588,255],[31,0x005180,255],[32,0x004e78,255],[33,0x004a70,255],[34,0x004768,255],[35,0xffee00,255],[36,0xffe000,255],[37,0xffd200,255],[38,0xffc500,255],[39,0xffb700,255],[40,0xffaa00,255],[41,0xff9f00,255],[42,0xff9500,255],[43,0xff8b00,255],[44,0xff8100,255],[45,0xff4400,255],[46,0xf23600,255],[47,0xe62800,255],[48,0xd91b00,255],[49,0xcd0d00,255],[50,0xc10000,255],[51,0xa80000,255],[52,0x8f0000,255],[53,0x760000,255],[54,0x5d0000,255],[55,0xffaaff,255],[56,0xff9fff,255],[57,0xff95ff,255],[58,0xff8bff,255],[59,0xff81ff,255],[60,0xff77ff,255],[61,0xff6cff,255],[62,0xff62ff,255],[63,0xff58ff,255],[64,0xff4eff,255],[65,0xffffff,255],[66,0xffffff,255],[67,0xffffff,255],[68,0xffffff,255],[69,0xffffff,255],[70,0xffffff,255],[71,0xffffff,255],[72,0xffffff,255],[73,0xffffff,255],[74,0xffffff,255],[75,0x00ff00,255],[76,0x00ff00,255],[77,0x00ff00,255],[78,0x00ff00,255],[79,0x00ff00,255],[80,0x00ff00,255],[81,0x00ff00,255],[82,0x00ff00,255],[83,0x00ff00,255],[84,0x00ff00,255],[85,0x00ff00,255],[86,0x00ff00,255],[87,0x00ff00,255],[88,0x00ff00,255],[89,0x00ff00,255],[90,0x00ff00,255],[91,0x00ff00,255],[92,0x00ff00,255],[93,0x00ff00,255],[94,0x00ff00,255],[95,0x00ff00,255]];
  var ubCache = {};
  function ubDbz(r, g, b){
    var k = (r << 16) | (g << 8) | b;
    if (ubCache[k] !== undefined) return ubCache[k];
    var best = -99, bd = 1e9;
    for (var i = 0; i < UB.length; i++){
      var c = UB[i][1], dr = r - (c >> 16), dg = g - (c >> 8 & 255), db = b - (c & 255), d = dr * dr + dg * dg + db * db;
      if (d < bd){ bd = d; best = UB[i][0]; }
    }
    return (ubCache[k] = best);
  }
  function ubAlpha(dbz){ for (var i = 0; i < UB.length; i++) if (UB[i][0] === dbz) return UB[i][2]; return 255; }
  // wlasna paleta: slaby deszcz wyraznie widoczny na ciemnej mapie
  function myColor(d){
    if (d < -4) return null;
    if (d < 2) return [150, 220, 255, 110];             // slad opadu / bardzo slabe echo
    if (d < 10) return [130, 215, 255, 160];
    if (d < 20) return [80, 190, 255, 195];
    if (d < 30) return [40, 135, 255, 220];
    if (d < 38) return [35, 85, 235, 235];
    if (d < 45) return [255, 214, 60, 240];
    if (d < 50) return [255, 140, 40, 245];
    if (d < 55) return [255, 60, 50, 250];
    return [255, 90, 230, 255];
  }
  function intensity(d){
    if (d < -4) return ["brak opadu", "var(--ink-dim)"];
    if (d < 2) return ["ślad opadu", "#96dcff"];
    if (d < 15) return ["mżawka / bardzo słaby", "#82d7ff"];
    if (d < 25) return ["słaby deszcz", "#50beff"];
    if (d < 35) return ["umiarkowany deszcz", "#4f9bff"];
    if (d < 45) return ["silny deszcz", "#ffd63c"];
    if (d < 55) return ["ulewa", "#ff8c28"];
    return ["możliwy grad", "#ff5ae6"];
  }
  var tmpC = document.createElement("canvas"); tmpC.width = tmpC.height = 512;
  var tmpX = tmpC.getContext("2d");
  var siteDbz = null;
  function recolor(im){
    tmpX.clearRect(0, 0, 512, 512);
    tmpX.drawImage(im, 0, 0, 512, 512);
    var data;
    try { data = tmpX.getImageData(0, 0, 512, 512); } catch(e){ return null; }   // bez CORS - zostaw oryginal
    var p = data.data;
    for (var i = 0; i < p.length; i += 4){
      var a = p[i + 3]; if (!a) continue;
      var d = ubDbz(p[i], p[i + 1], p[i + 2]), c = myColor(d);
      if (!c){ p[i + 3] = 0; continue; }
      var k = Math.min(1, a / ubAlpha(d));                 // miekkie krawedzie po wygladzeniu
      p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = Math.round(c[3] * k);
    }
    // natezenie nad Zambskimi (promien ~2 km) - z oryginalnych pikseli
    var sx = Math.round(SITE_X + VX - (im._x + VX)), sy = Math.round(SITE_Y + VY - (im._y + VY));
    if (sx >= 3 && sy >= 3 && sx < 509 && sy < 509){
      var raw = tmpX.getImageData(sx - 3, sy - 3, 7, 7).data, mx = -99;
      for (var j = 0; j < raw.length; j += 4) if (raw[j + 3] > 0) mx = Math.max(mx, ubDbz(raw[j], raw[j + 1], raw[j + 2]));
      siteDbz = mx;
    }
    tmpX.putImageData(data, 0, 0);
    return tmpC;
  }
  function radarLabel(){
    var f = RV.shown; if (!f) return;
    var age = Math.round((Date.now() - f.time * 1000) / 60000);
    var it = intensity(siteDbz === null ? -99 : siteDbz);
    $("rTime").innerHTML = "stan na <b>" + hm(f.time * 1000) + "</b>" + (age >= 0 ? " · " + age + " min temu" : "")
      + ' · nad Zambskimi: <b style="color:' + it[1] + '">' + it[0] + "</b>";
  }
  function loadRadar(){
    return getJSON("https://api.rainviewer.com/public/weather-maps.json").then(function(j){
      RV.host = j.host; RV.err = false;
      var past = (j.radar && j.radar.past) || [], f = past[past.length - 1];
      if (!f){ throw new Error("brak klatek"); }
      if ((RV.shown && RV.shown.path === f.path) || (RV.pending && RV.pending.path === f.path)) return;
      RV.pending = f;
      var left = TILES.length, imgs = [];
      TILES.forEach(function(tl){
        var im = new Image();
        im.crossOrigin = "anonymous";                     // RainViewer daje CORS - mozna przemalowac piksele
        im._x = (tl[0] - 35) * 512 - VX; im._y = (tl[1] - 20) * 512 - VY;
        im.onload = im.onerror = function(){
          if (--left > 0 || RV.pending !== f) return;
          rctx.clearRect(0, 0, 720, 480);
          siteDbz = -99;
          imgs.forEach(function(x){
            if (!(x.complete && x.naturalWidth)) return;
            var c = recolor(x);
            rctx.drawImage(c || x, x._x, x._y);
          });
          RV.shown = f; RV.pending = null;
          $("rMsg").hidden = true;
          radarLabel();
        };
        im.src = RV.host + f.path + "/512/6/" + tl[0] + "/" + tl[1] + "/2/1_0.png";
        imgs.push(im);
      });
    }).catch(function(){
      RV.err = true;
      if (!RV.shown){ $("rMsg").hidden = false; $("rMsg").textContent = "Radar chwilowo niedostępny (RainViewer). Spróbuję ponownie za kilka minut."; }
    });
  }
  function radarActive(on){
    if (on === RV.active) return;
    RV.active = on;
    if (on){ loadRadar(); placeRadar(); }
  }
  function placeRadar(){
    var map = $("rmap"), inn = $("rmapIn"), big = !$("radarBig").hidden;
    var ow = map.clientWidth, oh = map.clientHeight;
    if (!ow || !oh) return;
    var k = big ? 1.0 : document.body.classList.contains("storm") ? 1.75 : 1.3;   // maly widok: blizej Zambskich (w burzy jeszcze blizej)
    var w = Math.max(ow, oh * 1.5) * k, sc = w / 720;
    var x = ow / 2 - SITE_X * sc, y = oh / 2 - SITE_Y * sc;
    x = Math.min(0, Math.max(ow - 720 * sc, x)); y = Math.min(0, Math.max(oh - 480 * sc, y));
    inn.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + sc.toFixed(4) + ")";
    var site = $("rSite"); site.style.left = (x + SITE_X * sc).toFixed(1) + "px"; site.style.top = (y + SITE_Y * sc).toFixed(1) + "px";
  }
  var bigT = null;
  function radarBig(open){
    var big = $("radarBig"), map = $("rmap");
    if (open === undefined) open = big.hidden;
    if (open){
      big.hidden = false; $("rSlotBig").appendChild(map);
      clearTimeout(bigT); bigT = setTimeout(function(){ radarBig(false); }, 120000);   // samo sie zamyka po 2 min
      radarActive(true);
    } else {
      big.hidden = true; $("rSlotSmall").appendChild(map); clearTimeout(bigT);
      radarActive(cur === "radar");
    }
    setTimeout(placeRadar, 30);
  }
  $("rmap").addEventListener("click", function(){ radarBig(); });
  // dla burza.js: pokaz radar w panelu
  window._monRadar = function(){ if (cur !== "radar") show("radar", { rest:true }); setTimeout(placeRadar, 50); };
  setInterval(function(){ if (RV.active) loadRadar(); }, 2 * 60000);   // RainViewer daje nowy pomiar co ~10 min
  setInterval(radarLabel, 30000);

  /* ================= SŁOŃCE I KSIĘŻYC (algorytmy SunCalc) ================= */
  var rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  function toDays(d){ return d / dayMs - 0.5 + J1970 - J2000; }
  function fromJ(j){ return (j + 0.5 - J1970) * dayMs; }
  function rAsc(l, b){ return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
  function decl(l, b){ return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
  function alt(Hh, phi, dec){ return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(Hh)); }
  function sidereal(d, lw){ return rad * (280.16 + 360.9856235 * d) - lw; }
  function refr(h){ if (h < 0) h = 0; return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); }
  function solM(d){ return rad * (357.5291 + 0.98560028 * d); }
  function eclL(M){ var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); return M + C + rad * 102.9372 + Math.PI; }
  function sunC(d){ var L = eclL(solM(d)); return { dec:decl(L, 0), ra:rAsc(L, 0) }; }
  function sunAlt(t){ var lw = rad * -LON, phi = rad * LAT, d = toDays(t), c = sunC(d); return alt(sidereal(d, lw) - c.ra, phi, c.dec); }
  var J0 = 0.0009;
  function sunTimes(t){
    var lw = rad * -LON, phi = rad * LAT, d = toDays(t);
    var n = Math.round(d - J0 - lw / (2 * Math.PI));
    var ds = J0 + lw / (2 * Math.PI) + n, M = solM(ds), L = eclL(M), dec = decl(L, 0);
    var Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    function set(h){
      var w = Math.acos((Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      if (isNaN(w)) return null;
      var a = J0 + (w + lw) / (2 * Math.PI) + n;
      return J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    }
    var r = {};
    [["sun", -0.833], ["civ", -6], ["nau", -12], ["ast", -18]].forEach(function(a){
      var js = set(a[1]);
      r[a[0] + "Set"] = js === null ? null : fromJ(js);
      r[a[0] + "Rise"] = js === null ? null : fromJ(Jnoon - (js - Jnoon));
    });
    return r;
  }
  function moonC(d){
    var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
    var l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
    return { ra:rAsc(l, b), dec:decl(l, b), dist:385001 - 20905 * Math.cos(M) };
  }
  function moonAlt(t){
    var lw = rad * -LON, phi = rad * LAT, d = toDays(t), c = moonC(d);
    var h = alt(sidereal(d, lw) - c.ra, phi, c.dec);
    return h + refr(h);
  }
  function moonIllum(t){
    var d = toDays(t), s = sunC(d), m = moonC(d), sd = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
    var ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction:(1 + Math.cos(inc)) / 2, phase:0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI };
  }
  function moonTimes(day){
    var t = new Date(day); t.setHours(0, 0, 0, 0); t = t.getTime();
    var hc = 0.133 * rad, h0 = moonAlt(t) - hc, rise = null, set = null, ye = 0;
    for (var i = 1; i <= 24; i += 2){
      var h1 = moonAlt(t + i * H) - hc, h2 = moonAlt(t + (i + 1) * H) - hc;
      var a = (h0 + h2) / 2 - h1, b = (h2 - h0) / 2, xe = -b / (2 * a); ye = (a * xe + b) * xe + h1;
      var dd = b * b - 4 * a * h1, roots = 0, x1 = 0, x2 = 0;
      if (dd >= 0){
        var dx = Math.sqrt(dd) / (Math.abs(a) * 2); x1 = xe - dx; x2 = xe + dx;
        if (Math.abs(x1) <= 1) roots++; if (Math.abs(x2) <= 1) roots++; if (x1 < -1) x1 = x2;
      }
      if (roots === 1){ if (h0 < 0) rise = i + x1; else set = i + x1; }
      else if (roots === 2){ rise = i + (ye < 0 ? x2 : x1); set = i + (ye < 0 ? x1 : x2); }
      if (rise !== null && set !== null) break;
      h0 = h2;
    }
    return { rise:rise !== null ? t + rise * H : null, set:set !== null ? t + set * H : null, up:ye > 0 };
  }
  function moonName(p){
    if (p < 0.03 || p > 0.97) return "nów";
    if (p < 0.22) return "sierp przybywający";
    if (p < 0.28) return "pierwsza kwadra";
    if (p < 0.47) return "przybywający garb";
    if (p < 0.53) return "pełnia";
    if (p < 0.72) return "ubywający garb";
    if (p < 0.78) return "ostatnia kwadra";
    return "sierp ubywający";
  }
  function moonSvg(phase, fr){
    var rx = (50 * Math.abs(1 - 2 * fr)).toFixed(1), d;
    if (phase <= 0.5) d = "M50 0A50 50 0 0 1 50 100A" + rx + " 50 0 0 " + (fr < 0.5 ? 0 : 1) + " 50 0Z";
    else d = "M50 0A50 50 0 0 0 50 100A" + rx + " 50 0 0 " + (fr < 0.5 ? 1 : 0) + " 50 0Z";
    return '<svg viewBox="-4 -4 108 108"><circle cx="50" cy="50" r="50" fill="#141b27" stroke="#2a3446" stroke-width="1.5"/>'
      + (fr > 0.005 ? '<path d="' + d + '" fill="#e6ebf5"/>' : "")
      + '<circle cx="50" cy="50" r="50" fill="none" stroke="#2a3446" stroke-width="1.5" opacity=".6"/></svg>';
  }
  function dur(ms){ var m = Math.round(ms / 60000), h = Math.floor(m / 60); return (h ? h + " h " : "") + p2(m % 60) + " min"; }

  // polozenie Ksiezyca: alt (rad), az od poludnia, dodatnio na zachod (rad)
  function moonPos(t){
    var lw = rad * -LON, phi = rad * LAT, d = toDays(t), c = moonC(d), Hh = sidereal(d, lw) - c.ra;
    var h = alt(Hh, phi, c.dec); h += refr(h);
    return { alt:h, az:Math.atan2(Math.sin(Hh), Math.cos(Hh) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)) };
  }
  // dla noc.js (tryb astronomiczny)
  window.ASTRO = { sunAlt:sunAlt, moonIllum:moonIllum, moonPos:moonPos, moonTimes:moonTimes, moonName:moonName, moonSvg:moonSvg };

  var meteo = null;
  function nightWindow(now){
    var today = sunTimes(now), tom = sunTimes(now + DAY);
    var dawnToday = today.nauRise || today.civRise, dusk = today.nauSet || today.civSet, dawnTom = tom.nauRise || tom.civRise;
    if (now < dawnToday) return [now, dawnToday];
    return [Math.max(now, dusk), dawnTom];
  }
  function renderSky(){
    var now = Date.now(), mi = moonIllum(now), mt = moonTimes(now), st = sunTimes(now);
    $("moonSvg").innerHTML = moonSvg(mi.phase, mi.fraction);
    $("moonName").textContent = moonName(mi.phase);
    var toFull = ((0.5 - mi.phase + 1) % 1) * 29.53, toNew = ((1 - mi.phase) % 1) * 29.53;
    $("moonPct").textContent = "oświetlenie " + Math.round(mi.fraction * 100) + "%";
    var mts = [];
    mts.push("wschód <b>" + (mt.rise ? hm(mt.rise) : "—") + "</b>");
    mts.push("zachód <b>" + (mt.set ? hm(mt.set) : "—") + "</b>");
    if (!mt.rise && !mt.set) mts = [mt.up ? "cały dzień nad horyzontem" : "dziś nie wschodzi"];
    var nxt = toFull < toNew ? "pełnia za " + Math.round(toFull) + " dni" : "nów za " + Math.round(toNew) + " dni";
    if (toFull < 0.6 || toNew < 0.6) nxt = toFull < toNew ? "pełnia dziś" : "nów dziś";
    $("moonTimes").innerHTML = mts.join(" · ") + ' · <span style="color:var(--ink-faint)">' + nxt + "</span>";
    // slonce / zmierzch
    var si;
    if (st.sunSet && now < st.sunSet && now > (st.sunRise || 0)) si = "zachód za <b>" + dur(st.sunSet - now) + "</b> (" + hm(st.sunSet) + ") · zmierzch <b>" + hm(st.civSet) + "</b>";
    else if (st.civSet && now >= st.sunSet && now < st.civSet) si = "zmierzch cywilny za <b>" + dur(st.civSet - now) + "</b> · noc astr. <b>" + (st.astSet ? hm(st.astSet) : "brak") + "</b>";
    else if (now >= (st.civSet || 0)) {
      var tm = sunTimes(now + DAY);
      si = "po zmierzchu · " + (st.astSet && now < st.astSet ? "noc astronomiczna od <b>" + hm(st.astSet) + "</b>" : "świt <b>" + hm(tm.civRise) + "</b>, wschód <b>" + hm(tm.sunRise) + "</b>");
    } else si = "przed świtem · wschód słońca <b>" + hm(st.sunRise) + "</b>";
    $("sunInfo").innerHTML = si;
    // zachmurzenie nocy + ocena
    var w = nightWindow(now);
    $("nightLbl").textContent = now >= w[0] && w[0] === now ? "Zachmurzenie do świtu" : "Zachmurzenie tej nocy (" + hm(w[0]) + "–" + hm(w[1]) + ")";
    if (!meteo){ $("nightCloud").textContent = "czekam na prognozę"; $("starScore").textContent = "—"; return; }
    var Hh = meteo.hourly, hrs = [];
    for (var i = 0; i < Hh.time.length; i++){
      var t = new Date(Hh.time[i]).getTime();
      if (t + H > w[0] && t < w[1]) hrs.push({ t:t, c:Hh.cloud_cover[i], v:Hh.visibility ? Hh.visibility[i] : null, p:Hh.precipitation ? Hh.precipitation[i] : 0 });
    }
    if (!hrs.length){ $("nightCloud").textContent = "brak danych"; $("nightBars").innerHTML = ""; $("nightHours").innerHTML = ""; $("starScore").textContent = "—"; return; }
    var avg = 0, minVis = Infinity, pr = 0, up = 0;
    hrs.forEach(function(h){ avg += h.c || 0; if (h.v != null) minVis = Math.min(minVis, h.v); pr += h.p || 0; if (moonAlt(h.t + H / 2) > 0) up++; });
    avg = avg / hrs.length; var upFrac = up / hrs.length;
    $("nightCloud").innerHTML = "średnio <b>" + Math.round(avg) + "%</b>" + (upFrac > 0.05 ? " · Księżyc nad horyzontem " + Math.round(upFrac * 100) + "% nocy" : " · Księżyc pod horyzontem");
    var bars = "";
    hrs.forEach(function(h){ bars += '<i style="height:' + Math.max(4, h.c) + '%" title="' + hm(h.t) + " " + h.c + '%"></i>'; });
    $("nightBars").innerHTML = bars;
    $("nightHours").innerHTML = "<span>" + hm(hrs[0].t) + "</span><span>" + hm(hrs[Math.floor(hrs.length / 2)].t) + "</span><span>" + hm(hrs[hrs.length - 1].t) + "</span>";
    var sc = 10 * (1 - avg / 100) - 3.5 * mi.fraction * upFrac, why = [];
    if (avg >= 60) why.push("chmury");
    if (mi.fraction * upFrac > 0.4) why.push("jasny Księżyc");
    if (minVis < 5000){ sc -= 1.5; why.push("mgła/zamglenie"); }
    if (pr > 0.3){ sc = Math.min(sc, 2); why.push("opady w nocy"); }
    sc = Math.max(0, Math.min(10, Math.round(sc * 2) / 2));
    var lab = sc >= 8 ? ["bardzo dobre", "#57d99a"] : sc >= 6 ? ["dobre", "#9fe08a"] : sc >= 4 ? ["średnie", "#ffd166"] : sc >= 2 ? ["słabe", "#ff9f45"] : ["brak szans", "#ff8a6b"];
    $("starScore").innerHTML = '<span class="star-score" style="color:#000;background:' + lab[1] + '">' + lab[0] + " · " + String(sc).replace(".", ",") + "/10</span>" + (why.length ? ' <span style="color:var(--ink-faint)">' + why.join(", ") + "</span>" : "");
  }
  function nightCheck(){
    var n = sunAlt(Date.now()) < -6 * rad;
    if (n !== isNight){ isNight = n; mon.classList.toggle("night", n); }
    if (cur === "sky") renderSky();
  }
  setInterval(nightCheck, 60000);

  /* ================= OSTRZEŻENIA + KOMUNIKATY LOKALNE ================= */
  // Pasek pod naglowkiem: oficjalne IMGW (meteo + hydro Narew), progi z prognozy Open-Meteo,
  // komunikaty lokalne z data/komunikaty.json (PGE, gmina Obryte, powiat - zbiera GitHub Actions).
  // Kazdy wpis znika sam po wygasnieciu; przy kazdym widac czas ostatniej aktualizacji zrodla.
  var official = [], ownW = [], localW = [], alIdx = 0, alT = null;
  var at = { imgw:0, own:0, local:0, localFile:0 };
  var parseLocal = function(s){ return new Date(String(s).replace(" ", "T")).getTime(); };
  function loadWarnings(){
    var now = Date.now(), meteoL = null, hydroL = null;
    var a = getJSON("https://danepubliczne.imgw.pl/api/data/warningsmeteo").then(function(ws){
      meteoL = [];
      (ws || []).forEach(function(w){
        var ter = (w.teryt || []).some(function(t){ return String(t).indexOf("1424") === 0; });
        var to = parseLocal(w.obowiazuje_do);
        if (ter && to > now) meteoL.push({ kind:"imgw", lvl:+w.stopien || 1, title:w.nazwa_zdarzenia, from:parseLocal(w.obowiazuje_od), to:to,
          prob:w.prawdopodobienstwo, issued:parseLocal(w.opublikowano), src:"IMGW-PIB" });
      });
    }).catch(function(){});
    var b = getJSON("https://danepubliczne.imgw.pl/api/data/warningshydro").then(function(ws){
      hydroL = [];
      (ws || []).forEach(function(w){
        var lvl = parseInt(w["stopień"] != null ? w["stopień"] : w.stopien, 10);
        var hit = (w.obszary || []).some(function(o){ return o.wojewodztwo === "mazowieckie" && /narew/i.test(o.opis || ""); });
        var to = parseLocal(w.data_do);
        if (hit && lvl >= 1 && to > now) hydroL.push({ kind:"hydro", lvl:lvl, title:w.zdarzenie + " (Narew)", from:parseLocal(w.data_od), to:to,
          prob:w.prawdopodobienstwo, issued:parseLocal(w.opublikowano), src:"IMGW-PIB hydro" });
      });
    }).catch(function(){});
    return Promise.all([a, b]).then(function(){
      // przy bledzie pobierania zostaja poprzednie (jeszcze wazne) ostrzezenia z tego zrodla
      var keep = function(kind){ return official.filter(function(w){ return w.kind === kind; }); };
      official = (meteoL || keep("imgw")).concat(hydroL || keep("hydro"));
      if (meteoL) at.imgw = Date.now();
      window.ALERTS_OFFICIAL = official;
      renderAlerts();
    });
  }
  function ownWarnings(j){
    var Hh = j.hourly, now = Date.now(), m = new Date().getMonth() + 1, out = [];
    var idx = [];
    for (var i = 0; i < Hh.time.length; i++){ var t = new Date(Hh.time[i]).getTime(); if (t >= now - H && t <= now + DAY) idx.push(i); }
    at.own = now;
    if (!idx.length){ ownW = []; return; }
    var tt = function(i){ return new Date(Hh.time[i]).getTime(); };
    function span(test){ var f = null, l = null; idx.forEach(function(i){ if (test(i)){ if (f === null) f = i; l = i; } }); return f === null ? null : [tt(f), tt(l) + H]; }
    var s;
    if ((s = span(function(i){ return Hh.weather_code[i] >= 95; }))) out.push({ lvl:Hh.weather_code.some(function(c, i){ return idx.indexOf(i) >= 0 && c >= 96; }) ? 2 : 1, title:"Możliwe burze", from:s[0], to:s[1] });
    var g = 0; idx.forEach(function(i){ g = Math.max(g, Hh.wind_gusts_10m[i] || 0); });
    if (g >= 70 && (s = span(function(i){ return Hh.wind_gusts_10m[i] >= 70; }))) out.push({ lvl:g >= 90 ? 2 : 1, title:"Silny wiatr — porywy do " + Math.round(g) + " km/h", from:s[0], to:s[1] });
    var sum = 0, mxh = 0; idx.forEach(function(i){ sum += Hh.precipitation[i] || 0; mxh = Math.max(mxh, Hh.precipitation[i] || 0); });
    if ((sum >= 30 || mxh >= 15) && (s = span(function(i){ return Hh.precipitation[i] >= 1; }))) out.push({ lvl:sum >= 50 ? 2 : 1, title:"Intensywne opady — do " + Math.round(sum) + " mm w 24 h", from:s[0], to:s[1] });
    var tmin = 99, tmax = -99; idx.forEach(function(i){ tmin = Math.min(tmin, Hh.temperature_2m[i]); tmax = Math.max(tmax, Hh.temperature_2m[i]); });
    // przymrozek: przy gruncie bywa o 2-3 st. zimniej niz na 2 m, wiec ostrzegamy juz od +1 st.
    if (m >= 4 && m <= 10 && tmin <= 1 && (s = span(function(i){ return Hh.temperature_2m[i] <= 1; }))) out.push({ lvl:tmin <= -2 ? 2 : 1, title:(tmin <= 0 ? "Przymrozek — do " : "Możliwy przymrozek przy gruncie — na 2 m do ") + fmt1(tmin) + "°C", from:s[0], to:s[1] });
    if ((m <= 3 || m >= 11) && tmin <= -15 && (s = span(function(i){ return Hh.temperature_2m[i] <= -15; }))) out.push({ lvl:tmin <= -20 ? 2 : 1, title:"Silny mróz — do " + fmt1(tmin) + "°C", from:s[0], to:s[1] });
    if (tmax >= 30 && (s = span(function(i){ return Hh.temperature_2m[i] >= 30; }))) out.push({ lvl:tmax >= 34 ? 2 : 1, title:"Upał — do " + fmt1(tmax) + "°C", from:s[0], to:s[1] });
    out.forEach(function(w){ w.kind = "own"; w.own = true; w.src = "prognoza Open-Meteo · orientacyjnie"; });
    ownW = out;
    renderAlerts();
  }
  function loadLocal(){
    fetch("data/komunikaty.json?t=" + Date.now(), { cache:"no-store" }).then(function(r){ if (!r.ok) throw new Error(); return r.json(); }).then(function(d){
      localW = (d.komunikaty || []).map(function(k){
        return { kind:"local", typ:k.typ, wazne:k.wazne, title:k.tytul, text:k.tekst, from:Date.parse(k.od), to:Date.parse(k.do), src:k.zrodlo };
      });
      at.localFile = Date.now();
      renderAlerts();
    }).catch(function(){});
    // kiedy automat ostatnio sprawdzil zrodla (publiczne API GitHuba, bez zapisu w repo)
    fetch("https://api.github.com/repos/arturwyrzykowski/pogoda-tv/actions/workflows/komunikaty.yml/runs?status=success&per_page=1", { cache:"no-store" })
      .then(function(r){ return r.json(); }).then(function(j){
        var run = j.workflow_runs && j.workflow_runs[0];
        if (run) { at.local = Date.parse(run.updated_at); renderAlerts(); }
      }).catch(function(){});
  }
  function updLbl(t){ return t ? "akt. " + (Date.now() - t > 20 * H ? dayLbl(t) + " " : "") + hm(t) : "akt. —"; }
  function renderAlerts(){
    var el = $("alerts"), now = Date.now();
    var live = function(w){ return w.to > now; };
    var all = official.filter(live).sort(function(a, b){ return b.lvl - a.lvl; })
      .concat(ownW.filter(live))
      .concat(localW.filter(function(w){ return live(w) && w.wazne; }))
      .concat(localW.filter(function(w){ return live(w) && !w.wazne; }));
    if (/test-ostrzezenie/.test(location.hash)) all.unshift({ kind:"own", lvl:1, title:"TEST paska ostrzeżeń", from:now, to:now + 6 * H, src:"test (#test-ostrzezenie)" });
    clearTimeout(alT);
    var was = !el.hidden;
    if (!all.length){ el.hidden = true; el.innerHTML = ""; if (was) window.dispatchEvent(new Event("resize")); return; }
    if (alIdx >= all.length) alIdx = 0;
    var w = all[alIdx], cls, ic, body, upd;
    if (w.kind === "local"){
      cls = w.typ === "prad" ? (w.wazne ? "pw imp" : "pw") : (w.wazne ? "loc imp" : "loc");
      ic = w.typ === "prad" ? "⚡" : "📢";
      body = "<b>" + esc(w.title) + "</b>" + (w.text ? " <span>· " + esc(w.text) + "</span>" : "")
        + (w.typ === "prad" ? " <span>· " + when(w.from) + " – " + hm(w.to) + "</span>" : " <span>· z " + dayLbl(w.from) + "</span>");
      upd = updLbl(at.local || at.localFile);
    } else {
      cls = w.own ? "own" : "l" + Math.min(3, Math.max(1, w.lvl)); ic = "⚠";
      body = "<b>" + esc(w.title) + "</b>" + (w.own ? "" : " <span>· stopień " + w.lvl + "</span>")
        + " <span>· " + when(w.from) + " – " + when(w.to) + "</span>"
        + (w.prob ? " <span>· prawdop. " + esc(w.prob) + "%</span>" : "")
        + (w.issued ? " <span>· wydano " + when(w.issued) + "</span>" : "");
      upd = updLbl(w.own ? at.own : at.imgw);
    }
    el.className = "alerts " + cls;
    el.innerHTML = '<span class="al-ic">' + ic + '</span><span class="al-body">' + body + '</span><span class="al-src">'
      + esc(w.src) + " · " + upd + (all.length > 1 ? " · " + (alIdx + 1) + "/" + all.length : "") + "</span>";
    el.hidden = false;
    if (!was) window.dispatchEvent(new Event("resize"));   // moneta/kot przeliczaja pozycje
    if (all.length > 1) alT = setTimeout(function(){ alIdx++; renderAlerts(); }, 9000);
  }

  /* ================= klawisze pilota / klawiatury ================= */
  document.addEventListener("keydown", function(e){
    if ($("startOverlay")) return;                    // pierwsze OK obsluguje nakladka startowa
    var wheel = $("wheel"); if (wheel && !wheel.hidden) return;   // kolo radia ma pierwszenstwo
    var k = e.key, big = !$("radarBig").hidden;
    if (big && (k === "Escape" || k === "Backspace" || k === "Enter" || e.keyCode === 10009)){ radarBig(false); e.preventDefault(); return; }
    if (k === "1") manual("narew"); else if (k === "2") manual("temp"); else if (k === "3") manual("radar"); else if (k === "4") manual("sky");
    else if (k === "0") toggleRange();
    else if (k === "5" || k === "r" || k === "R") radarBig();
  });

  /* ================= start ================= */
  function onMeteo(j){
    meteo = j;
    try { onMeteoTemp(j); } catch(err){ console.error(err); }
    try { ownWarnings(j); } catch(err){ console.error(err); }
    if (cur === "sky") renderSky();
  }
  if (window.METEO_HOOKS) window.METEO_HOOKS.push(onMeteo);
  if (window.LAST_METEO) onMeteo(window.LAST_METEO);

  nightCheck();
  loadNarew(); setInterval(loadNarew, 10 * 60000);
  loadWarnings(); setInterval(loadWarnings, 10 * 60000);
  loadLocal(); setInterval(loadLocal, 10 * 60000);
  setInterval(renderAlerts, 60000);   // wygasle znikaja same

  var m = /mon=(narew|temp|radar|sky)/.exec(location.hash);
  if (/zakres=7/.test(location.hash)) range = "7d";
  if (m){ manual(m[1]); }
  else next();                                      // start: radar
  if (/radar-duzy/.test(location.hash)) setTimeout(function(){ radarBig(true); }, 300);
})();
