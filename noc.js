/* Nocny tryb astronomiczny: po zmierzchu cywilnym (słońce < −6°) niebo nad panelem pogody
   dostaje gwiazdy, duży Księżyc w prawdziwej fazie i położeniu oraz chmury wg aktualnego zachmurzenia.
   Bez oślepiania: przygaszone kolory, płynne wejście, tylko kilka gwiazd bardzo wolno migocze,
   chmury dryfują powoli (transform). Księżyc stoi w wolnym miejscu między zegarem a radiem.
   Test: #noc (wymusza tryb), #noc&faza=0.35 (podgląd fazy i Księżyca nad horyzontem), #noc&chmury=70. */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var sky = $("nightSky"), starsEl = $("nsStars"), cloudsEl = $("nsClouds"), moonEl = $("nsMoon"), capEl = $("nsCap");
  var A = window.ASTRO;
  if (!sky || !A) return;
  var force = /noc/.test(location.hash);
  var fazaTest = (/faza=([\d.]+)/.exec(location.hash) || [])[1];
  var rad = Math.PI / 180;
  var p2 = function(n){ return (n < 10 ? "0" : "") + n; };
  var hm = function(t){ var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };

  // ---------- gwiazdy (stale ziarno, rozmieszczone raz) ----------
  var seed = 7351;
  function rnd(){ seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  var STARS = [];
  for (var i = 0; i < 90; i++){
    var m = rnd();
    STARS.push({ x:rnd() * 100, y:rnd() * 100, s:m < 0.08 ? 2.6 : m < 0.3 ? 1.9 : 1.3, o:0.25 + rnd() * 0.5, tw:rnd() < 0.14, d:4 + rnd() * 6, k:rnd() });
  }
  function drawStars(cloud){
    var keep = 1 - Math.min(0.92, cloud / 100 * 0.95), h = "";
    STARS.forEach(function(st){
      if (st.k > keep) return;                    // chmury zaslaniaja czesc gwiazd
      h += '<i style="left:' + st.x.toFixed(2) + "%;top:" + st.y.toFixed(2) + "%;width:" + st.s + "px;height:" + st.s + "px;opacity:" + st.o.toFixed(2)
        + (st.tw ? ";animation-duration:" + st.d.toFixed(1) + "s" : "") + '"' + (st.tw ? ' class="tw"' : "") + "></i>";
    });
    starsEl.innerHTML = h;
  }

  // ---------- chmury ----------
  var lastCloud = -1;
  function drawClouds(cloud){
    var n = Math.round(cloud / 100 * 8), h = "";
    for (var i = 0; i < n; i++){
      var w = 18 + ((i * 37) % 17), top = (i * 23) % 70, dur = 220 + (i * 53) % 160, dl = -((i * 71) % 200);
      h += '<i style="width:' + w + "vw;height:" + (w * 0.22).toFixed(1) + "vw;top:" + top + "%;left:" + ((i * 29) % 90 - 10) + "%;animation-duration:" + dur + "s;animation-delay:" + dl + 's"></i>';
    }
    cloudsEl.innerHTML = h;
  }
  function cloudNow(){
    var j = window.LAST_METEO; if (!j || !j.hourly || !j.hourly.cloud_cover) return null;
    var now = Date.now(), H = j.hourly;
    for (var i = 0; i < H.time.length; i++){ var t = new Date(H.time[i]).getTime(); if (now >= t && now < t + 3600000) return H.cloud_cover[i]; }
    return null;
  }

  // ---------- polozenie: wolne miejsce zegar <-> radio, wysokosc = do gornej krawedzi panelu ----------
  var box = { l:0, r:0, h:0 };
  function place(){
    var hero = document.querySelector(".hero"), al = $("alerts"), clock = $("clock"), mid = document.querySelector(".head-mid");
    if (!hero) return;
    var anchor = (al && !al.hidden) ? al : hero, top = anchor.getBoundingClientRect().top;
    sky.style.height = top + "px";
    box.h = top;
    box.l = clock ? clock.getBoundingClientRect().right + 20 : 0;
    box.r = mid ? mid.getBoundingClientRect().left - 20 : window.innerWidth / 2;
  }

  function update(){
    var now = Date.now(), night = force || A.sunAlt(now) < -6 * rad;
    document.body.classList.toggle("astro", night);
    if (!night) return;
    place();
    var cloud = cloudNow(); if (cloud === null) cloud = 30;
    var ct = /chmury=(\d+)/.exec(location.hash); if (ct) cloud = +ct[1];   // test: #noc&chmury=70
    if (Math.abs(cloud - lastCloud) >= 8 || lastCloud < 0){ drawStars(cloud); drawClouds(cloud); lastCloud = cloud; }
    // Ksiezyc
    var mi = A.moonIllum(now), pos = A.moonPos(now);
    var phase = fazaTest ? parseFloat(fazaTest) : mi.phase;
    var frac = fazaTest ? (1 - Math.cos(phase * 2 * Math.PI)) / 2 : mi.fraction;
    var up = fazaTest ? true : pos.alt > 0;
    var cap = "";
    if (up && box.r - box.l > 90){
      var size = Math.max(56, Math.min(120, box.h * 0.48, (box.r - box.l) * 0.6));
      var az = fazaTest ? 0 : pos.az / rad;                     // -90 wschod (lewo) ... +90 zachod (prawo)
      var fx = Math.max(0, Math.min(1, (az + 100) / 200));
      var altD = fazaTest ? 30 : pos.alt / rad, fy = 1 - Math.max(0, Math.min(1, altD / 55));
      var x = box.l + fx * Math.max(0, box.r - box.l - size), y = 8 + fy * Math.max(0, box.h - size - 30);
      moonEl.style.width = moonEl.style.height = size.toFixed(0) + "px";
      moonEl.style.transform = "translate(" + x.toFixed(0) + "px," + y.toFixed(0) + "px)";
      moonEl.querySelector(".ns-disc").innerHTML = A.moonSvg(phase, frac);
      moonEl.hidden = false;
      cap = A.moonName(phase) + " · " + Math.round(frac * 100) + "% · wys. " + Math.round(altD) + "°";
    } else {
      moonEl.hidden = true;
      var mt = A.moonTimes(now), mt2 = A.moonTimes(now + 864e5), next = mt.rise && mt.rise > now ? mt.rise : mt2.rise;
      cap = "Księżyc pod horyzontem" + (next ? " · wschód " + hm(next) : "");
    }
    capEl.textContent = cap + " · zachmurzenie " + Math.round(cloud) + "%";
    capEl.style.left = box.l + "px";
    capEl.style.top = Math.max(0, box.h - 22) + "px";
  }

  if (window.METEO_HOOKS) window.METEO_HOOKS.push(function(){ lastCloud = -1; update(); });
  window.addEventListener("resize", function(){ setTimeout(update, 200); });
  window.addEventListener("load", function(){ setTimeout(update, 400); });
  update(); setTimeout(update, 1500);
  setInterval(update, 60000);   // Ksiezyc przesuwa sie po niebie co minute
})();
