const fs = require("fs");
const path = require("path");

let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch (err) {
  puppeteer = null;
}

let PDFDocument;
try {
  ({ PDFDocument } = require("pdf-lib"));
} catch (err) {
  PDFDocument = null;
}

const THEME = {
  blue: "#2b8ecf",
  teal: "#4cc8c0",
  lightBlue: "#d8ebf7",
  paleBlue: "#edf7fb",
  paleGray: "#f7f7f7",
  border: "#d8e5ef",
  text: "#1f2933",
  muted: "#5f6b78",
};

const INLINE_LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">
  <rect width="140" height="140" fill="white"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M32 18h22c4 0 7 3 7 7v22c0 4 3 7 7 7h22c4 0 7 3 7 7v22c0 4-3 7-7 7H68c-4 0-7 3-7 7v22c0 4-3 7-7 7H32c-4 0-7-3-7-7V97c0-4-3-7-7-7H-4c-4 0-7-3-7-7V61c0-4 3-7 7-7h22c4 0 7-3 7-7V25c0-4 3-7 7-7z" transform="translate(30 18)" stroke="#2b8ecf" stroke-width="7"/>
    <path d="M28 71c8-16 24-27 42-27 8 0 16 2 23 6-7 18-21 31-39 39 11-2 21-9 28-18-2 17-17 31-36 31-8 0-15-2-21-6 2-9 4-18 3-25z" transform="translate(12 12)" stroke="#4cc8c0" stroke-width="7"/>
  </g>
