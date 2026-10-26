#!/usr/bin/env python3
"""Prüft chemie.json (Chemielabor in Daily Brain). Aufruf: python3 check_chemie.py chemie.json"""
import json, sys
path = sys.argv[1] if len(sys.argv) > 1 else "chemie.json"
c = json.load(open(path, encoding="utf-8"))
errs = []

def uniq_ids(name, items):
    ids = [x["id"] for x in items]
    if len(set(ids)) != len(ids): errs.append(f"{name}: doppelte IDs")

for name in ("cations", "anions", "stoffe", "abk", "redox", "sb", "titration", "analytik", "ir", "nmr"):
    uniq_ids(name, c[name])

cat_ids = {x["id"] for x in c["cations"]}
for x in c["cations"] + c["anions"]:
    if not isinstance(x["z"], int) or x["z"] < 1: errs.append(f"{x['id']}: Ladung ungültig")
for a in c["anions"]:
    for key in ("only", "deny"):
        for ref in a.get(key, []):
            if ref not in cat_ids: errs.append(f"{a['id']}: {key} nennt unbekanntes Kation {ref}")
    if "only" in a and "deny" in a: errs.append(f"{a['id']}: only und deny zusammen")

# Auswahlaufgaben: 4 verschiedene Antworten, Erklärung vorhanden
for name in ("redox", "sb", "titration", "analytik"):
    for x in c[name]:
        if len(x["o"]) != 4 or len(set(x["o"])) != 4: errs.append(f"{x['id']}: 4 verschiedene Antworten nötig")
        if not x.get("q") or not x.get("e"): errs.append(f"{x['id']}: Frage oder Erklärung fehlt")
for x in c["ir"]:
    if len(x["o"]) != 4 or len(set(x["o"])) != 4: errs.append(f"{x['id']}: 4 verschiedene Antworten nötig")
    if not x.get("e"): errs.append(f"{x['id']}: Erklärung fehlt")
    for b in x["bands"]:
        if len(b) != 3 or not (500 <= b[0] <= 4000) or not (0 < b[2] <= 0.95): errs.append(f"{x['id']}: Bande {b} ungültig")
for x in c["titration"]:
    if x["pks"] is not None and not (0 < x["pks"] < 14): errs.append(f"{x['id']}: pKs ungültig")
PAT = {"s", "d", "t", "q", "sept", "m"}
names = [x["name"] for x in c["nmr"]]
if len(set(names)) != len(names): errs.append("nmr: doppelte Namen")
for x in c["nmr"]:
    for d, m, h in x["s"]:
        if m not in PAT or not (0 <= d <= 12) or h < 1: errs.append(f"{x['id']}: Signal {d},{m},{h} ungültig")
    if not x.get("e"): errs.append(f"{x['id']}: Erklärung fehlt")

# Stoffe: je Gruppe mindestens 4 verschiedene Formeln und Namen
for g in {x["g"] for x in c["stoffe"]}:
    grp = [x for x in c["stoffe"] if x["g"] == g]
    if len({x["f"] for x in grp}) < 4 or len({x["n"] for x in grp}) < 4: errs.append(f"stoffe/{g}: zu wenige verschiedene Einträge")
    if len({x["n"] for x in grp}) != len(grp): errs.append(f"stoffe/{g}: doppelter Name")
if len({x["m"] for x in c["abk"]}) != len(c["abk"]): errs.append("abk: doppelte Bedeutung")
acids = [p[0] for p in c["pairs"]]; bases = [p[1] for p in c["pairs"]]
if len(set(acids)) != len(acids) or len(set(bases)) != len(bases): errs.append("pairs: Säure oder Base doppelt (Antwort wäre nicht eindeutig)")

print(f"{len(c['cations'])} Kationen, {len(c['anions'])} Anionen, {len(c['stoffe'])} Stoffe, {len(c['abk'])} Abkürzungen, {len(c['pairs'])} Paare, "
      f"{len(c['sb'])} Säure/Base-Aufgaben, {len(c['redox'])} Redox, {len(c['titration'])} Titration, {len(c['analytik'])} Analytik, {len(c['ir'])} IR, {len(c['nmr'])} NMR")
print("OK" if not errs else "FEHLER:\n- " + "\n- ".join(errs))
sys.exit(1 if errs else 0)
