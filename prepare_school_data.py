import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "sources" / "cde"
PREPARED_PATH = ROOT / "prepared_schools.json"
GREAT_SCHOOLS_PATH = ROOT / "sources" / "greatschools" / "current_san_francisco_ratings.json"


DASHBOARD_FILES = {
    "ELA": "dashboard_ela_2025.xlsx",
    "Math": "dashboard_math_2025.xlsx",
    "Science": "dashboard_science_2025.xlsx",
    "Chronic absenteeism": "dashboard_chronic_2025.xlsx",
    "Suspension": "dashboard_suspension_2025.xlsx",
    "Graduation": "dashboard_grad_2025.xlsx",
    "College/career": "dashboard_cci_2025.xlsx",
    "English learner progress": "dashboard_elpi_2025.xlsx",
}


PRIVATE_ADDRESS_OVERRIDES = {
    "38103896174841": "5th Fiesta Ln, Carson, CA 90745",
    "38103896175269": "236 Santos St, San Francisco, CA 94134",
    "38103896159537": "1499 Potrero Ave, San Francisco, CA 94110-3534",
    "38684786172357": "3741 Buchanan St, San Francisco, CA 94123-1710",
    "38684786174080": "99 Rhode Island St, San Francisco, CA 94103",
    "38684786174197": "2130B Harrison St, San Francisco, CA 94110",
    "38684786142079": "682 Schofield Rd, San Francisco, CA 94129-1198",
    "38684786174122": "799 Moscow St, San Francisco, CA 94112",
    "38684786174940": "50 Jones St. Apt #627, San Francisco, CA 94124",
}


def cds_string(value):
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits.zfill(14) if digits else ""


def join_address(street, city, state, zip_code):
    values = []
    for item in (street, city):
        if pd.notna(item) and str(item).strip():
            values.append(str(item).strip())
    state_zip = " ".join(
        str(item).strip()
        for item in (state, zip_code)
        if pd.notna(item) and str(item).strip()
    )
    if state_zip:
        values.append(state_zip)
    return ", ".join(values)


def private_school_type(row):
    grade_columns = ["Grade K Enroll"] + [f"Grade {grade} Enroll" for grade in range(1, 13)]
    enrollments = [pd.to_numeric(row.get(column), errors="coerce") for column in grade_columns]
    active = [index for index, value in enumerate(enrollments) if pd.notna(value) and value > 0]
    if not active:
        return "Combined/Other"
    low, high = min(active), max(active)
    if high <= 5:
        return "Elementary School"
    if low >= 9:
        return "High School"
    if low >= 6 and high <= 8:
        return "Middle School"
    if low <= 5 and high <= 8:
        return "Elementary/Middle School"
    if low >= 6 and high >= 9:
        return "Middle/High School"
    return "K-12/Combined School"


def load_dashboard_scores():
    by_cds = {}
    for indicator, filename in DASHBOARD_FILES.items():
        frame = pd.read_excel(SOURCE_DIR / filename, dtype={"cds": str})
        frame["cds"] = frame["cds"].map(cds_string)
        student_group = "EL" if indicator == "English learner progress" else "ALL"
        filtered = frame[
            frame["rtype"].eq("S")
            & frame["studentgroup"].eq(student_group)
            & frame["countyname"].str.casefold().eq("san francisco")
        ].copy()
        filtered["color"] = pd.to_numeric(filtered["color"], errors="coerce")
        filtered = filtered[filtered["color"].between(1, 5)]
        for _, record in filtered.drop_duplicates("cds").iterrows():
            by_cds.setdefault(record["cds"], {})[indicator] = float(record["color"])
    return by_cds