</svg>`;

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(INLINE_LOGO_SVG).toString("base64")}`;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const formatAgeGender = (age, gender) => {
  const ageText = age === null || age === undefined || age === "" ? "-" : String(age).trim();
  const genderText = gender ? String(gender).trim().toUpperCase().slice(0, 1) : "-";
  return `${ageText} / ${genderText}`;
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const toTextLines = (value) => {
  if (!value) return [];
  return String(value)
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const buildBarLogo = () => `
  <div class="brand-bar">
    <div class="brand-logo">
      <img src="${LOGO_DATA_URI}" alt="Logo" />
    </div>
    <div class="brand-swashes">
      <div>
        <span class="brand-teal"></span>
        <span class="brand-blue"></span>
      </div>
    </div>
  </div>
`;

const buildHeaderTemplate = (data = {}, title = "") => {
  const fields = [
    ["Patient Name", data.employeeName || "-"],
    ["Age / Gender", data.ageGender || "-"],
    ["ABS No.", data.absNo || "-"],
    ["Blood Group", data.bloodGroup || "-"],
    ["Date & Time", data.dateTime || "-"],
    ["Sample Type", data.sampleType || ""],
  ].filter(([, value], index) => index < 5 || normalizeText(value));

  return `
    <div class="report-header-inner">
      ${buildBarLogo()}
      <div class="patient-strip">
        ${fields.map(([label, value]) => `
          <div class="patient-field">
            <div class="patient-label">${escapeHtml(label)}</div>
            <div class="patient-value">${escapeHtml(value || "-")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
};

const buildFooterTemplate = () => `
  <div style="width:100%;text-align:center;font-size:10px;color:#8a97a4;padding-top:6px;">
    <span class="pageNumber"></span>/<span class="totalPages"></span>
  </div>
`;

const buildFooterBars = () => `
  <div style="display:flex;height:24px;width:100%;align-items:stretch;">
    <div style="flex:1;background:${THEME.blue};"></div>
    <div style="width:28%;background:${THEME.teal};"></div>
  </div>
`;

const validate = (schemaName, data, requiredKeys) => {
  const missing = requiredKeys.filter((key) => {
    const value = data?.[key];
    return value === undefined || value === null;
  });

  if (missing.length > 0) {
    throw new Error(`${schemaName} missing required fields: ${missing.join(", ")}`);
  }

  return data;
};

const pickEmployee = (record = {}) => {
  const employee = record.Employee && typeof record.Employee === "object" ? record.Employee : {};
  const family = record.FamilyMember && typeof record.FamilyMember === "object" ? record.FamilyMember : {};
  const isFamily = Boolean(record.IsFamilyMember);

  const source = isFamily ? family : employee;
  return {
    name: normalizeText(source.Name || source.name || record.employeeName || record.patientName || "Patient"),
    absNo: normalizeText(employee.ABS_NO || employee.ABS_NO || record.absNo || record.Employee?.ABS_NO || record.ABS_NO || "-"),
    bloodGroup: normalizeText(source.Blood_Group || source.bloodGroup || employee.Blood_Group || employee.bloodGroup || record.bloodGroup || "-"),
    gender: normalizeText(source.Gender || source.gender || employee.Gender || employee.gender || record.gender || ""),
    age: normalizeText(source.Age || source.age || employee.Age || employee.age || record.age || ""),
    dob: source.DOB || source.dob || employee.DOB || employee.dob || null,
  };
};

const deriveAge = (patient) => {
  const ageValue = normalizeText(patient.age);
  if (ageValue) return ageValue;
  if (!patient.dob) return "-";
  const dob = new Date(patient.dob);
  if (Number.isNaN(dob.getTime())) return "-";
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return String(age);
};

const buildPrescriptionData = (record = {}) => {
  const patient = pickEmployee(record);
  const vitals = record?.PatientMetrics || record?.VisitSummary?.Vitals || record?.Vitals || {};
  const visitVitals = record?.VisitSummary?.Vitals || record?.Vitals || {};
  const getVital = (...values) => {
    const value = values.find((item) => item !== undefined && item !== null && item !== "");
    return normalizeText(value || "");
  };
  const getDisplayName = (item = {}, keys = []) => {
    if (typeof item === "string") return item;
    for (const key of keys) {
      const value = key.split(".").reduce((current, part) => current?.[part], item);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return item?.Test_Name || item?.Xray_Type || item?.name || item?.value_name || "";
  };
  const prescriptionRows = safeArray(record?.Medicines).map((medicine) => ({
    medicine: medicine?.Medicine_Name || medicine?.name || "-",
    dosage: medicine?.Strength || medicine?.dosage || "-",
    frequency: [
      medicine?.Morning ? "Morning" : null,
      medicine?.Afternoon ? "Afternoon" : null,
      medicine?.Night ? "Night" : null,
    ].filter(Boolean).join("/") || medicine?.Frequency || medicine?.frequency || medicine?.Type || medicine?.Medicine_Type || "-",
    duration: medicine?.Duration || medicine?.duration || "-",
    instructions: medicine?.Remarks || medicine?.FoodTiming || medicine?.instructions || "-",
  }));

  return validate("prescription", {
    employeeName: patient.name,
    bloodGroup: patient.bloodGroup || "-",
    ageGender: formatAgeGender(deriveAge(patient), patient.gender),
    dateTime: formatDateTime(record?.Timestamp || record?.created_at || record?.createdAt),
    absNo: patient.absNo || "-",
    bp: getVital(visitVitals.Blood_Pressure, visitVitals.bp, vitals.Blood_Pressure, vitals.bp),
    pulse: getVital(visitVitals.Pulse, visitVitals.pulse, vitals.Pulse, vitals.pulse),
    temperature: getVital(visitVitals.Temperature, visitVitals.temperature, vitals.Temperature, vitals.temperature),
    spo2: getVital(visitVitals.Oxygen, visitVitals.spo2, visitVitals.SpO2, vitals.Oxygen, vitals.spo2, vitals.SpO2),
    height: normalizeText(vitals.Height || vitals.height || ""),
    weight: normalizeText(vitals.Weight || vitals.weight || ""),
    bmi: normalizeText(vitals.BMI || vitals.bmi || ""),
    labTests: safeArray(record?.Investigations?.labTests || record?.labTests || record?.relatedTests || []).map((item) =>
      getDisplayName(item, ["Test_Name", "test_name", "name", "Test_ID.Test_Name", "Test_ID.name", "Test_ID.value_name"])
    ).filter(Boolean),
    radiology: safeArray(record?.Investigations?.radiology || record?.radiology || record?.relatedXrays || []).map((item) =>
      getDisplayName(item, ["Xray_Type", "xrayType", "name", "Xray_ID.Xray_Type", "Xray_ID.name", "Xray_ID.value_name"])
    ).filter(Boolean),
    diagnosisText: normalizeText(record?.Diagnosis_Notes || record?.Notes || record?.doctorNotes || record?.diagnosisText || ""),
    prescriptions: prescriptionRows,
  }, [
    "employeeName",
    "bloodGroup",
    "ageGender",
    "dateTime",
    "absNo",
    "bp",
    "pulse",
    "temperature",
    "spo2",
    "height",
    "weight",
    "bmi",
    "labTests",
    "radiology",
    "diagnosisText",
    "prescriptions",
  ]);
};

const getDepartmentName = (panelName = "", rows = []) => {
  const text = `${panelName} ${safeArray(rows).map((row) => row.groupLabel || row.testName || "").join(" ")}`.toLowerCase();
  if (text.includes("haem") || text.includes("hem")) return "DEPARTMENT OF HAEMATOLOGY";
  if (text.includes("lipid") || text.includes("glucose") || text.includes("cholesterol")) return "DEPARTMENT OF CLINICAL BIOCHEMISTRY";
  if (text.includes("xray") || text.includes("radiolog")) return "DEPARTMENT OF RADIOLOGY";
  return "DEPARTMENT OF PATHOLOGY";
};

const qualitativeValues = [
  "negative",
  "positive",
  "trace",
  "present",
  "absent",
  "reactive",
  "non-reactive",
  "nonreactive",
  "detected",
  "not detected",
  "nil",
  "none",
];

const parseNumeric = (value) => {
  const match = normalizeText(value).match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const selectSexSpecificReference = (reference, gender) => {
  const parts = normalizeText(reference).split("|").map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => /^(?:m|male|f|female)\s*:/i.test(part))) return reference;

  const sex = normalizeText(gender).toLowerCase();
  const prefix = /^(?:m|male)\s*:/i.test(sex) || sex.startsWith("m") ? /^(?:m|male)\s*:/i :
    /^(?:f|female)\s*:/i.test(sex) || sex.startsWith("f") ? /^(?:f|female)\s*:/i : null;
  if (!prefix) return null;
  const selected = parts.find((part) => prefix.test(part));
  return selected ? selected.replace(prefix, "").trim() : null;
};

const parseReferenceInterval = (reference, gender) => {
  const selectedReference = selectSexSpecificReference(reference, gender);
  if (selectedReference === null) return null;
  const value = normalizeText(selectedReference).replace(/^normal\s*:\s*/i, "").trim();
  if (!value) return null;
  const rangeValue = value.replace(/\u2013|\u2014/g, "-");
  const asciiRange = rangeValue.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)(?:\s*[a-z%/]+)?$/i);
  if (asciiRange) return { kind: "range", min: Number(asciiRange[1]), max: Number(asciiRange[2]) };

  const range = value.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)(?:\s*[a-z%/]+)?$/i);
  if (range) {
    return { kind: "range", min: Number(range[1]), max: Number(range[2]) };
  }

  const bound = value.match(/^(<=|<|>=|>)\s*(-?\d+(?:\.\d+)?)(?:\s*[a-z%/]+)?$/i);
  if (bound) return { kind: "bound", operator: bound[1], value: Number(bound[2]) };

  if (!/\d/.test(value)) {
    const qualitative = value.toLowerCase();
    if (qualitativeValues.includes(qualitative)) return { kind: "qualitative", value: qualitative };
  }

  return null;
};

