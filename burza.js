/* Tryb burzowy: gdy burza jest teraz, w prognozie na najbliższe 3 h albo obowiązuje ostrzeżenie IMGW o burzach.
   - tło i panele przechodzą w ciemny granat (body.storm)
   - panel monitoringu pokazuje radar, większy i bliżej Zambskich
   - duży licznik do przewidywanego początku opadów (Open-Meteo, prognoza co 15 min); gdy już pada: ile jeszcze
   Tryb trzyma się min. 30 min po ostatnim sygnale burzy. Test: #burza, #burza&za=37 (licznik testowy na 37 min). */
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var LAT = 52.7559, LON = 21.2154, Q15 = 15 * 60000;
  var box = $("stormBox"), big = $("sbBig"), lbl = $("sbLbl"), sub = $("sbSub");
  var test = /burza/.test(location.hash), testZa = (/za=(\d+)/.exec(location.hash) || [])[1];
  var m15 = null, lastSignal = 0, reason = "", on = false, target = null, mode = "none", endAt = null;
  var p2 = function(n){ return (n < 10 ? "0" : "") + n; };
  var hm = function(t){ var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };

  function load15(){
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON
      + "&minutely_15=precipitation,weather_code&forecast_minutely_15=16&past_minutely_15=1&timezone=Europe%2FWarsaw";
    return fetch(url, { cache:"no-store" }).then(function(r){ if (!r.ok) throw new Error(); return r.json(); })
      .then(function(j){ m15 = j.minutely_15; m15.at = Date.now(); evaluate(); }).catch(function(){});
  }

  // czy jest sygnal burzy
  function stormSignal(now){
    var j = window.LAST_METEO, why = "";
    if (j && j.current && j.current.weather_code >= 95) why = "burza teraz";
    if (!why && m15){
      for (var i = 0; i < m15.time.length; i++){
        var t = new Date(m15.time[i]).getTime();
        if (t + Q15 > now && t < now + 3 * 3600000 && m15.weather_code[i] >= 95){ why = "burza w prognozie od " + hm(Math.max(t, now)); break; }
      }
    }
    if (!why && j && j.hourly){
      var H = j.hourly;
      for (var k = 0; k < H.time.length; k++){
        var th = new Date(H.time[k]).getTime();
        if (th + 3600000 > now && th < now + 3 * 3600000 && H.weather_code[k] >= 95){ why = "burza w prognozie od " + hm(Math.max(th, now)); break; }
      }
    }
    if (!why) (window.ALERTS_OFFICIAL || []).forEach(function(w){
      if (!why && /burz/i.test(w.title) && w.from <= now + 3 * 3600000 && w.to > now) why = "ostrzeżenie IMGW: " + w.title;
    });
    if (!why && test) why = "test (#burza)";
    return why;
  }

  // przewidywany poczatek opadow / koniec, z prognozy 15-min
  function rainTiming(now){
    if (testZa) return { mode:"before", at:now + (+testZa) * 60000 };
    if (!m15) return { mode:"none" };
    var slots = [];
    for (var i = 0; i < m15.time.length; i++) slots.push({ t:new Date(m15.time[i]).getTime(), p:m15.precipitation[i] || 0 });
    var curI = -1;
    for (var k = 0; k < slots.length; k++) if (now >= slots[k].t && now < slots[k].t + Q15) curI = k;
    if (curI >= 0 && slots[curI].p >= 0.2){
      for (var e = curI + 1; e < slots.length - 1; e++) if (slots[e].p < 0.1 && slots[e + 1].p < 0.1) return { mode:"raining", end:slots[e].t };
      return { mode:"raining", end:null };
    }
    for (var s = Math.max(0, curI + 1); s < slots.length; s++) if (slots[s].p >= 0.2) return { mode:"before", at:slots[s].t, mm:slots[s].p };
    return { mode:"none" };
  }

  function evaluate(){
    var now = Date.now(), why = stormSignal(now);
    if (why){ lastSignal = now; reason = why; }
    var should = !!why || now - lastSignal < 30 * 60000 && lastSignal > 0;
    if (should !== on){
      on = should;
      document.body.classList.toggle("storm", on);
      box.hidden = !on;
      if (on && window._monRadar) window._monRadar();
      window.dispatchEvent(new Event("resize"));
    }
    if (!on) return;
    var r = rainTiming(now);
    mode = r.mode; target = r.at || null; endAt = r.end || null;
    sub.textContent = "⛈ " + reason + (testZa ? " · licznik testowy" : "") + " · prognoza co 15 min (±15 min)";
    tick();
  }

  function tick(){
    if (!on) return;
    var now = Date.now();
    if (mode === "before" && target){
      var left = Math.max(0, target - now), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
      big.textContent = (h ? h + ":" + p2(m) : m) + ":" + p2(s);
      lbl.textContent = left > 0 ? "do nadejścia opadów · ok. " + hm(target) : "opady powinny się zaczynać";
      box.className = "storm-box" + (left < 15 * 60000 ? " soon" : "");
    } else if (mode === "raining"){
      big.textContent = "PADA";
      lbl.textContent = endAt ? "koniec opadów ok. " + hm(endAt) + " (za " + Math.max(1, Math.round((endAt - now) / 60000)) + " min)" : "opady przez najbliższe 4 h";
      box.className = "storm-box rain";
    } else {
      big.textContent = "—";
      lbl.textContent = "brak opadów w prognozie na 4 h";
      box.className = "storm-box";
    }
  }

  if (window.METEO_HOOKS) window.METEO_HOOKS.push(evaluate);
  load15().then(evaluate);
  setInterval(load15, 5 * 60000);
  setInterval(evaluate, 60000);
  setInterval(tick, 1000);
  setTimeout(evaluate, 3000);
})();
