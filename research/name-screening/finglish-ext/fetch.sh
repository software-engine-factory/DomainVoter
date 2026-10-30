#!/usr/bin/env bash
# Re-download everything in raw/. Polite: one request at a time, 3 s between Wikidata calls.
# Then: python -I build.py && python -I measure.py
set -euo pipefail
cd "$(dirname "$0")"
UA="DomainVoter-lab/0.1 (finglish word list research; non-commercial, low-volume)"
SPARQL=https://query.wikidata.org/sparql
mkdir -p raw/geonames raw/wikidata raw/english

# 1. GeoNames Iran dump (CC BY 4.0)
curl -sS -A "$UA" -o raw/geonames/IR.zip https://download.geonames.org/export/dump/IR.zip
unzip -o -q raw/geonames/IR.zip -d raw/geonames

# 2. English frequency list, used only as a stoplist (hermitdave/FrequencyWords, CC BY-SA 4.0)
curl -sS -A "$UA" -o raw/english/en_50k.txt \
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt

# 3. Wikidata given names (CC0)
q() { curl -sS -A "$UA" -H "Accept: text/csv" --data-urlencode "query=$1" "$SPARQL"; sleep 3; }
cd raw/wikidata
q 'SELECT ?gn ?label (COUNT(DISTINCT ?p) AS ?n) WHERE { ?p wdt:P27 wd:Q794 ; wdt:P735 ?gn . ?gn rdfs:label ?label . FILTER(LANG(?label)="en") } GROUP BY ?gn ?label' > given-iran-citizens.csv
q 'SELECT ?gn ?label ?alias WHERE { { ?gn wdt:P407 wd:Q9168 } UNION { ?gn wdt:P1705 ?nl . FILTER(LANG(?nl)="fa") } ?gn wdt:P31/wdt:P279* wd:Q202444 . OPTIONAL { ?gn rdfs:label ?label . FILTER(LANG(?label)="en") } OPTIONAL { ?gn skos:altLabel ?alias . FILTER(LANG(?alias)="en") } }' > given-persian-lang.csv

# Per-item lookups for the citizen given names, in chunks (VALUES lists).
python -I -c "
import csv
ids=[r['gn'].rsplit('/',1)[1] for r in csv.DictReader(open('given-iran-citizens.csv',encoding='utf-8'))]
for i in range(0,len(ids),150): open(f'_chunk{i//150:02d}.txt','w').write(' '.join('wd:'+x for x in ids[i:i+150]))
"
echo "gn,alias" > given-iran-citizens-aliases.csv
echo "gn,total" > given-iran-citizens-totals.csv
echo "gn" > given-iran-citizens-is-given-name.csv
for f in _chunk*.txt; do
  v=$(cat "$f")
  q "SELECT ?gn ?alias WHERE { VALUES ?gn { $v } ?gn skos:altLabel ?alias . FILTER(LANG(?alias)=\"en\") }" | tail -n +2 >> given-iran-citizens-aliases.csv
  q "SELECT ?gn ?total WHERE { VALUES ?gn { $v } { SELECT ?gn (COUNT(?p) AS ?total) WHERE { ?p wdt:P735 ?gn } GROUP BY ?gn } }" | tail -n +2 >> given-iran-citizens-totals.csv
  q "SELECT DISTINCT ?gn WHERE { VALUES ?gn { $v } ?gn wdt:P31/wdt:P279* wd:Q202444 . }" | tail -n +2 >> given-iran-citizens-is-given-name.csv
done
rm -f _chunk*.txt
wc -l *.csv