const isResultOutOfRange = (test = {}, gender = "") => {
  const testName = normalizeText(test?.Test_Name || test?.name || "Test");
  const reference = normalizeText(test?.Reference_Range || test?.referenceRange || "");
  const result = normalizeText(test?.Result_Value ?? test?.Result ?? test?.value ?? "");
  if (!reference || !result || result === "-") return false;

  const interval = parseReferenceInterval(reference, gender);
  if (!interval) {
    console.warn(`[reportLayout] Reference interval was not parseable for ${testName}: "${reference}"`);
    return false;
  }

  if (interval.kind === "qualitative") return result.toLowerCase() !== interval.value;

  const numericResult = parseNumeric(result);
  if (numericResult === null || /\//.test(result)) {
    console.warn(`[reportLayout] Result was not parseable for ${testName}: "${result}" against "${reference}"`);
    return false;
  }

  if (interval.kind === "range") return numericResult < interval.min || numericResult > interval.max;
  if (interval.operator === "<") return numericResult >= interval.value;
  if (interval.operator === "<=") return numericResult > interval.value;
  if (interval.operator === ">") return numericResult <= interval.value;
  return numericResult < interval.value;
};

const buildDiagnosisData = (record = {}) => {
  const patient = pickEmployee(record);
  const tests = safeArray(record?.Tests);
  const panelName = normalizeText(record?.PanelName || record?.panelName || record?.Panel || record?.name || tests[0]?.Group || tests[0]?.Category || "Report");
  const groupedRows = [];
  let currentGroup = "";

  tests.forEach((test) => {
    const groupLabel = normalizeText(test?.Group || test?.Category || "");
    if (groupLabel && groupLabel !== currentGroup && groupLabel !== panelName) {
      groupedRows.push({
        type: "group",
        groupLabel,
        groupSubLabel: normalizeText(test?.Method ? `(Method: ${test.Method})` : ""),
      });
      currentGroup = groupLabel;
    }

    groupedRows.push({
      type: "row",
      testName: test?.Test_Name || test?.name || "-",
      result: normalizeDiagnosisResult(test),
      resultOutOfRange: isResultOutOfRange(test, patient.gender),
      units: normalizeText(test?.Units || test?.unit || ""),
      referenceInterval: normalizeText(test?.Reference_Range || test?.referenceRange || "-"),
    });
  });

  return validate("diagnosis", {
    employeeName: patient.name,
    bloodGroup: patient.bloodGroup || "-",
    ageGender: formatAgeGender(deriveAge(patient), patient.gender),
    dateTime: formatDateTime(tests[0]?.Timestamp || record?.Timestamp || record?.createdAt),
    absNo: patient.absNo || "-",
    sampleType: normalizeText(record?.Sample_Type || record?.sampleType || "Whole Blood EDTA"),
    departmentName: getDepartmentName(panelName, groupedRows),
    panelName,
    rows: groupedRows.length > 0
      ? groupedRows
      : [{
          type: "row",
          testName: "-",
          result: "-",
          resultOutOfRange: false,
          units: "-",
          referenceInterval: "-",
        }],
  }, [
    "employeeName",
    "bloodGroup",
    "ageGender",
    "dateTime",
    "absNo",
    "sampleType",
    "departmentName",
    "panelName",
    "rows",
  ]); 
};

