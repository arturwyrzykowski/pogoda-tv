/* Ukryte zdarzenia: rzadkie animacje zależne od pory dnia, roku i pogody.
   - satelita: noc, niebo nie całkiem zachmurzone, sunie po górze ekranu
   - meteor: noc, mało chmur; w czasie rojów (Perseidy, Geminidy…) częściej i z nazwą roju
   - lis: noc, przechodzi wzdłuż dolnej krawędzi ekranu
   - bocian: dzień, kwiecień–sierpień, przelatuje górą
   Co minutę losowanie; najwyżej jedno zdarzenie naraz, potem 3 min przerwy. Tylko transform/opacity (lekko dla TV).
   Test: #zdarzenia (co 12 s po kolei), w konsoli window._zdarzenie("lis"|"satelita"|"meteor"|"bocian"). */
(function(){
  "use strict";
  var layer = document.getElementById("events");
  var busyUntil = 0;
  var SHOWERS = [   // [miesiac, od dnia, do dnia, nazwa]
    [1, 1, 5, "Kwadrantydy"], [4, 20, 24, "Lirydy"], [5, 4, 7, "Eta Akwarydy"], [8, 9, 15, "Perseidy"],
    [10, 19, 23, "Orionidy"], [11, 15, 19, "Leonidy"], [12, 11, 16, "Geminidy"]
  ];
  function shower(d){
    var m = d.getMonth() + 1, day = d.getDate();
    for (var i = 0; i < SHOWERS.length; i++){ var s = SHOWERS[i]; if (s[0] === m && day >= s[1] && day <= s[2]) return s[3]; }
    return null;
  }
  // noc wg wschodu/zachodu z Open-Meteo (zapas: 19-6), z zapasem na zmierzch
  function isNight(now){
    var j = window.LAST_METEO;
    if (j && j.daily && j.daily.sunrise){
      var rise = new Date(j.daily.sunrise[0]).getTime(), set = new Date(j.daily.sunset[0]).getTime();
      return now < rise - 30 * 60000 || now > set + 40 * 60000;
    }
    var h = new Date(now).getHours(); return h >= 19 || h < 6;
  }
  function cloudNow(){
    var j = window.LAST_METEO; if (!j || !j.hourly || !j.hourly.cloud_cover) return 50;
    var now = Date.now(), H = j.hourly;
    for (var i = 0; i < H.time.length; i++){ var t = new Date(H.time[i]).getTime(); if (now >= t && now < t + 3600000) return H.cloud_cover[i]; }
    return 50;
  }
  function add(html, cls, ms){
    var el = document.createElement("div");
    el.className = "ev " + cls; el.innerHTML = html;
    layer.appendChild(el);
    setTimeout(function(){ if (el.parentNode) el.remove(); }, ms);
    return el;
  }
  var rnd = function(a, b){ return a + Math.random() * (b - a); };

  var EV = {
    satelita: function(){
      var el = add('<i></i>', "sat", 30000);
      el.style.setProperty("--y0", rnd(3, 16).toFixed(1) + "vh");
      el.style.setProperty("--y1", rnd(2, 18).toFixed(1) + "vh");
      if (Math.random() < 0.5) el.classList.add("rtl");
      return 30000;
    },
    meteor: function(){
      var name = shower(new Date());
      var el = add('<div class="mt-rot"><i></i></div>' + (name ? '<span class="mt-name">☄ ' + name + "</span>" : ""), "meteor", name ? 4200 : 1800);
      el.style.left = rnd(8, 72).toFixed(1) + "vw"; el.style.top = rnd(1, 6).toFixed(1) + "vh";   // zostaje nad naglowkiem
      el.style.setProperty("--ang", rnd(12, 26).toFixed(0) + "deg");
      return 2000;
    },
    lis: function(){
      var el = add(FOX, "fox", 27000);
      if (Math.random() < 0.5) el.classList.add("rtl");
      return 27000;
    },
    bocian: function(){
      var el = add(STORK, "stork", 21000);
      el.style.setProperty("--y0", rnd(4, 14).toFixed(1) + "vh");
      if (Math.random() < 0.5) el.classList.add("rtl");
      return 21000;
    }
  };
  function fire(name){
    if (!EV[name]) return;
    var ms = EV[name]();
    busyUntil = Date.now() + ms + 3 * 60000;
  }
  window._zdarzenie = fire;

  // losowanie co minute (srednio: satelita ~25 min, meteor ~30 min / w roj ~6 min, lis ~45 min, bocian ~40 min)
  function tick(){
    var now = Date.now();
    if (now < busyUntil || document.hidden) return;
    var d = new Date(now), night = isNight(now), cl = cloudNow(), m = d.getMonth() + 1, list = [];
    if (night && cl < 75) list.push(["satelita", 1 / 25]);
    if (night && cl < 60) list.push(["meteor", shower(d) ? 1 / 6 : 1 / 30]);
    if (night) list.push(["lis", 1 / 45]);
    if (!night && m >= 4 && m <= 8) list.push(["bocian", 1 / 40]);
    for (var i = 0; i < list.length; i++){ if (Math.random() < list[i][1]){ fire(list[i][0]); return; } }
  }
  setInterval(tick, 60000);

  if (/zdarzenia/.test(location.hash)){
    var order = ["satelita", "meteor", "lis", "bocian"], k = 0;
    var demo = function(){ fire(order[k++ % order.length]); };
    setTimeout(demo, 1500); setInterval(demo, 12000);
  }

  // ---------- grafiki ----------
  var FOX = '<svg viewBox="0 0 130 64" xmlns="http://www.w3.org/2000/svg">'
    // ogon
    + '<g><animateTransform attributeName="transform" type="rotate" values="-6 34 30;8 34 30;-6 34 30" dur="1.8s" repeatCount="indefinite"/>'
    + '<ellipse cx="16" cy="27" rx="18" ry="7" transform="rotate(-14 16 27)" fill="#c95b22"/>'
    + '<ellipse cx="3" cy="23" rx="5" ry="4.2" transform="rotate(-14 3 23)" fill="#f2efe8"/></g>'
    // nogi dalsze
    + '<g><animateTransform attributeName="transform" type="rotate" values="-22 44 38;22 44 38;-22 44 38" dur=".8s" begin="-.4s" repeatCount="indefinite"/><rect x="41" y="36" width="5" height="19" rx="2.5" fill="#5a2c14"/><rect x="41" y="49" width="5" height="7" rx="2.5" fill="#1a1110"/></g>'
    + '<g><animateTransform attributeName="transform" type="rotate" values="-22 78 38;22 78 38;-22 78 38" dur=".8s" begin="0s" repeatCount="indefinite"/><rect x="75" y="36" width="5" height="19" rx="2.5" fill="#5a2c14"/><rect x="75" y="49" width="5" height="7" rx="2.5" fill="#1a1110"/></g>'
    // tulow
    + '<ellipse cx="60" cy="33" rx="27" ry="10.5" fill="#d9692b"/>'
    + '<ellipse cx="66" cy="39" rx="15" ry="4" fill="#f2efe8" opacity=".9"/>'
    // nogi blizsze
    + '<g><animateTransform attributeName="transform" type="rotate" values="-22 40 38;22 40 38;-22 40 38" dur=".8s" begin="0s" repeatCount="indefinite"/><rect x="37" y="36" width="5.5" height="19" rx="2.7" fill="#7a3a18"/><rect x="37" y="49" width="5.5" height="7" rx="2.7" fill="#1a1110"/></g>'
    + '<g><animateTransform attributeName="transform" type="rotate" values="-22 82 38;22 82 38;-22 82 38" dur=".8s" begin="-.4s" repeatCount="indefinite"/><rect x="79" y="36" width="5.5" height="19" rx="2.7" fill="#7a3a18"/><rect x="79" y="49" width="5.5" height="7" rx="2.7" fill="#1a1110"/></g>'
    // glowa
    + '<polygon points="88,15 91,3 96,15" fill="#c95b22"/><polygon points="90,13 91,7 94,13" fill="#1a1110"/>'
    + '<polygon points="95,15 100,4 103,17" fill="#d9692b"/><polygon points="97,14 100,8 101,15" fill="#1a1110"/>'
    + '<ellipse cx="94" cy="24" rx="11" ry="9" fill="#d9692b"/>'
    + '<polygon points="100,19 120,27 100,31" fill="#d9692b"/>'
    + '<path d="M96 27 Q108 33 120 27 L104 33 Q97 32 94 29 Z" fill="#f2efe8"/>'
    + '<circle cx="119.5" cy="27" r="2" fill="#120c0a"/>'
    + '<ellipse class="fox-eye" cx="99" cy="21.5" rx="1.6" ry="1.3" fill="#ffe7a0"/>'
    + '</svg>';

  var STORK = '<svg viewBox="0 0 140 70" xmlns="http://www.w3.org/2000/svg">'
    + '<g><animateTransform attributeName="transform" type="rotate" values="-38 66 34;26 66 34;-38 66 34" dur="1.1s" begin="-.08s" repeatCount="indefinite"/>'
    + '<path d="M66 34 L52 6 L60 5 L76 33 Z" fill="#cfd5dd"/><path d="M52 6 L44 2 L56 4 Z" fill="#141414"/><path d="M54 10 L46 7 L60 5 Z" fill="#141414"/></g>'
    + '<path d="M44 35 L14 37" stroke="#e0442a" stroke-width="2" stroke-linecap="round"/>'
    + '<path d="M44 34 L16 33" stroke="#e0442a" stroke-width="2" stroke-linecap="round"/>'
    + '<ellipse cx="62" cy="35" rx="22" ry="6.5" fill="#f4f6f8"/>'
    + '<path d="M44 33 L36 31 L38 36 Z" fill="#141414"/>'
    + '<path d="M82 33 Q96 29 104 31" stroke="#f4f6f8" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    + '<circle cx="106" cy="31" r="4.6" fill="#f4f6f8"/><circle cx="107.5" cy="30" r=".9" fill="#111"/>'
    + '<path d="M110 31 L131 34 L110 33.5 Z" fill="#e0442a"/>'
    + '<g><animateTransform attributeName="transform" type="rotate" values="-34 64 33;30 64 33;-34 64 33" dur="1.1s" repeatCount="indefinite"/>'
    + '<path d="M64 33 L46 3 L56 1 L76 32 Z" fill="#ffffff"/><path d="M46 3 L37 -2 L50 0 Z" fill="#141414"/><path d="M48 7 L39 4 L54 1 Z" fill="#141414"/><path d="M50 12 L42 10 L56 5 Z" fill="#141414"/></g>'
    + '</svg>';
})();
