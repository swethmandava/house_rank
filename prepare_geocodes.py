import csv
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path


WORKSPACE = Path("/Users/swethamandava/Documents/ChatGPT/house_rank")
OUTPUT_DIR = WORKSPACE / "outputs" / "01a0cb83-f11d-7e90-953a-f71b9bcb7d9d"
ADDRESS_SOURCE = Path("/tmp/sf_enterprise_addresses.csv")
PAYLOAD_PATH = Path("/tmp/geocoded_csv_payload.json")
CENSUS_BATCH_PATH = Path("/tmp/census_unmatched_schools.csv")
CENSUS_RESULTS_PATH = Path("/tmp/census_geocode_results.csv")
CENSUS_CORRECTIONS_PATH = Path("/tmp/census_geocode_corrections_results.csv")

FILES = [
    {
        "path": OUTPUT_DIR / "san_francisco_schools_ratings.csv",
        "name_field": "school",
        "kind": "schools",
    },
    {
        "path": OUTPUT_DIR / "san_francisco_preschools_ratings.csv",
        "name_field": "preschool",
        "kind": "preschools",
    },
]

METHOD_LABELS = {
    "exact": "Exact DataSF address",
    "exact_other_zip": "Exact DataSF address; source ZIP differs",
    "base_number": "DataSF base address",
    "fuzzy": "DataSF normalized street match",
    "fuzzy_other_zip": "DataSF normalized street match; source ZIP differs",
    "census": "US Census address match",
    "manual_campus": "Published campus road centroid",
}

STREET_TYPES = {
    "ALLEY": "ALY",
    "AVENUE": "AVE",
    "BOULEVARD": "BLVD",
    "CIRCLE": "CIR",
    "COURT": "CT",
    "DRIVE": "DR",
    "HIGHWAY": "HWY",
    "LANE": "LN",
    "PLACE": "PL",
    "PLAZA": "PLZ",
    "ROAD": "RD",
    "STREET": "ST",
    "STR": "ST",
    "TERRACE": "TER",
}

ORDINALS = {
    "FIRST": "1ST",
    "SECOND": "2ND",
    "THIRD": "3RD",
    "FOURTH": "4TH",
    "FIFTH": "5TH",
    "SIXTH": "6TH",
    "SEVENTH": "7TH",
    "EIGHTH": "8TH",
    "NINTH": "9TH",
    "TENTH": "10TH",
    "ELEVENTH": "11TH",
    "TWELFTH": "12TH",
    "THIRTEENTH": "13TH",
    "FOURTEENTH": "14TH",
    "FIFTEENTH": "15TH",
    "SIXTEENTH": "16TH",
    "SEVENTEENTH": "17TH",
    "EIGHTEENTH": "18TH",
    "NINETEENTH": "19TH",
    "TWENTIETH": "20TH",
}

MANUAL_ADDRESS_OVERRIDES = {
    ("preschools", "Glenridge Cooperative Nursery School"): "70 ELK ST",
}

MANUAL_GEOCODES = {
    ("preschools", "Sfsu - Children'S Campus (Preschool)"): {
        "latitude": 37.7260402,
        "longitude": -122.4822453,
        "matched_address": "North State Drive, San Francisco, CA 94132",
        "source": "OpenStreetMap North State Drive centroid",
        "data_as_of": "2026-09-22",
    },
    (
        "preschools",
        "Little Panda Children's Campus at San Francisco State University - San Francisco State University",
    ): {
        "latitude": 37.7260402,
        "longitude": -122.4822453,
        "matched_address": "North State Drive, San Francisco, CA 94132",
        "source": "OpenStreetMap North State Drive centroid",
        "data_as_of": "2026-09-22",
    },
}


def plain_text(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def normalize_address(value):
    text = plain_text(value).upper().strip()
    text = re.sub(r",\s*(SAN FRANCISCO|SF)\b.*$", "", text)
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text)
    text = re.sub(r",\s*(APT|APARTMENT|STE|SUITE|UNIT|RM|ROOM|FL|FLOOR|#).*", "", text)
    text = re.sub(r"\s+(APT|APARTMENT|STE|SUITE|UNIT|RM|ROOM|FL|FLOOR|#)\s*#?[A-Z0-9-]+.*$", "", text)
    text = re.sub(r"\s+\d+(ST|ND|RD|TH)\s+(FL|FLOOR)\.?$", "", text)
    text = re.sub(r"\s+(BLDG|BUILDING)\s+[A-Z0-9-]+.*$", "", text)
    text = re.sub(r"\s+(LOWER|UPPER)\s+LEVEL.*$", "", text)
    text = re.sub(r"\s+W\d+$", "", text)
    text = re.sub(r"\s+NO\s+\d+.*$", "", text)
    text = re.sub(r"\s+94\d{3}$", "", text)

    multi_number = re.match(r"^(\d+[A-Z]?)\s*&\s*\d+[A-Z]?\s+(.+)$", text)
    if multi_number:
        text = f"{multi_number.group(1)} {multi_number.group(2)}"
    text = re.split(r"\s+AND\s+\d+[A-Z]?\s+", text, maxsplit=1)[0]

    text = text.replace("/", " ")
    text = re.sub(r"[^A-Z0-9 ]+", " ", text)
    tokens = [token for token in text.split() if token]
    tokens = [ORDINALS.get(token, STREET_TYPES.get(token, token)) for token in tokens]
    return " ".join(tokens)