const isQualitativeReference = (reference = "") => {
  const value = normalizeText(reference).toLowerCase();
  if (!value) return false;
  if (/\d/.test(value)) return false;
  return /(negative|positive|trace|present|absent|reactive|non-reactive|nonreactive|detected|not detected|nil|none)/i.test(value);
};

const isQualitativeTestName = (testName = "") => {
  const value = normalizeText(testName).toLowerCase();
  return /(urine|urinalysis|protein|albumin|glucose|sugar|ketone|bilirubin|urobilinogen|nitrite|leukocyte|blood|pus|epithelial|bacteria|crystal|cast)/i.test(value);
};

const normalizeDiagnosisResult = (test = {}) => {
  const rawResult = normalizeText(test?.Result_Value ?? test?.Result ?? test?.value ?? "-");
  const reference = normalizeText(test?.Reference_Range || test?.referenceRange || "");
  const testName = normalizeText(test?.Test_Name || test?.name || "");

  if (!rawResult || rawResult === "-") return "-";
  if (!isQualitativeReference(reference) && !isQualitativeTestName(testName)) return rawResult;

  const lower = rawResult.toLowerCase();
  if (/(negative|positive|trace|present|absent|reactive|non-reactive|nonreactive|detected|not detected|nil|none)/i.test(lower)) {
    return rawResult;
  }

  const numeric = Number(rawResult);
  if (!Number.isFinite(numeric)) return rawResult;

  if (numeric <= 0) return "Negative";
  if (numeric < 10) return "Trace";
  return "Positive";
};

const buildXrayData = (record = {}) => {
  const patient = pickEmployee(record);
  const xrays = safeArray(record?.Xrays).map((xray) => ({
    xrayType: xray?.Xray_Type || xray?.name || "-",
    bodyPart: xray?.Body_Part || xray?.bodyPart || "-",
    side: xray?.Side || xray?.side || "-",
    view: xray?.View || xray?.view || "-",
    filmSize: xray?.Film_Size || xray?.filmSize || "-",
    findings: xray?.Findings || xray?.findings || "-",
    impression: xray?.Impression || xray?.impression || "-",
    remarks: xray?.Remarks || xray?.remarks || "-",
  }));

  return validate("xray", {
    employeeName: patient.name,
    bloodGroup: patient.bloodGroup || "-",
    ageGender: formatAgeGender(deriveAge(patient), patient.gender),
    dateTime: formatDateTime(xrays[0]?.Timestamp || record?.Timestamp || record?.createdAt),
    absNo: patient.absNo || "-",
    sampleType: normalizeText(record?.Sample_Type || record?.sampleType || "Radiology"),
    departmentName: "DEPARTMENT OF RADIOLOGY",
    panelName: normalizeText(record?.PanelName || record?.panelName || "X-ray"),
    rows: xrays.length > 0 ? xrays : [{
      xrayType: "-",
      bodyPart: "-",
      side: "-",
      view: "-",
      filmSize: "-",
      findings: "-",
      impression: "-",
      remarks: "-",
    }],
  }, [
    "employeeName",
    "bloodGroup",
    "ageGender",
    "dateTime",
    "absNo",
    "sampleType",
    "departmentName",
    "panelName",
    "rows",
  ]);
};

