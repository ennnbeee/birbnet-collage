#!/usr/bin/env python3
import csv
import json

mapping = {}
with open('eBird_Taxonomy_v2025_5-tab_30Oct2025.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row.get('category') == 'species':
            sci = row.get('sci_name', '').strip()
            code = row.get('species_code', '').strip()
            if sci and code:
                mapping[sci] = code

with open('ebird_codes.json', 'w') as f:
    json.dump(mapping, f, indent=2)

print(f'Converted {len(mapping)} species codes')
