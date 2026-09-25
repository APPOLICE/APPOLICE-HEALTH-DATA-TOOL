const jwt = require("../server/node_modules/jsonwebtoken");

const BACKEND_URL = "http://127.0.0.1:6100";
const JWT_SECRET = "institutesecret123";

const diagnosisFixture = {
  instituteId: "69982a0c26d4c4f00d2240f3",
  employeeId: "69d4931434daf9900a22d88a",
  testId: "69de8a6067c592599744a4cb",
  testName: "Total Cholesterol",
  group: "LIPID PROFILE",
  reference: "<200",
  units: "mg/dL",
};

const xrayFixture = {
  instituteId: "69982a0c26d4c4f00d2240f3",
  employeeId: "69ad18e59ddb4c19fee910c5",
  xrayId: "69ea4f54d8988853b0fa5b6f",
  xrayType: "Lumbar Spine X-ray - AP view",
  bodyPart: "Lumbar Spine",
};

const tokenFor = (instituteId, role) =>
  jwt.sign({ instituteId, role }, JWT_SECRET, { expiresIn: "1h" });

const postMultipart = async (url, formData, token) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`${url} failed ${response.status}: ${text}`);
  }

  return data;
};

const saveDiagnosis = async () => {
  const marker = `codex-diagnosis-${Date.now()}`;
  const formData = new FormData();
  formData.append("Institute_ID", diagnosisFixture.instituteId);
  formData.append("Employee_ID", diagnosisFixture.employeeId);
  formData.append("IsFamilyMember", "false");
  formData.append("FamilyMember_ID", "");
  formData.append("Diagnosis_Notes", marker);
  formData.append("visit_id", "");
  formData.append(
    "Tests",
    JSON.stringify([
      {
        Test_ID: diagnosisFixture.testId,
        Test_Name: diagnosisFixture.testName,
        Group: diagnosisFixture.group,
        Result_Value: marker,
        Reference_Range: diagnosisFixture.reference,
        Units: diagnosisFixture.units,
        Remarks: marker,
      },
    ])
  );

  await postMultipart(
    `${BACKEND_URL}/diagnosis-api/add`,
    formData,
    tokenFor(diagnosisFixture.instituteId, "diagnosis")
  );

  const historyResponse = await fetch(
    `${BACKEND_URL}/diagnosis-api/records/${diagnosisFixture.employeeId}?isFamily=false&familyId=`
  );
  const history = await historyResponse.json();
  const found = history.some((record) =>
    (record.Tests || []).some(
      (test) => test.Result_Value === marker || test.Remarks === marker
    )
  );

  return { marker, found, rows: history.length };
};

const saveXray = async () => {
  const marker = `codex-xray-${Date.now()}`;
  const formData = new FormData();
  formData.append("Institute_ID", xrayFixture.instituteId);
  formData.append("Employee_ID", xrayFixture.employeeId);
  formData.append("IsFamilyMember", "false");
  formData.append("FamilyMember_ID", "");
  formData.append("Xray_Notes", marker);
  formData.append(
    "Xrays",
    JSON.stringify([
      {
        Xray_ID: xrayFixture.xrayId,
        Xray_Type: xrayFixture.xrayType,
        Body_Part: xrayFixture.bodyPart,
        Side: "NA",
        View: "AP",
        Film_Size: "10X8",
        Findings: marker,
        Impression: marker,
        Remarks: marker,
      },
    ])
  );

  await postMultipart(
    `${BACKEND_URL}/xray-api/add`,
    formData,
    tokenFor(xrayFixture.instituteId, "xray")
  );

  const historyResponse = await fetch(
    `${BACKEND_URL}/xray-api/records/${xrayFixture.employeeId}?isFamily=false&familyId=`
  );
  const history = await historyResponse.json();
  const found = history.some((record) =>
    (record.Xrays || []).some(
      (xray) =>
        xray.Findings === marker ||
        xray.Impression === marker ||
        xray.Remarks === marker
    )
  );

  return { marker, found, rows: history.length };
};

(async () => {
  const diagnosis = await saveDiagnosis();
  const xray = await saveXray();

  if (!diagnosis.found || !xray.found) {
    throw new Error(`History verification failed: ${JSON.stringify({ diagnosis, xray })}`);
  }

  console.log(JSON.stringify({ diagnosis, xray }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