const renderPrescriptionBody = (data) => {
  const vitals = [
    ["BP", data.bp || "-"],
    ["Pulse", data.pulse || "-"],
    ["Temperature", data.temperature ? `${data.temperature} \u00b0F` : "-"],
    ["SpO2", data.spo2 || "-"],
    ["Height", data.height ? `${data.height} cm` : "-"],
    ["Weight", data.weight ? `${data.weight} kg` : "-"],
    ["BMI", data.bmi || "-"],
  ];

  return `
    <section class="report-sheet">
      <div class="report-content">
        <div class="prescription-grid">
          <aside class="panel panel-soft">
            <h2>Vitals</h2>
            <div class="kv-list">
              ${vitals.map(([label, value]) => `<div class="kv"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`).join("")}
            </div>
          </aside>

          <section class="panel panel-white">
            <h2>Diagnosis</h2>
            <div class="diagnosis-text">${toTextLines(data.diagnosisText).map((line) => `<p>${escapeHtml(line)}</p>`).join("") || "<p>&nbsp;</p>"}</div>
          </section>

          <aside class="panel panel-soft investigations">
            <h2>Investigations</h2>
            <div class="invest-section">
              <div class="invest-title">Lab Tests</div>
              ${data.labTests.length ? `<ul>${data.labTests.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<div class='invest-empty'>&nbsp;</div>"}
            </div>
            <div class="invest-section">
              <div class="invest-title">Radiology</div>
              ${data.radiology.length ? `<ul>${data.radiology.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<div class='invest-empty'>&nbsp;</div>"}
            </div>
          </aside>

          <section class="panel panel-white prescription-panel">
            <h2>Prescription</h2>
            <table class="report-table prescription-table">
              <colgroup>
                <col class="medicine-col" />
                <col class="dosage-col" />
                <col class="frequency-col" />
                <col class="duration-col" />
                <col class="instructions-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Dosage</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                ${data.prescriptions.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.medicine)}</td>
                    <td>${escapeHtml(row.dosage)}</td>
                    <td>${escapeHtml(row.frequency)}</td>
                    <td>${escapeHtml(row.duration)}</td>
                    <td>${escapeHtml(row.instructions)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </section>
  `;
};

const renderDiagnosisBody = (data) => {
  return `
    <section class="report-sheet diagnosis-sheet">
      <div class="report-content">
        <div class="diagnosis-header">
          <div class="department-name">${escapeHtml(data.departmentName)}</div>
          <div class="panel-name">${escapeHtml(data.panelName)}</div>
        </div>

        <table class="diagnosis-table">
          <thead>
            <tr>
              <th>TEST NAME</th>
              <th>RESULT</th>
              <th>UNITS</th>
              <th>BIOLOGICAL REFERENCE INTERVAL</th>
            </tr>
          </thead>
          <tbody>
            ${data.rows.map((row) => {
              if (row.type === "group") {
                return `
                  <tr class="group-row">
                    <td colspan="4">
                      <span class="group-label">${escapeHtml(row.groupLabel)}</span>
                      ${row.groupSubLabel ? `<span class="group-sublabel">${escapeHtml(row.groupSubLabel)}</span>` : ""}
                    </td>
                  </tr>
                `;
              }
              return `
                <tr>
                  <td>
                    <div class="row-test-name">${escapeHtml(row.testName)}</div>
                  </td>
                  <td class="result-cell">: ${row.resultOutOfRange ? `<strong>${escapeHtml(row.result)}</strong>` : escapeHtml(row.result)}</td>
                  <td>${escapeHtml(row.units)}</td>
                  <td>${escapeHtml(row.referenceInterval)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
};

const renderXrayBody = (data) => {
  return `
    <section class="report-sheet diagnosis-sheet">
      <div class="report-content">
        <div class="diagnosis-header">
          <div class="department-name">${escapeHtml(data.departmentName)}</div>
          <div class="panel-name">${escapeHtml(data.panelName)}</div>
        </div>

        <table class="diagnosis-table">
          <thead>
            <tr>
              <th>XRAY TYPE</th>
              <th>BODY PART</th>
              <th>SIDE</th>
              <th>VIEW / FILM SIZE / REMARKS</th>
            </tr>
          </thead>
          <tbody>
            ${data.rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.xrayType)}</td>
                <td>${escapeHtml(row.bodyPart)}</td>
                <td>${escapeHtml(row.side)}</td>
                <td>${escapeHtml([row.view, row.filmSize, row.remarks].filter(Boolean).join(" | "))}</td>
              </tr>
              ${row.findings && row.findings !== "-" ? `
                <tr>
                  <td colspan="4" style="padding-top:0;border-top:none;">
                    <div class="xray-findings"><strong>Findings:</strong> ${escapeHtml(row.findings)}</div>
                    ${row.impression && row.impression !== "-" ? `<div class="xray-findings"><strong>Impression:</strong> ${escapeHtml(row.impression)}</div>` : ""}
                  </td>
                </tr>
              ` : ""}
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
};

const buildInfoRow = (label, value) => `
  <div class="info-row">
    <div class="info-label">${escapeHtml(label)}</div>
    <div class="info-value">${escapeHtml(value || "-")}</div>
  </div>
`;

const buildStyles = () => `
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.25;
      color: ${THEME.text};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #ffffff;
    }
    .report-sheet {
      width: 100%;
      padding: 0 0 0 0;
      page-break-after: always;
      break-after: page;
    }
    .report-frame-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2;
      background: #fff;
    }
    .report-frame-footer {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      background: #fff;
    }
    .report-sheet:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .report-content {
      width: 100%;
      padding: 150px 8px 0 8px;
    }
    .report-header-inner {
      padding: 0 10px;
      box-sizing: border-box;
    }
    .brand-bar {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
    }
    .brand-logo {
      width: 56px;
      height: 56px;
      flex: 0 0 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
    }
    .brand-logo img {
      width: 52px;
      height: 52px;
      object-fit: contain;
      display: block;
    }
    .brand-swashes {
      flex: 1;
      padding-top: 0;
    }
    .brand-swashes > div {
      display: flex;
      height: 58px;
      width: 100%;
    }
    .brand-teal {
      width: 28%;
      background: ${THEME.teal};
      height: 58px;
    }
    .brand-blue {
      flex: 1;
      background: ${THEME.blue};
      height: 58px;
    }
    .patient-strip {
      background: ${THEME.lightBlue};
      margin-top: 8px;
      padding: 8px 14px;
      display: grid;
      grid-template-columns: 1.35fr 0.78fr 0.82fr 0.82fr 1.02fr;
      column-gap: 18px;
      row-gap: 4px;
      align-items: start;
    }
    .patient-field {
      min-width: 0;
      overflow: hidden;
    }
    .patient-label {
      font-size: 10pt;
      font-weight: 700;
      color: #111827;
      line-height: 1.1;
      white-space: nowrap;
    }
    .patient-value {
      font-size: 11pt;
      color: #222;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .strip-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }
    .info-row {
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      align-items: baseline;
      padding: 8px 0;
      gap: 16px;
      white-space: nowrap;
    }
    .info-label {
      font-size: 18px;
      font-weight: 700;
      color: #111;
    }
    .info-value {
      font-size: 18px;
      color: #222;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .strip-column { min-width: 0; }
    .prescription-grid {
      display: grid;
      grid-template-columns: 32% 66%;
      grid-template-areas:
        "vitals diagnosis"
        "invest invest"
        "prescription prescription";
      gap: 10px 14px;
      margin-top: 8px;
      padding: 0;
      align-items: start;
    }
    .panel {
      border: none;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .panel-soft {
      background: #eaf8f7;
      padding: 10px 12px;
    }
    .panel-white {
      background: ${THEME.paleGray};
      padding: 10px 12px;
    }
    .panel h2 {
      margin: 0 0 8px;
      font-size: 16pt;
      line-height: 1.1;
      font-weight: 700;
      color: #111;
    }
    .kv-list {
      display: grid;
      gap: 4px;
      font-size: 12pt;
    }
    .kv {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .kv span:first-child { color: #212121; }
    .kv span:last-child { text-align: right; color: #222; }
    .diagnosis-text {
      font-size: 12pt;
      line-height: 1.25;
      color: #333;
      margin-top: 0;
      white-space: pre-wrap;
    }
    .diagnosis-text p { margin: 0 0 3px; }
    .investigations {
      grid-area: invest;
    }
    .prescription-panel {
      grid-area: prescription;
    }
    .prescription-grid > .panel-soft:nth-child(1) { grid-area: vitals; }
    .prescription-grid > .panel-white:nth-child(2) { grid-area: diagnosis; }
    .report-table,
    .diagnosis-table {
      width: 100%;
      border-collapse: collapse;
    }
    .report-table thead th,
    .diagnosis-table thead th {
      text-align: left;
      font-size: 11pt;
      font-weight: 700;
      color: #222;
      background: #f0f5fc;
      padding: 5px 6px;
      border: 1px solid #e0e8f0;
      white-space: normal;
      overflow: visible;
      word-break: normal;
      overflow-wrap: normal;
      hyphens: none;
      line-height: 1.25;
    }
    .report-table td,
    .diagnosis-table td {
      border: 1px solid #e0e8f0;
      padding: 5px 6px;
      font-size: 12pt;
      vertical-align: top;
      background: #fff;
      word-break: normal;
      overflow-wrap: normal;
      hyphens: none;
    }
    .prescription-table {
      table-layout: auto;
    }
    .prescription-table .medicine-col { width: 24%; }
    .prescription-table .dosage-col { width: 12%; }
    .prescription-table .frequency-col { width: 16%; }
    .prescription-table .duration-col { width: 10%; }
    .prescription-table .instructions-col { width: 38%; }
    .prescription-table th:nth-child(1),
    .prescription-table td:nth-child(1) { min-width: 98px; }
    .prescription-table th:nth-child(2),
    .prescription-table td:nth-child(2) { min-width: 56px; }
    .prescription-table th:nth-child(3),
    .prescription-table td:nth-child(3) { min-width: 76px; }
    .prescription-table th:nth-child(4),
    .prescription-table td:nth-child(4) { min-width: 64px; }
    .prescription-table th:nth-child(5),
    .prescription-table td:nth-child(5) { min-width: 168px; }
    .report-table tr:nth-child(even) td {
      background: #fcfdff;
    }
    .invest-section + .invest-section { margin-top: 10px; }
    .invest-title {
      font-size: 14pt;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .invest-section ul {
      margin: 0;
      padding-left: 16px;
      font-size: 12pt;
      line-height: 1.25;
    }
    .invest-empty { min-height: 12px; }
    .diagnosis-header {
      text-align: center;
      margin: 8px 0 6px;
    }
    .department-name {
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: #444;
      margin-bottom: 2px;
    }
    .panel-name {
      font-size: 16pt;
      font-weight: 700;
      color: #111;
    }
    .diagnosis-table thead th {
      border-top: 2px solid #555;
      border-bottom: 2px solid #555;
      background: #fff;
      font-size: 11pt;
    }
    .diagnosis-table td {
      font-size: 12pt;
      border-left: none;
      border-right: none;
      border-top: none;
      border-bottom: none;
      padding: 4px 6px;
      background: #fff;
    }
    .diagnosis-table tbody tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .diagnosis-table .group-row td {
      padding-top: 8px;
      padding-bottom: 3px;
      background: #fff;
      font-weight: 700;
      text-decoration: underline;
    }
    .group-label {
      display: block;
      font-size: 12pt;
      margin-bottom: 4px;
    }
    .group-sublabel {
      display: block;
      font-size: 11pt;
      text-decoration: underline;
      margin-top: 4px;
    }
    .row-test-name {
      font-size: 12pt;
      font-weight: 700;
    }
    .result-cell { white-space: nowrap; }
    .xray-findings {
      font-size: 12pt;
      margin-top: 4px;
      line-height: 1.25;
    }
    @media print {
      .report-sheet { page-break-after: always; }
    }
  </style>
`;

const buildSingleReportHtml = (reportType, data) => {
  const body = reportType === "prescription"
    ? renderPrescriptionBody(data)
    : reportType === "diagnosis"
      ? renderDiagnosisBody(data)
      : renderXrayBody(data);

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${buildStyles()}
      </head>
      <body>
        <div class="report-frame-header">${buildHeaderTemplate(data)}</div>
        <div class="report-frame-footer">${buildFooterBars()}</div>
        ${body}
      </body>
    </html>`;
};

const buildSummaryHtml = (title, rows) => {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        ${buildStyles()}
        <style>
          .summary-shell { padding: 20px 12px 0; }
          .summary-title { font-size: 34px; font-weight: 700; margin: 28px 0 14px; }
          .summary-table { width: 100%; border-collapse: collapse; }
          .summary-table th, .summary-table td { border: 1px solid #dfe8f1; padding: 10px 12px; font-size: 14px; vertical-align: top; }
          .summary-table th { background: #f3f7fb; font-size: 13px; }
          .summary-table tr { break-inside: avoid; page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <section class="report-sheet">
          <div class="summary-shell">
            <div class="summary-title">${escapeHtml(title)}</div>
            <table class="summary-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Patient</th>
                  <th>Date</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(row.patient)}</td>
                    <td>${escapeHtml(row.dateTime)}</td>
                    <td>${escapeHtml(row.details)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      </body>
    </html>`;
};

const getBrowser = async () => {
  if (!puppeteer) {
    throw new Error("Puppeteer is not installed. Run npm install in the server workspace.");
  }

  if (!getBrowser.instance) {
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ].filter(Boolean);

    const executablePath = candidatePaths.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });

    getBrowser.instance = puppeteer.launch({
      headless: "new",
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
      ],
    });
  }

  return getBrowser.instance;
};

const closeBrowser = async () => {
  if (getBrowser.instance) {
    const browser = await getBrowser.instance;
    await browser.close();
    getBrowser.instance = null;
  }
};

const htmlToPdfBuffer = async (html, { footerTemplate = null, topMargin = "68mm", bottomMargin = "18mm" } = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: footerTemplate || buildFooterTemplate(),
    margin: {
      top: topMargin,
      bottom: bottomMargin,
      left: "12mm",
      right: "12mm",
    },
  });
  await page.close();
  return pdf;
};

const generateSingleReportPdf = async (reportType, record = {}, options = {}) => {
  const html = buildReportHtml(reportType, record);
  return htmlToPdfBuffer(html, {
    topMargin: options.topMargin || "0mm",
    bottomMargin: options.bottomMargin || "8mm",
  });
};

const buildReportHtml = (reportType, record = {}) => {
  const data =
    reportType === "prescription"
      ? buildPrescriptionData(record)
      : reportType === "diagnosis"
        ? buildDiagnosisData(record)
        : buildXrayData(record);
  return buildSingleReportHtml(reportType, data);
};

const generateSummaryPdf = async (reportType, records = [], options = {}) => {
  const rows = records.map((record) => {
    const data =
      reportType === "prescription"
        ? buildPrescriptionData(record)
        : reportType === "diagnosis"
          ? buildDiagnosisData(record)
          : buildXrayData(record);

    const details =
      reportType === "prescription"
        ? `${data.prescriptions.length} medicines`
        : reportType === "diagnosis"
          ? `${data.rows.filter((row) => row.type === "row").length} tests`
          : `${data.rows.length} x-rays`;

    return {
      patient: data.employeeName,
      dateTime: data.dateTime,
      details,
    };
  });

  const title =
    reportType === "prescription"
      ? "Prescription Reports"
      : reportType === "diagnosis"
        ? "Diagnosis Reports"
        : "X-ray Reports";

  const html = buildSummaryHtml(title, rows);
  return htmlToPdfBuffer(html, {
    topMargin: "38mm",
    bottomMargin: "22mm",
  });
};

const mergePdfBuffers = async (buffers = []) => {
  if (!PDFDocument) {
    throw new Error("pdf-lib is not installed. Run npm install in the server workspace.");
  }

  const docs = await Promise.all(
    buffers.map((buffer) => PDFDocument.load(buffer))
  );

  const merged = await PDFDocument.create();
  for (const doc of docs) {
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  return Buffer.from(await merged.save());
};

const generateCombinedReportPdf = async (reportType, records = [], options = {}) => {
  const recordList = Array.isArray(records) ? records : [];
  if (recordList.length === 0) {
    return generateSummaryPdf(reportType, [], options);
  }

  const pdfBuffers = [];
  for (const record of recordList) {
    pdfBuffers.push(await generateSingleReportPdf(reportType, record, options.singleReportOptions || {}));
  }

  return mergePdfBuffers(pdfBuffers);
};

module.exports = {
  generateSingleReportPdf,
  generateSummaryPdf,
  generateCombinedReportPdf,
  buildPrescriptionData,
  buildDiagnosisData,
  buildXrayData,
  isResultOutOfRange,
  parseReferenceInterval,
  buildReportHtml,
  buildSingleReportHtml,
  buildSummaryHtml,
  formatDateTime,
  closeBrowser,
};
