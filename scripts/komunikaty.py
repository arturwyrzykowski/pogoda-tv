#!/usr/bin/env python3
"""Komunikaty lokalne dla Zambskich Kościelnych (gmina Obryte, powiat pułtuski) -> data/komunikaty.json

Źródła (sprawdzane automatycznie przez GitHub Actions):
- PGE Dystrybucja: planowane wyłączenia i awarie prądu w gminie Obryte (TERYT gminy 142402)
- Urząd Gminy Obryte (obryte.pl): dział „Komunikaty” + pilne wpisy z aktualności
- Powiat pułtuski (RSS): tylko wpisy o charakterze ostrzeżeń / utrudnień
Stare komunikaty są usuwane: wyłączenia po zakończeniu, wpisy gminy/powiatu po 5 dniach.
Ostrzeżenia pogodowe IMGW strona pobiera sama (na żywo), tu ich nie ma.
Plik zmienia się tylko wtedy, gdy zmienia się lista komunikatów (brak znacznika czasu sprawdzenia).
"""
import html, json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Warsaw")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "komunikaty.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 pogoda-tv-komunikaty"
GMINA_TERYT = "142402"          # gmina Obryte
WIES = "Zambski Kościelne"
DNI_WPISY = 5                   # wpisy gminy/powiatu wygasaja po tylu dniach
PILNE = re.compile(r"komunikat|ostrzeż|ostrzez|alarm|syren|utrudni|zamknię|zamknie|objazd|awari|przerw|wyłącz|wylacz|"
                   r"zagroż|zagroz|ewakuac|powód|powod|wichur|burz|upał|upal|mróz|mroz|gołoledź|RCB|kryzysow|woda|wodociąg|prąd", re.I)


def get(url, headers=None):
    h = {"User-Agent": UA}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
        return r.read()


