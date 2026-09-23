import json
import re
from pathlib import Path

import pandas as pd


CDSS_PATH = Path("/tmp/cdss_child_care_centers_fresh.csv")
ELFA_PATH = Path("/tmp/sfdec_elfa_programs.html")
OUTPUT_PATH = Path("/tmp/san_francisco_preschools_rows.json")

CDSS_DATASET_URL = (
    "https://data.ca.gov/dataset/community-care-licensing-facilities"
)
ELFA_DIRECTORY_URL = (
    "https://legacy.sfdec.org/early-learning-for-all/early-learning-programs/"
)


def clean(value):
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_preschool_license(value):
    text = clean(value)
    match = re.search(r"Preschool:\s*(\d{9})", text, re.IGNORECASE)
    if not match:
        match = re.search(r"Single[^0-9]*(\d{9})", text, re.IGNORECASE)
    if not match and re.fullmatch(r"\d{9}", text):
        match = re.match(r"(\d{9})", text)
    return match.group(1) if match else ""


def title_case_official(value):
    text = clean(value).title()
    replacements = {
        "Sf": "SF",
        "Sfusd": "SFUSD",
        "Ucsf": "UCSF",
        "Ymca": "YMCA",
        "Cdc": "CDC",
        "Llc": "LLC",
        "Inc.": "Inc.",
        "CspP": "CSPP",
        "CspP/": "CSPP/",
    }
    for old, new in replacements.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return text


def current_name(elfa_row, cdss_row):
    if elfa_row is not None:
        agency = clean(elfa_row.get("Agency Name"))
        site = clean(elfa_row.get("Site Name"))
        if site and site.casefold() != agency.casefold():
            return f"{agency} - {site}"
        if agency:
            return agency
    return title_case_official(cdss_row.get("facility_name", ""))


def facility_url(license_number):
    return (
        "https://www.ccld.dss.ca.gov/carefacilitysearch/"
        f"?Rewrite=FacDetail%2F{license_number}"
    )