def parse_number_street(address):
    match = re.match(r"^(\d+[A-Z]?)\s+(.+)$", address)
    return (match.group(1), match.group(2)) if match else ("", "")


def zip_from_row(row, kind):
    if kind == "preschools":
        return str(row.get("zip", "")).strip()[:5]
    match = re.search(r"\b(94\d{3})\b", row.get("address", ""))
    return match.group(1) if match else ""


def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


address_groups = defaultdict(list)
address_only_groups = defaultdict(list)
number_zip_index = defaultdict(list)
number_index = defaultdict(list)

with ADDRESS_SOURCE.open(newline="", encoding="utf-8-sig") as handle:
    for row in csv.DictReader(handle):
        normalized = normalize_address(row.get("Address", ""))
        zip_code = str(row.get("ZIP Code", "")).strip()[:5]
        if not normalized or not row.get("Latitude") or not row.get("Longitude"):
            continue
        record = {
            "address": row["Address"].strip(),
            "zip": zip_code,
            "latitude": float(row["Latitude"]),
            "longitude": float(row["Longitude"]),
            "data_as_of": str(row.get("data_as_of", "")).strip(),
        }
        address_groups[(normalized, zip_code)].append(record)
        address_only_groups[normalized].append(record)
        number, street = parse_number_street(normalized)
        if number:
            number_zip_index[(number, zip_code)].append((street, normalized, record))
            number_index[number].append((street, normalized, zip_code, record))


def consolidate(records):
    first = records[0]
    return {
        "latitude": round(median([r["latitude"] for r in records]), 7),
        "longitude": round(median([r["longitude"] for r in records]), 7),
        "matched_address": first["address"],
        "source": "DataSF Enterprise Addressing System",
        "data_as_of": (first["data_as_of"][:10] or "2026-09-21").replace("/", "-"),
    }


CENSUS_RESULTS = {}
CENSUS_CORRECTION_IDS = set()
for census_path in [CENSUS_RESULTS_PATH, CENSUS_CORRECTIONS_PATH]:
    if not census_path.exists():
        continue
    with census_path.open(newline="", encoding="utf-8") as handle:
        for result in csv.reader(handle):
            if len(result) < 6 or result[2] != "Match":
                continue
            longitude, latitude = result[5].split(",")
            CENSUS_RESULTS[result[0]] = {
                "latitude": round(float(latitude), 7),
                "longitude": round(float(longitude), 7),
                "matched_address": result[4],
                "source": "US Census Geocoder Public_AR_Current",
                "data_as_of": "2026-09-22",
            }
            if census_path == CENSUS_CORRECTIONS_PATH:
                CENSUS_CORRECTION_IDS.add(result[0])