def clean(s, n=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if n and len(s) > n:
        s = s[:n].rsplit(" ", 1)[0] + "…"
    return s


def iso(dt):
    return dt.astimezone(TZ).isoformat(timespec="minutes")


def prad(now):
    """Wyłączenia prądu PGE w gminie Obryte, które jeszcze się nie skończyły i zaczynają w ciągu 7 dni."""
    data = json.loads(get("https://power-outage.gkpge.pl/api/power-outage", {"Origin": "https://pgedystrybucja.pl", "Accept": "application/json"}))
    out = []
    for o in data:
        if o.get("revoked"):
            continue
        wsie = []
        for a in o.get("addresses") or []:
            t = a.get("teryt") or {}
            if t.get("communeCode") == GMINA_TERYT and t.get("cityName") and t["cityName"] not in wsie:
                wsie.append(t["cityName"])
        if not wsie:
            continue
        try:
            start = datetime.strptime(o["startAt"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
            stop = datetime.strptime(o["stopAt"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
        except Exception:
            continue
        if stop <= now or start > now + timedelta(days=7):
            continue
        rodzaj = {1: "awaria", 2: "planowane", 3: "awaria masowa"}.get(o.get("type"), "wyłączenie")
        nasza = any(WIES.lower() in w.lower() for w in wsie)
        out.append({
            "id": "pge-%s" % o.get("id"),
            "typ": "prad",
            "tytul": ("Wyłączenie prądu — " + rodzaj) + (" (także Zambski Kościelne!)" if nasza else ""),
            "tekst": ", ".join(sorted(wsie)),
            "od": iso(start), "do": iso(stop),
            "zrodlo": "PGE Dystrybucja",
            "link": "https://pgedystrybucja.pl/wylaczenia/planowane-wylaczenia",
            "wazne": nasza or o.get("type") != 2,
        })
    # scal nakladajace sie zlecenia dla tych samych wsi (PGE czesto daje kilka na ten sam dzien)
    out.sort(key=lambda x: (x["tekst"], x["od"]))
    merged = []
    for o in out:
        p = merged[-1] if merged else None
        if p and p["tekst"] == o["tekst"] and o["od"] <= p["do"]:
            p["do"] = max(p["do"], o["do"]); p["wazne"] = p["wazne"] or o["wazne"]
            p["id"] = p["id"] + "+" + o["id"].split("-", 1)[1]
        else:
            merged.append(o)
    print("PGE: %d wyłączeń w gminie Obryte (po scaleniu %d)" % (len(out), len(merged)))
    return merged


PELNY_MAKS = 1200  # tyle znaków pełnej treści ogłoszenia (pasek na TV przewija ją stronami po 2 linie)


def pelna_tresc(link, krotki):
    """Cała treść ogłoszenia ze strony wpisu (lista ogłoszeń daje tylko początek z wielokropkiem).
    Przy błędzie zostaje skrót z listy."""
    try:
        s = get(link).decode("utf-8", "ignore")
        m = re.search(r'<div class="description-body">(.*?)</div>', s, re.S)
        tekst = clean(m.group(1) if m else "", PELNY_MAKS)
        return tekst or krotki
    except Exception as e:  # noqa: BLE001 - strona gminy bywa niedostępna; skrót z listy wystarczy
        print("Gmina Obryte: nie pobrano treści %s (%s)" % (link, e))
        return krotki


def gmina(now):
    out, seen = [], set()
    for url, kat in (("https://www.obryte.pl/ogloszenia/komunikaty", True), ("https://www.obryte.pl/ogloszenia", False)):
        s = get(url).decode("utf-8", "ignore")
        parts = re.split(r'<div class="news-item news-item-(\d+)">', s)
        for k in range(1, len(parts) - 1, 2):
            nid, b = parts[k], parts[k + 1]
            if nid in seen:
                continue
            m_d = re.search(r'<div class="date">\s*(\d{2})\.(\d{2})\.(\d{4})', b)
            m_t = re.search(r'<h3>\s*<a href="([^"]+)"[^>]*>(.*?)</a>', b, re.S)
            if not (m_d and m_t):
                continue
            d = datetime(int(m_d.group(3)), int(m_d.group(2)), int(m_d.group(1)), tzinfo=TZ)
            tytul = clean(m_t.group(2))
            opis = clean((re.search(r'<div class="description-body">(.*?)</div>', b, re.S) or [None, ""])[1], 160)
            if not kat and not PILNE.search(tytul + " " + opis):
                continue
            do = d + timedelta(days=DNI_WPISY, hours=23, minutes=59)
            if do <= now:
                continue
            seen.add(nid)
            opis = pelna_tresc(m_t.group(1), opis)
            out.append({"id": "obryte-" + nid, "typ": "gmina", "tytul": tytul, "tekst": opis, "od": iso(d), "do": iso(do),
                        "zrodlo": "Gmina Obryte", "link": m_t.group(1), "wazne": bool(re.search(r"awari|przerw|ewakuac|utrudni|zamkni", tytul, re.I))})
    print("Gmina Obryte: %d komunikatów" % len(out))
    return out


def powiat(now):
    out = []
    root = ET.fromstring(get("https://powiatpultuski.pl/feed/"))
    for it in root.iter("item"):
        tytul = clean(it.findtext("title"))
        opis = clean(it.findtext("description"), 160)
        try:
            d = parsedate_to_datetime(it.findtext("pubDate")).astimezone(TZ)
        except Exception:
            continue
        if not PILNE.search(tytul + " " + opis):
            continue
        do = d + timedelta(days=DNI_WPISY)
        if do <= now:
            continue
        link = (it.findtext("link") or "").strip()
        out.append({"id": "powiat-" + re.sub(r"\W+", "", link)[-40:], "typ": "powiat", "tytul": tytul, "tekst": opis,
                    "od": iso(d), "do": iso(do), "zrodlo": "Powiat pułtuski", "link": link, "wazne": False})
    print("Powiat: %d komunikatów" % len(out))
    return out


def main():
    now = datetime.now(TZ)
    old = {}
    if os.path.exists(OUT):
        try:
            for it in json.load(open(OUT, encoding="utf-8")).get("komunikaty", []):
                old[it["id"]] = it
        except Exception:
            pass
    items, ok = [], {}
    for name, fn in (("prad", prad), ("gmina", gmina), ("powiat", powiat)):
        try:
            items += fn(now)
            ok[name] = True
        except Exception as e:
            ok[name] = False
            print("%s: błąd (%s) — zostawiam poprzednie, jeśli jeszcze aktualne" % (name, e))
            items += [o for o in old.values() if o["typ"] == name and datetime.fromisoformat(o["do"]) > now]
    items.sort(key=lambda x: (not x["wazne"], {"prad": 0, "gmina": 1, "powiat": 2}[x["typ"]], x["od"]))
    doc = {"komunikaty": items, "zrodla_ok": ok}
    txt = json.dumps(doc, ensure_ascii=False, indent=1)
    if not os.path.exists(OUT) or open(OUT, encoding="utf-8").read() != txt:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            f.write(txt)
        print("Zapisano %d komunikatów" % len(items))
    else:
        print("Bez zmian (%d komunikatów)" % len(items))
    return 0


if __name__ == "__main__":
    sys.exit(main())
