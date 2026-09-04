#!/usr/bin/env python3
"""Genera el catálogo LOMLOE de Matemáticas desde el HTML oficial del BOE.

Uso:
  python3 tools/generate_lomloe_catalog.py /tmp/rd217.html /tmp/rd243.html \
    [/tmp/madrid-eso.txt /tmp/madrid-bto.txt]
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path


ESO_SOURCE = "https://www.boe.es/eli/es/rd/2022/03/29/217/con"
BTO_SOURCE = "https://www.boe.es/eli/es/rd/2022/04/05/243/con"
MADRID_ESO_SOURCE = "https://www.bocm.es/boletin/CM_Orden_BOCM/2022/07/26/BOCM-20220726-2.PDF"
MADRID_BTO_SOURCE = "https://www.bocm.es/boletin/CM_Orden_BOCM/2022/07/26/BOCM-20220726-1.PDF"

KEY_COMPETENCIES = {
    "CCL": "Competencia en comunicación lingüística",
    "CP": "Competencia plurilingüe",
    "STEM": "Competencia matemática y competencia en ciencia, tecnología e ingeniería",
    "CD": "Competencia digital",
    "CPSAA": "Competencia personal, social y de aprender a aprender",
    "CC": "Competencia ciudadana",
    "CE": "Competencia emprendedora",
    "CCEC": "Competencia en conciencia y expresión culturales",
}

SUBJECTS = {
    "1eso-matematicas": ("1ºESO", "Matemáticas", "eso-common"),
    "2eso-matematicas": ("2ºESO", "Matemáticas", "eso-common"),
    "3eso-matematicas": ("3ºESO", "Matemáticas", "eso-common"),
    "4eso-matematicas-a": ("4ºESO", "Matemáticas A", "eso-a"),
    "4eso-matematicas-b": ("4ºESO", "Matemáticas B", "eso-b"),
    "1bto-matematicas-i": ("1ºBTO", "Matemáticas I", "bto-math-i"),
    "2bto-matematicas-ii": ("2ºBTO", "Matemáticas II", "bto-math-ii"),
    "1bto-matematicas-ccss-i": ("1ºBTO", "Matemáticas CC.SS. I", "bto-social-i"),
    "2bto-matematicas-ccss-ii": ("2ºBTO", "Matemáticas CC.SS. II", "bto-social-ii"),
}


def clean(fragment: str) -> str:
    value = re.sub(r"<[^>]+>", " ", fragment)
    return html.unescape(re.sub(r"\s+", " ", value)).strip()


def paragraphs(raw: str) -> list[str]:
    return [text for match in re.finditer(r"<p\b[^>]*>(.*?)</p>", raw, re.I | re.S)
            if (text := clean(match.group(1)))]


def descriptors(raw: str, stage: str) -> list[dict]:
    result = []
    seen = set()
    descriptor_pattern = re.compile(
        r"(?:^|\s)(CCL|CP|STEM|CD|CPSAA|CC|CE|CCEC)(\d(?:\.\d)?)\.?\s+(.+?)"
        r"(?=\s+(?:CCL|CP|STEM|CD|CPSAA|CC|CE|CCEC)\d(?:\.\d)?\.?\s|$)"
    )
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", raw, re.I | re.S):
        cells = [clean(cell) for cell in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", row, re.I | re.S)]
        if len(cells) < 2:
            continue
        for match in descriptor_pattern.finditer(cells[-1]):
            prefix, number, description = match.groups()
            code = f"{prefix}{number}"
            descriptor_id = f"{stage.lower()}-{code.lower().replace('.', '-')}"
            if descriptor_id in seen:
                continue
            seen.add(descriptor_id)
            result.append({
                "id": descriptor_id,
                "code": code,
                "keyCompetencyId": prefix.lower(),
                "stage": stage,
                "description": description.strip(),
            })
    return result


def section(items: list[str], start: str, end: str, occurrence: int = 0) -> list[str]:
    starts = [index for index, value in enumerate(items) if value == start]
    begin = starts[occurrence]
    finish = next(index for index in range(begin + 1, len(items)) if items[index] == end)
    return items[begin:finish]


def parse_competencies(items: list[str], start_index: int, end_index: int, namespace: str) -> list[dict]:
    result = []
    current = None
    for value in items[start_index:end_index]:
        statement = re.match(r"^(\d+)\.\s+(.+)$", value)
        if statement:
            number, description = statement.groups()
            current = {
                "id": f"{namespace}-ce-{number}",
                "code": f"CE{number}",
                "description": description,
                "descriptorIds": [],
            }
            result.append(current)
            continue
        if current and value.startswith("Esta competencia específica se conecta con los siguientes descriptores"):
            current["descriptorCodes"] = re.findall(r"\b(?:CCL|CP|STEM|CD|CPSAA|CC|CE|CCEC)\d(?:\.\d)?\b", value)
    return result


def parse_criteria(items: list[str], heading_index: int, namespace: str, competencies: list[dict]) -> list[dict]:
    end = next(index for index in range(heading_index + 1, len(items)) if items[index] == "Saberes básicos.")
    competence_number = None
    result = []
    for value in items[heading_index + 1:end]:
        heading = re.match(r"^Competencia específica (\d+)\.$", value)
        if heading:
            competence_number = heading.group(1)
            continue
        criterion = re.match(r"^(\d+\.\d+)\s+(.+)$", value)
        if criterion and competence_number:
            code, description = criterion.groups()
            competence = next((item for item in competencies if item["code"] == f"CE{competence_number}"), None)
            result.append({
                "id": f"{namespace}-cr-{code.replace('.', '-')}",
                "code": code,
                "competenceId": competence["id"] if competence else f"{namespace}-ce-{competence_number}",
                "competenceCode": f"CE{competence_number}",
                "descriptorIds": competence.get("descriptorIds", []) if competence else [],
                "description": description,
            })
    return result


def remap_competencies(base: list[dict], namespace: str, stage: str) -> list[dict]:
    result = []
    for item in base:
        clone = dict(item)
        clone["id"] = f"{namespace}-ce-{item['code'][2:]}"
        clone["descriptorIds"] = [f"{stage.lower()}-{code.lower().replace('.', '-')}" for code in clone.pop("descriptorCodes", [])]
        result.append(clone)
    return result


def pdf_lines(path: str) -> list[str]:
    ignored = (
        r"^B\.O\.C\.M\.", r"^Pág\. \d+", r"^BOCM$",
        r"^BOLETÍN OFICIAL DE LA COMUNIDAD DE MADRID$", r"^\d+-\d+MCOB$",
    )
    result = []
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = re.sub(r"\s+", " ", raw_line.replace("\f", " ")).strip()
        if not line or any(re.match(pattern, line) for pattern in ignored):
            continue
        result.append(line)
    return result


def find_after(items: list[str], value: str, start: int = 0) -> int:
    return next(index for index in range(start, len(items)) if items[index] == value)


def find_prefix_after(items: list[str], value: str, start: int = 0) -> int:
    return next(index for index in range(start, len(items)) if items[index].startswith(value))


def parse_pdf_criteria(items: list[str], heading_index: int, namespace: str, competencies: list[dict]) -> list[dict]:
    end = next(index for index in range(heading_index + 1, len(items)) if items[index] in {"Contenidos.", "Saberes básicos."})
    records = []
    current_code = None
    current_lines = []

    def flush() -> None:
        if current_code and current_lines:
            records.append((current_code, " ".join(current_lines)))

    for value in items[heading_index + 1:end]:
        if re.match(r"^Competencia específica \d+\.$", value):
            continue
        criterion = re.match(r"^(\d+\.\d+)\.\s*(.*)$", value)
        if criterion:
            flush()
            current_code, first_line = criterion.groups()
            current_lines = [first_line]
        elif current_code:
            current_lines.append(value)
    flush()

    result = []
    for code, description in records:
        competence_number = code.split('.')[0]
        competence = next((item for item in competencies if item["code"] == f"CE{competence_number}"), None)
        result.append({
            "id": f"{namespace}-cr-{code.replace('.', '-')}",
            "code": code,
            "competenceId": competence["id"] if competence else f"{namespace}-ce-{competence_number}",
            "competenceCode": f"CE{competence_number}",
            "descriptorIds": competence.get("descriptorIds", []) if competence else [],
            "description": description,
        })
    return result


def main() -> None:
    if len(sys.argv) not in {3, 5}:
        raise SystemExit("Se necesitan los HTML de RD 217/2022 y RD 243/2022")
    eso_raw = Path(sys.argv[1]).read_text(encoding="utf-8")
    bto_raw = Path(sys.argv[2]).read_text(encoding="utf-8")
    eso = paragraphs(eso_raw)
    bto = paragraphs(bto_raw)

    eso_math = eso.index("Matemáticas")
    eso_comp_start = eso.index("Competencias específicas.", eso_math) + 1
    eso_comp_end = eso.index("Cursos de primero a tercero", eso_comp_start)
    eso_base = parse_competencies(eso, eso_comp_start, eso_comp_end, "eso-math")

    bto_math = bto.index("Matemáticas", 3000)
    bto_math_comp_start = bto.index("Competencias específicas.", bto_math) + 1
    bto_math_comp_end = bto.index("Matemáticas I", bto_math_comp_start)
    bto_math_base = parse_competencies(bto, bto_math_comp_start, bto_math_comp_end, "bto-math")

    bto_social = bto.index("Matemáticas Aplicadas a las Ciencias Sociales", bto_math_comp_end)
    bto_social_comp_start = bto.index("Competencias específicas.", bto_social) + 1
    bto_social_comp_end = bto.index("Matemáticas Aplicadas a las Ciencias Sociales I", bto_social_comp_start)
    bto_social_base = parse_competencies(bto, bto_social_comp_start, bto_social_comp_end, "bto-social")

    configs = {
        "eso-common": (eso, eso.index("Criterios de evaluación", eso_comp_end), eso_base, "ESO"),
        "eso-a": (eso, eso.index("Criterios de evaluación", eso.index("MATEMÁTICAS A", eso_comp_end)), eso_base, "ESO"),
        "eso-b": (eso, eso.index("Criterios de evaluación", eso.index("MATEMÁTICAS B", eso_comp_end)), eso_base, "ESO"),
        "bto-math-i": (bto, bto.index("Criterios de evaluación", bto.index("Matemáticas I", bto_math_comp_end)), bto_math_base, "Bachillerato"),
        "bto-math-ii": (bto, bto.index("Criterios de evaluación", bto.index("Matemáticas II", bto_math_comp_end)), bto_math_base, "Bachillerato"),
        "bto-social-i": (bto, bto.index("Criterios de evaluación", bto.index("Matemáticas Aplicadas a las Ciencias Sociales I", bto_social_comp_end)), bto_social_base, "Bachillerato"),
        "bto-social-ii": (bto, bto.index("Criterios de evaluación", bto.index("Matemáticas aplicadas a las Ciencias Sociales II", bto_social_comp_end)), bto_social_base, "Bachillerato"),
    }

    subject_catalogs = {}
    for subject_id, (course, title, config_key) in SUBJECTS.items():
        items, criteria_heading, base, stage = configs[config_key]
        namespace = subject_id
        competencies = remap_competencies([dict(item) for item in base], namespace, stage)
        criteria = parse_criteria(items, criteria_heading, namespace, competencies)
        subject_catalogs[subject_id] = {
            "schemaVersion": 1,
            "subjectId": subject_id,
            "course": course,
            "subjectTitle": title,
            "stage": stage,
            "specificCompetencies": competencies,
            "evaluationCriteria": criteria,
            "sources": [{"title": "Real Decreto 217/2022" if stage == "ESO" else "Real Decreto 243/2022", "url": ESO_SOURCE if stage == "ESO" else BTO_SOURCE}],
        }

    # Madrid concreta criterios diferentes para cada curso de ESO. Cuando se
    # facilitan las extracciones de los decretos autonómicos, sustituyen los
    # mínimos estatales conservando competencias y descriptores comunes.
    if len(sys.argv) == 5:
        madrid_eso = pdf_lines(sys.argv[3])
        madrid_bto = pdf_lines(sys.argv[4])
        math_start = find_after(madrid_eso, "MATEMÁTICAS")
        eso_anchors = {
            "1eso-matematicas": ("1º ESO.", None),
            "2eso-matematicas": ("2º ESO.", None),
            "3eso-matematicas": ("3º ESO.", None),
            "4eso-matematicas-a": ("4º ESO.", "MATEMÁTICAS A."),
            "4eso-matematicas-b": ("4º ESO.", "MATEMÁTICAS B."),
        }
        cursor = math_start
        for subject_id, (course_heading, subject_heading) in eso_anchors.items():
            cursor = find_after(madrid_eso, course_heading, cursor)
            if subject_heading:
                cursor = find_after(madrid_eso, subject_heading, cursor)
            criteria_heading = find_prefix_after(madrid_eso, "Criterios de evaluación", cursor)
            catalog = subject_catalogs[subject_id]
            catalog["evaluationCriteria"] = parse_pdf_criteria(
                madrid_eso, criteria_heading, subject_id, catalog["specificCompetencies"]
            )
            catalog["sources"] = [{"title": "Decreto 65/2022 de la Comunidad de Madrid", "url": MADRID_ESO_SOURCE}]
            cursor = criteria_heading + 1

        # Las tres extracciones siguientes son limpias en el PDF oficial. En
        # Matemáticas CC.SS. II el orden accesible del PDF altera la numeración
        # de CE3; se conserva para ella el texto estatal, jurídicamente básico.
        bto_anchors = {
            "1bto-matematicas-i": "Matemáticas I.",
            "2bto-matematicas-ii": "Matemáticas II.",
            "1bto-matematicas-ccss-i": "Matemáticas Aplicadas a las Ciencias Sociales I.",
        }
        cursor = find_after(madrid_bto, "MATEMÁTICAS")
        for subject_id, subject_heading in bto_anchors.items():
            cursor = find_after(madrid_bto, subject_heading, cursor)
            criteria_heading = find_prefix_after(madrid_bto, "Criterios de evaluación", cursor)
            catalog = subject_catalogs[subject_id]
            catalog["evaluationCriteria"] = parse_pdf_criteria(
                madrid_bto, criteria_heading, subject_id, catalog["specificCompetencies"]
            )
            catalog["sources"] = [{"title": "Decreto 64/2022 de la Comunidad de Madrid", "url": MADRID_BTO_SOURCE}]
            cursor = criteria_heading + 1
        subject_catalogs["2bto-matematicas-ccss-ii"]["sources"] = [
            {"title": "Decreto 64/2022 de la Comunidad de Madrid", "url": MADRID_BTO_SOURCE}
        ]

    global_catalog = {
        "schemaVersion": 1,
        "keyCompetencies": [{"id": key.lower(), "code": key, "title": title} for key, title in KEY_COMPETENCIES.items()],
        "operationalDescriptors": descriptors(eso_raw, "ESO") + descriptors(bto_raw, "Bachillerato"),
        "sources": [
            {"title": "Real Decreto 217/2022", "url": ESO_SOURCE},
            {"title": "Real Decreto 243/2022", "url": BTO_SOURCE},
        ],
    }

    output = {"global": global_catalog, "subjects": subject_catalogs}
    destination = Path("src/data/lomloeMathLaw.json")
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    functions_destination = Path("functions/lomloeMathLaw.json")
    functions_destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generados {len(global_catalog['operationalDescriptors'])} descriptores y "
          f"{sum(len(value['evaluationCriteria']) for value in subject_catalogs.values())} criterios.")


if __name__ == "__main__":
    main()
