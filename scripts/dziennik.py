#!/usr/bin/env python3
"""Dziennik pogody dla Zambskich Kościelnych.

Dopisuje godzinowe wiersze do data/dziennik-RRRR.csv:
temperatura, wilgotność, ciśnienie, wiatr, porywy, kierunek, opad, zachmurzenie (Open-Meteo)
oraz stan Narwi z wodowskazu IMGW-PIB Zambski Kościelne (152210060).

Każde uruchomienie pobiera ostatnie 7 dni, więc uzupełnia luki po nieudanych przebiegach.
Wiersze są unikalne po godzinie; istniejące wartości nie są nadpisywane pustymi.
Tylko biblioteka standardowa (uruchamiane w GitHub Actions co 6 h).
"""
import csv, json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LAT, LON = 52.7559, 21.2154
STATION = "152210060"
TZ = ZoneInfo("Europe/Warsaw")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 pogoda-tv-dziennik"
COLS = ["czas", "temperatura_c", "wilgotnosc_proc", "cisnienie_hpa", "wiatr_kmh", "porywy_kmh",
        "kierunek_wiatru_st", "opad_mm", "zachmurzenie_proc", "narew_cm", "narew_zrodlo"]


def get_json(url, headers=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def hour_key(dt_utc):
    """Klucz wiersza: pełna godzina czasu lokalnego z przesunięciem, np. 2026-10-11T19:00+02:00."""
    return dt_utc.astimezone(TZ).replace(minute=0, second=0, microsecond=0).isoformat(timespec="minutes")


def fmt(v, nd=1):
    if v is None:
        return ""
    return str(round(float(v), nd)) if nd else str(int(round(float(v))))


def meteo(now_utc):
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
           "&hourly=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_gusts_10m,"
           "wind_direction_10m,precipitation,cloud_cover&past_days=7&forecast_days=1&timezone=GMT") % (LAT, LON)
    j = get_json(url)
    h = j["hourly"]
    rows = {}
    for i, t in enumerate(h["time"]):
        dt = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
        if dt > now_utc - timedelta(hours=1):      # tylko zakonczone godziny
            continue
        if h["temperature_2m"][i] is None:
            continue
        rows[hour_key(dt)] = {
            "temperatura_c": fmt(h["temperature_2m"][i]),
            "wilgotnosc_proc": fmt(h["relative_humidity_2m"][i], 0),
            "cisnienie_hpa": fmt(h["surface_pressure"][i]),
            "wiatr_kmh": fmt(h["wind_speed_10m"][i]),
            "porywy_kmh": fmt(h["wind_gusts_10m"][i]),
            "kierunek_wiatru_st": fmt(h["wind_direction_10m"][i], 0),
            "opad_mm": fmt(h["precipitation"][i]),
            "zachmurzenie_proc": fmt(h["cloud_cover"][i], 0),
        }
    return rows


def narew():
    """Stany Narwi o pełnych godzinach. Najpierw historia z hydro.imgw.pl (7 dni), zapas: bieżący pomiar z API danych publicznych."""
    out = {}
    try:
        d = get_json("https://hydro-back.imgw.pl/station/hydro/status/data?id=%s&hoursInterval=168" % STATION,
                     {"Origin": "https://hydro.imgw.pl", "Referer": "https://hydro.imgw.pl/"})
        for o in d.get("operational") or []:
            dt = datetime.fromisoformat(o["date"].replace("Z", "+00:00"))
            if dt.minute == 0 and o.get("value") is not None:
                out[hour_key(dt)] = (fmt(o["value"], 0), "imgw-hydro")
        print("Narew: historia IMGW hydro, %d pełnych godzin" % len(out))
    except Exception as e:
        print("Narew: brak historii hydro-back (%s), używam API danych publicznych" % e)
    try:
        d = get_json("https://danepubliczne.imgw.pl/api/data/hydro/id/%s" % STATION)[0]
        dt = datetime.fromisoformat(d["stan_wody_data_pomiaru"]).replace(tzinfo=timezone.utc)   # czas w UTC
        if d.get("stan_wody") not in (None, "") and dt.minute < 30:
            out.setdefault(hour_key(dt), (fmt(d["stan_wody"], 0), "imgw-dane-publiczne"))
    except Exception as e:
        print("Narew: API danych publicznych niedostępne (%s)" % e)
    return out


def main():
    now = datetime.now(timezone.utc)
    os.makedirs(DATA, exist_ok=True)
    new = {}
    try:
        for k, v in meteo(now).items():
            new.setdefault(k, {}).update(v)
    except Exception as e:
        print("Open-Meteo niedostępne: %s" % e)
    for k, (v, src) in narew().items():
        new.setdefault(k, {}).update({"narew_cm": v, "narew_zrodlo": src})
    if not new:
        print("Brak nowych danych")
        return 1

    by_year = {}
    for k, v in new.items():
        by_year.setdefault(k[:4], {})[k] = v
    changed = 0
    for year, rows in sorted(by_year.items()):
        path = os.path.join(DATA, "dziennik-%s.csv" % year)
        old = {}
        if os.path.exists(path):
            with open(path, newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    old[r["czas"]] = r
        before = json.dumps(old, sort_keys=True)
        for k, v in rows.items():
            r = old.setdefault(k, {c: "" for c in COLS})
            r["czas"] = k
            for c, val in v.items():
                if c.startswith("narew") or val == "":
                    continue
                r[c] = val          # pogoda: najnowsza ocena Open-Meteo dla tej godziny
            if v.get("narew_cm"):
                # stan z historii IMGW ma pierwszenstwo; zapasowy pomiar tylko uzupelnia luki
                if v["narew_zrodlo"] == "imgw-hydro" or not r.get("narew_cm"):
                    r["narew_cm"], r["narew_zrodlo"] = v["narew_cm"], v["narew_zrodlo"]
        if json.dumps(old, sort_keys=True) != before:
            changed += 1
            tmp = path + ".tmp"
            with open(tmp, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=COLS)
                w.writeheader()
                for k in sorted(old, key=lambda s: datetime.fromisoformat(s)):
                    w.writerow({c: old[k].get(c, "") for c in COLS})
            os.replace(tmp, path)
            print("%s: %d wierszy" % (path, len(old)))
    # spis plikow dla strony dziennik.html
    files = sorted(f for f in os.listdir(DATA) if f.startswith("dziennik-") and f.endswith(".csv"))
    idx = {"pliki": files, "aktualizacja": now.astimezone(TZ).isoformat(timespec="minutes")}
    with open(os.path.join(DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    print("Zmienione pliki: %d" % changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