def find_geocode(row, kind, name_field, row_index):
    name = row[name_field].strip()
    manual_geocode = MANUAL_GEOCODES.get((kind, name))
    if manual_geocode:
        return manual_geocode, "manual_campus"
    row_id = f"{kind}:{row_index}"
    if row_id in CENSUS_CORRECTION_IDS:
        return CENSUS_RESULTS[row_id], "census"
    raw_address = MANUAL_ADDRESS_OVERRIDES.get((kind, name), row.get("address", ""))
    normalized = normalize_address(raw_address)
    zip_code = zip_from_row(row, kind)

    exact = address_groups.get((normalized, zip_code))
    if exact:
        return consolidate(exact), "exact"

    exact_any_zip = address_only_groups.get(normalized)
    if exact_any_zip:
        return consolidate(exact_any_zip), "exact_other_zip"

    number, street = parse_number_street(normalized)
    if number and number[-1:].isalpha():
        base_number = number[:-1]
        base_normalized = f"{base_number} {street}"
        base_exact = address_groups.get((base_normalized, zip_code)) or address_only_groups.get(base_normalized)
        if base_exact:
            return consolidate(base_exact), "base_number"
    if number:
        candidates = number_zip_index.get((number, zip_code), [])
        scored = sorted(
            (
                SequenceMatcher(None, street, candidate_street).ratio(),
                candidate_normalized,
                candidate_record,
            )
            for candidate_street, candidate_normalized, candidate_record in candidates
        )
        if scored and scored[-1][0] >= 0.78:
            best_score, best_normalized, _ = scored[-1]
            return consolidate(address_groups[(best_normalized, zip_code)]), f"fuzzy:{best_score:.3f}"

        all_zip_candidates = number_index.get(number, [])
        scored_all = sorted(
            (
                SequenceMatcher(None, street, candidate_street).ratio(),
                candidate_normalized,
                candidate_zip,
                candidate_record,
            )
            for candidate_street, candidate_normalized, candidate_zip, candidate_record in all_zip_candidates
        )
        if scored_all and scored_all[-1][0] >= 0.85:
            best_score, best_normalized, best_zip, _ = scored_all[-1]
            return consolidate(address_groups[(best_normalized, best_zip)]), f"fuzzy_other_zip:{best_score:.3f}"

    census_result = CENSUS_RESULTS.get(row_id)
    if census_result:
        return census_result, "census"

    return None, "unmatched"


payload = {"files": [], "summary": {"total": 0, "matched": 0, "unmatched": 0}}
census_batch_rows = []

for file_info in FILES:
    with file_info["path"].open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        original_headers = reader.fieldnames or []

    output_rows = []
    unmatched = []
    methods = defaultdict(int)

    for row_index, row in enumerate(rows):
        geocode, method = find_geocode(
            row, file_info["kind"], file_info["name_field"], row_index
        )
        methods[method.split(":", 1)[0]] += 1
        payload["summary"]["total"] += 1
        if geocode:
            payload["summary"]["matched"] += 1
            row.update(
                {
                    "latitude": geocode["latitude"],
                    "longitude": geocode["longitude"],
                    "geocode_matched_address": geocode["matched_address"],
                    "geocode_match_method": METHOD_LABELS.get(
                        method.split(":", 1)[0], method
                    ),
                    "geocode_source": geocode["source"],
                    "geocode_data_as_of": geocode["data_as_of"],
                }
            )
        else:
            payload["summary"]["unmatched"] += 1
            row.update(
                {
                    "latitude": "",
                    "longitude": "",
                    "geocode_matched_address": "",
                    "geocode_match_method": "Unmatched",
                    "geocode_source": "",
                    "geocode_data_as_of": "",
                }
            )
            unmatched.append(
                {
                    "row_index": row_index,
                    "name": row[file_info["name_field"]],
                    "address": row.get("address", ""),
                    "normalized": normalize_address(row.get("address", "")),
                    "zip": zip_from_row(row, file_info["kind"]),
                }
            )
            if file_info["kind"] == "schools":
                location_match = re.match(
                    r"^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})$",
                    row.get("address", "").strip(),
                )
                if location_match:
                    street, city, state, census_zip = location_match.groups()
                else:
                    street, city, state, census_zip = (
                        row.get("address", ""),
                        "San Francisco",
                        "CA",
                        zip_from_row(row, file_info["kind"]),
                    )
            else:
                street, city, state, census_zip = (
                    row.get("address", ""),
                    row.get("city", "San Francisco"),
                    row.get("state", "CA"),
                    zip_from_row(row, file_info["kind"]),
                )
            census_batch_rows.append(
                [
                    f"{file_info['kind']}:{row_index}",
                    street,
                    city,
                    state,
                    census_zip,
                ]
            )
        output_rows.append(row)

    payload["files"].append(
        {
            "path": str(file_info["path"]),
            "kind": file_info["kind"],
            "name_field": file_info["name_field"],
            "headers": original_headers
            + [
                "latitude",
                "longitude",
                "geocode_matched_address",
                "geocode_match_method",
                "geocode_source",
                "geocode_data_as_of",
            ],
            "rows": output_rows,
            "methods": dict(methods),
            "unmatched": unmatched,
        }
    )

PAYLOAD_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
with CENSUS_BATCH_PATH.open("w", newline="", encoding="utf-8") as handle:
    csv.writer(handle).writerows(census_batch_rows)
print(
    json.dumps(
        {
            "summary": payload["summary"],
            "files": [
                {
                    "path": file_payload["path"],
                    "methods": file_payload["methods"],
                    "unmatched": file_payload["unmatched"],
                }
                for file_payload in payload["files"]
            ],
        },
        indent=2,
    )
)