def normalize_match_text(value):
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().casefold()
    text = text.replace("&", " and ")
    text = re.sub(
        r"\b(school|elementary|middle|high|academy|charter|public|alternative|traditional)\b",
        " ",
        text,
    )
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def normalize_match_address(value):
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().casefold()
    replacements = {
        "street": "st",
        "avenue": "ave",
        "boulevard": "blvd",
        "road": "rd",
        "drive": "dr",
        "circle": "cir",
        "sixth": "6th",
        "seventh": "7th",
        "eighth": "8th",
    }
    for source, replacement in replacements.items():
        text = re.sub(rf"\b{source}\b", replacement, text)
    text = re.sub(r"\bsan francisco\b.*", "", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def load_greatschools_matches(public):
    source = json.loads(GREAT_SCHOOLS_PATH.read_text(encoding="utf-8"))
    matches = {}
    used_public_indices = set()

    for school_name, rating, address, profile_url in source["ratings"]:
        candidates = []
        normalized_profile_address = normalize_match_address(address)
        profile_number = re.match(r"\d+", normalized_profile_address)
        for index, record in public.iterrows():
            normalized_public_address = normalize_match_address(record["full_address"])
            public_number = re.match(r"\d+", normalized_public_address)
            name_score = SequenceMatcher(
                None,
                normalize_match_text(school_name),
                normalize_match_text(record["School Name"]),
            ).ratio()
            address_score = SequenceMatcher(
                None,
                normalized_profile_address,
                normalized_public_address,
            ).ratio()
            number_bonus = (
                0.08
                if profile_number and public_number and profile_number.group() == public_number.group()
                else 0
            )
            score = 0.72 * name_score + 0.28 * address_score + number_bonus
            candidates.append((score, index))

        score, best_index = max(candidates)
        if score < 0.60:
            raise ValueError(f"GreatSchools match below audit threshold: {school_name} ({score:.3f})")
        if best_index in used_public_indices:
            raise ValueError(f"GreatSchools duplicate public-school match: {school_name}")
        used_public_indices.add(best_index)
        cds = cds_string(public.loc[best_index, "CDS Code"])
        matches[cds] = {
            "rating": int(rating),
            "profile_url": profile_url,
            "as_of": source["retrieved_at"],
        }

    return source["retrieved_at"], matches


def build_public_rows():
    public = pd.read_csv(SOURCE_DIR / "public_schools_2025_26.csv", dtype=str)
    public = public[
        public["County Name"].str.casefold().eq("san francisco")
        & public["Status"].eq("Active")
    ].copy()
    public["full_address"] = public.apply(
        lambda record: join_address(record["Street"], record["City"], record["State"], record["Zip"]),
        axis=1,
    )
    rating_as_of, greatschools_matches = load_greatschools_matches(public)
    level_names = {
        "Elementary": "Elementary School",
        "Middle": "Middle School",
        "High": "High School",
        "Elem-High Combo": "K-12/Combined School",
    }
    rows = []
    for _, record in public.iterrows():
        cds = cds_string(record["CDS Code"])
        match = greatschools_matches.get(cds)
        if match:
            rating = match["rating"]
            profile_url = match["profile_url"]
            notes = f"Current GreatSchools rating retrieved {rating_as_of}"
        else:
            rating = None
            profile_url = ""
            notes = f"No numeric GreatSchools rating found in the San Francisco directory as of {rating_as_of}"
        rows.append(
            {
                "school": str(record["School Name"]).strip(),
                "address": record["full_address"],
                "public_vs_private": "Public",
                "school_type": level_names.get(record["School Level"], str(record["School Level"]).strip()),
                "greatschools_rating": rating,
                "greatschools_rating_as_of": rating_as_of,
                "greatschools_profile_url": profile_url,
                "private_staffing_proxy_rating": None,
                "private_staffing_proxy_basis": "",
                "rating_notes": notes,
                "cds_code": cds,
            }
        )
    return rows


def build_private_rows():
    private = pd.read_excel(SOURCE_DIR / "private_schools_2025_26.xlsx", header=5)
    private["CDS Code"] = private["CDS Code"].map(cds_string)

    full_time = pd.to_numeric(private["Full Time Teachers"], errors="coerce")
    part_time = pd.to_numeric(private["Part Time Teachers"], errors="coerce")
    enrollment = pd.to_numeric(private["Total Enrollment"], errors="coerce")
    teacher_fte = full_time + 0.5 * part_time
    private["student_teacher_ratio"] = enrollment / teacher_fte.where(teacher_fte > 0)
    valid_ratios = private.loc[
        private["student_teacher_ratio"].gt(0) & np.isfinite(private["student_teacher_ratio"]),
        "student_teacher_ratio",
    ]
    ranks = valid_ratios.rank(method="average", ascending=True)
    if len(valid_ratios) > 1:
        private_rating = 10 - 9 * (ranks - 1) / (len(valid_ratios) - 1)
    else:
        private_rating = pd.Series(10.0, index=valid_ratios.index)
    private["staffing_rating"] = private_rating

    locations = pd.read_csv(SOURCE_DIR / "private_school_locations_2024_25.csv", dtype=str)
    locations["USER_CDS"] = locations["USER_CDS"].map(cds_string)
    location_map = {
        record["USER_CDS"]: join_address(record["USER_Street"], record["USER_City"], "CA", record["USER_Zip"])
        for _, record in locations.drop_duplicates("USER_CDS").iterrows()
    }
    location_map.update(PRIVATE_ADDRESS_OVERRIDES)

    san_francisco = private[private["County"].str.casefold().eq("san francisco")].copy()
    rows = []
    for _, record in san_francisco.iterrows():
        cds = record["CDS Code"]
        ratio = record["student_teacher_ratio"]
        raw_rating = record["staffing_rating"]
        if pd.notna(raw_rating):
            rating = round(float(raw_rating), 1)
            detail = f"{float(ratio):.1f} reported students per estimated teacher FTE"
            basis = "2025-26 CDE staffing proxy percentile, scaled 1-10"
        else:
            rating = None
            detail = "No teachers reported; staffing proxy unavailable"
            basis = "2025-26 CDE staffing proxy"
        rows.append(
            {
                "school": str(record["School Name"]).strip(),
                "address": location_map.get(cds, ""),
                "public_vs_private": "Private",
                "school_type": private_school_type(record),
                "greatschools_rating": None,
                "greatschools_rating_as_of": "",
                "greatschools_profile_url": "",
                "private_staffing_proxy_rating": rating,
                "private_staffing_proxy_basis": (
                    "2025-26 CDE staffing proxy: inverse California percentile of students per "
                    "estimated teacher FTE, scaled 1-10; not an official school quality rating"
                ),
                "rating_notes": detail,
                "cds_code": cds,
            }
        )
    return rows


def main():
    rows = build_public_rows() + build_private_rows()
    sector_order = {"Public": 0, "Private": 1}
    rows.sort(key=lambda row: (sector_order[row["public_vs_private"]], row["school"].casefold()))
    metadata = {
        "row_count": len(rows),
        "public_count": sum(row["public_vs_private"] == "Public" for row in rows),
        "private_count": sum(row["public_vs_private"] == "Private" for row in rows),
        "greatschools_rated_public_count": sum(
            row["public_vs_private"] == "Public" and row["greatschools_rating"] is not None
            for row in rows
        ),
        "public_without_greatschools_rating_count": sum(
            row["public_vs_private"] == "Public" and row["greatschools_rating"] is None
            for row in rows
        ),
        "private_proxy_rated_count": sum(
            row["public_vs_private"] == "Private"
            and row["private_staffing_proxy_rating"] is not None
            for row in rows
        ),
        "private_proxy_unavailable_count": sum(
            row["public_vs_private"] == "Private"
            and row["private_staffing_proxy_rating"] is None
            for row in rows
        ),
        "missing_address_count": sum(not row["address"] for row in rows),
    }
    PREPARED_PATH.write_text(json.dumps({"metadata": metadata, "rows": rows}, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