def format_phone(value):
    text = clean(value)
    digits = re.sub(r"\D", "", text)
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+1 ({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    return text


cdss = pd.read_csv(CDSS_PATH, dtype=str).fillna("")
cdss["facility_number"] = cdss["facility_number"].astype(str).str.strip()

sf_all = cdss[
    (cdss["county_name"].str.upper() == "SAN FRANCISCO")
    & (cdss["facility_city"].str.upper() == "SAN FRANCISCO")
].copy()

sf_active_preschools = sf_all[
    (sf_all["facility_status"].str.upper() == "LICENSED")
    & sf_all["facility_type"].isin(
        ["DAY CARE CENTER", "SINGLE LICENSED CHILD CARE CENTER"]
    )
].copy()

elfa_centers = pd.read_html(ELFA_PATH)[1].fillna("")
elfa_centers["parsed_license"] = elfa_centers["License Number"].map(
    parse_preschool_license
)
elfa_centers = elfa_centers[elfa_centers["parsed_license"] != ""].copy()
elfa_centers = elfa_centers.drop_duplicates("parsed_license", keep="first")
elfa_by_license = {
    clean(row["parsed_license"]): row for _, row in elfa_centers.iterrows()
}

all_cdss_by_license = {
    clean(row["facility_number"]): row for _, row in sf_all.iterrows()
}
active_by_license = {
    clean(row["facility_number"]): row
    for _, row in sf_active_preschools.iterrows()
}

license_numbers = sorted(set(active_by_license) | set(elfa_by_license))
rows = []

for license_number in license_numbers:
    cdss_row = all_cdss_by_license.get(license_number)
    elfa_row = elfa_by_license.get(license_number)
    licensed_in_export = license_number in active_by_license
    elfa_member = elfa_row is not None

    if cdss_row is None:
        cdss_row = {}

    if elfa_member and licensed_in_export:
        rating = "A - ELFA quality standards + licensed"
        rating_basis = (
            "Listed in San Francisco DEC's ELFA quality network and shown as "
            "LICENSED in the CDSS child care center export dated 2025-05-25."
        )
    elif licensed_in_export:
        rating = "B - Licensed; no ELFA designation found"
        rating_basis = (
            "Shown as LICENSED in the CDSS child care center export dated "
            "2025-05-25; no matching preschool license was found in the current "
            "SF DEC ELFA directory. ELFA participation is not universal."
        )
    else:
        rating = "Review - ELFA-listed; verify license status"
        prior_status = clean(cdss_row.get("facility_status"))
        prior_type = clean(cdss_row.get("facility_type"))
        if prior_status or prior_type:
            rating_basis = (
                "Listed in the current SF DEC ELFA directory. The CDSS export "
                f"dated 2025-05-25 lists this license as {prior_status or 'status unknown'} "
                f"/ {prior_type or 'type unknown'}, rather than as an active preschool "
                "or day care center. Verify the latest status and compliance history."
            )
        else:
            rating_basis = (
                "Listed in the current SF DEC ELFA directory, but the license is "
                "not present in the CDSS child care center export dated 2025-05-25. "
                "Verify the latest status and compliance history."
            )

    address = (
        clean(elfa_row.get("Site Address"))
        if elfa_member and clean(elfa_row.get("Site Address"))
        else title_case_official(cdss_row.get("facility_address", ""))
    )
    zip_code = (
        clean(elfa_row.get("Zip Code"))
        if elfa_member and clean(elfa_row.get("Zip Code"))
        else clean(cdss_row.get("facility_zip", ""))
    )
    if zip_code.endswith(".0"):
        zip_code = zip_code[:-2]

    phone = format_phone(
        clean(elfa_row.get("Phone (Program Contact)"))
        if elfa_member and clean(elfa_row.get("Phone (Program Contact)"))
        else clean(cdss_row.get("facility_telephone_number", ""))
    )

    rows.append(
        {
            "preschool": current_name(elfa_row, cdss_row),
            "address": address,
            "city": "San Francisco",
            "state": "CA",
            "zip": zip_code,
            "provider_type": clean(cdss_row.get("facility_type"))
            or "ELFA preschool/center",
            "license_number": license_number,
            "license_status_in_cdss_2025_export": clean(
                cdss_row.get("facility_status")
            )
            or "Not present",
            "licensed_capacity": clean(cdss_row.get("facility_capacity")),
            "phone": phone,
            "license_first_date": clean(cdss_row.get("license_first_date")),
            "elfa_network_member": "Yes" if elfa_member else "No",
            "preschool_screening_rating": rating,
            "rating_basis": rating_basis,
            "rating_limitations": (
                "Screening category, not a standardized academic or review-site "
                "rating. Check current CCLD inspections/complaints, visit the site, "
                "and confirm age fit, availability, cost, staffing, and curriculum."
            ),
            "address_source": (
                "SF DEC ELFA directory" if elfa_member else "CDSS export"
            ),
            "cdss_facility_detail_url": facility_url(license_number),
            "cdss_dataset_url": CDSS_DATASET_URL,
            "elfa_directory_url": ELFA_DIRECTORY_URL,
            "cdss_export_data_date": "2025-05-25",
            "elfa_directory_access_date": "2026-09-22",
        }
    )

rating_order = {
    "A - ELFA quality standards + licensed": 0,
    "B - Licensed; no ELFA designation found": 1,
    "Review - ELFA-listed; verify license status": 2,
}
rows.sort(
    key=lambda row: (
        rating_order[row["preschool_screening_rating"]],
        row["preschool"].casefold(),
        row["license_number"],
    )
)

summary = {
    "row_count": len(rows),
    "active_cdss_preschools": len(active_by_license),
    "elfa_preschool_licenses": len(elfa_by_license),
    "rating_counts": pd.Series(
        [row["preschool_screening_rating"] for row in rows]
    ).value_counts().to_dict(),
    "rows": rows,
}
OUTPUT_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({key: value for key, value in summary.items() if key != "rows"}, indent=2))
