import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import PatientSelector from "../institutes/PatientSelector";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./InstitutesTheme.css";
import { fetchDiagnosticPanels } from "../../utils/masterData_clean";
import ReportHtmlPreview from "../common/ReportHtmlPreview";

const DiagnosisEntryForm = () => {
  const FALLBACK_PROFILE_IMAGE = "/profile-fallback.png";
  const [testsMaster, setTestsMaster] = useState([]);
  const [testCategories, setTestCategories] = useState([]);
  const [doctorDiagnosis, setDoctorDiagnosis] = useState([]);
  // const [searchTerm, setSearchTerm] = useState("");
  const [instituteName, setInstituteName] = useState("");
  const [loading, setLoading] = useState(false);
  const [visitId, setVisitId] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [diagnosticPanels, setDiagnosticPanels] = useState([]);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const navigate = useNavigate();
  const [selectedFamilyMember, setSelectedFamilyMember] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [pastRecords, setPastRecords] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState(null);
  const [tokenNumber, setTokenNumber] = useState(null);
  const [showDoctorNotes, setShowDoctorNotes] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [invalidTestIndexes, setInvalidTestIndexes] = useState([]);


  const [formData, setFormData] = useState({
    Institute_ID: "",
    Employee_ID: "",
    IsFamilyMember: false,
    FamilyMember_ID: "",
    Tests: [],
    Diagnosis_Notes: ""
  });

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const resolveProfileImageUrl = (photoPath) => {
    if (!photoPath) return FALLBACK_PROFILE_IMAGE;
    if (/^https?:\/\//i.test(photoPath)) return photoPath;
    const base = String(BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(photoPath).replace(/^\/+/, "")}`;
  };

  const testsByCategory = useMemo(() => {
    const grouped = {};
    (testsMaster || []).forEach((test) => {
      const group = String(test?.Group || "").trim();
      const testName = String(test?.Test_Name || "").trim();
      if (!group || !testName) return;
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push({
        _id: test._id,
        name: testName,
        reference: test.Reference_Range || "",
        unit: test.Units || ""
      });
    });

    Object.keys(grouped).forEach((group) => {
      const seen = new Set();
      grouped[group] = grouped[group]
        .filter((item) => {
          const key = String(item?.name || "").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    return grouped;
  }, [testsMaster]);

  const knownTestNameKeys = useMemo(
    () =>
      new Set(
        (testsMaster || [])
          .map((test) => String(test?.Test_Name || test?.Display_Name || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    [testsMaster]
  );

  const blockedTestCategoryKeys = useMemo(
    () =>
      new Set(
        ["Bilirubin - Direct", "Bilirubin - Indirect", "Bilirubin - Total"]
          .map((name) => String(name || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    []
  );

  const testCategoryOptions = useMemo(
    () =>
      Array.from(new Set([...(testCategories || []), ...Object.keys(testsByCategory || {})])).filter(
        (category) => {
          const key = String(category || "").trim().toLowerCase();
          return !knownTestNameKeys.has(key) && !blockedTestCategoryKeys.has(key);
        }
      ),
    [blockedTestCategoryKeys, knownTestNameKeys, testCategories, testsByCategory]
  );

  const formatDateDMY = (dateValue) => {
  if (!dateValue) return "—";

  const date = new Date(dateValue);
  if (isNaN(date)) return "—";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}-${month}-${year}`; // ✅ DD-MM-YYYY
};

const fetchDoctorDiagnosis = async (visitId) => {
  try {
    const res = await axios.get(
      `${BACKEND_URL}/diagnosis-api/visit/${visitId}/doctor`
    );

    setDoctorDiagnosis(res.data?.orders || []);

  } catch (err) {
    console.error("Failed to fetch doctor diagnosis", err);
    setDoctorDiagnosis([]);
  }
};

  useEffect(() => {
    const localInstituteId = localStorage.getItem("instituteId");
    if (localInstituteId) {
      setFormData((s) => ({ ...s, Institute_ID: localInstituteId }));
      fetchInstituteName(localInstituteId);
      fetchTests();
      loadDiagnosticPanels();
    } else {
      console.warn("No instituteId in localStorage");
    }
    // fetchEmployees();
  }, []);

  useEffect(() => {
    const onMasterUpdated = () => {
      fetchTests();
      loadDiagnosticPanels();
    };
    window.addEventListener("master-data-updated", onMasterUpdated);
    const onStorageUpdated = (event) => {
      if (event.key === "master-data-updated-at") {
        fetchTests();
        loadDiagnosticPanels();
      }
    };
    window.addEventListener("storage", onStorageUpdated);
    return () => {
      window.removeEventListener("master-data-updated", onMasterUpdated);
      window.removeEventListener("storage", onStorageUpdated);
    };
  }, []);

  const fetchInstituteName = async (id) => {
    try {
      const res = await axios.get(`${BACKEND_URL}/institute-api/institution/${id}`);
      setInstituteName(res.data?.Institute_Name || "");
    } catch (err) {
      console.error("Error fetching institute name:", err);
    }
  };
  const fetchTests = async () => {
  try {
    const instituteId = localStorage.getItem("instituteId") || "";
    const categoriesRes = await axios
      .get(`${BACKEND_URL}/master-data-api/categories`)
      .catch(() => ({ data: [] }));
    const testsCategory = (Array.isArray(categoriesRes.data) ? categoriesRes.data : []).find(
      (item) => String(item?.category_name || "").trim() === "Tests"
    );
    const testsCategoryValues = testsCategory?._id
      ? await axios
          .get(`${BACKEND_URL}/master-data-api/values`, {
            params: { categoryId: testsCategory._id, includeArchived: "false" }
          })
          .catch(() => ({ data: [] }))
      : { data: [] };

    const masterValues = Array.isArray(testsCategoryValues.data) ? testsCategoryValues.data : [];
    const categoryNames = new Map();
    const testsByCategoryMap = {};

    masterValues.forEach((item) => {
      const kind = String(item?.meta?.kind || "").trim();
      const valueName = String(item?.value_name || item?.name || "").trim();
      if (!valueName) return;

      if (kind === "category") {
        categoryNames.set(valueName.toLowerCase(), valueName);
        if (!testsByCategoryMap[valueName]) testsByCategoryMap[valueName] = [];
        return;
      }

      if (kind !== "test") return;
      const category = String(item?.meta?.category || "").trim();
      if (!category) return;
      if (!testsByCategoryMap[category]) testsByCategoryMap[category] = [];
      testsByCategoryMap[category].push({
        _id: item?._id,
        Test_Name: valueName,
        Group: category,
        Reference_Range: String(item?.meta?.reference || "").trim(),
        Units: String(item?.meta?.unit || "").trim(),
        Display_Name: valueName,
        Raw_Test_Name: valueName,
        meta: item?.meta || {}
      });
    });

    const mergedCategories = Array.from(
      new Set([
        ...Array.from(categoryNames.values()),
        ...Object.keys(testsByCategoryMap)
      ])
    );
    const mergedTestsByCategory = {};
    mergedCategories.forEach((category) => {
      const rows = Array.isArray(testsByCategoryMap[category]) ? testsByCategoryMap[category] : [];
      const seen = new Set();
      mergedTestsByCategory[category] = rows
        .filter((test) => {
          const key = String(test?.Test_Name || test?.name || "").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((test, idx) => ({
          _id: test?._id || test?.id || `master-${category}-${idx}`,
          Test_Name: String(test?.Test_Name || test?.name || "").trim(),
          Group: String(test?.Group || category || "").trim(),
          Reference_Range: String(test?.Reference_Range || test?.reference || "").trim(),
          Units: String(test?.Units || test?.unit || "").trim(),
          Display_Name: String(test?.Display_Name || test?.name || test?.Test_Name || "").trim(),
          Raw_Test_Name: String(test?.Raw_Test_Name || test?.name || test?.Test_Name || "").trim(),
          meta: test?.meta || {}
        }))
        .filter((test) => test.Group && test.Test_Name);
    });

    const normalizedTests = Object.entries(mergedTestsByCategory)
      .flatMap(([category, rows]) =>
        (Array.isArray(rows) ? rows : []).map((test, idx) => ({
          _id: test?._id || `master-${category}-${idx}`,
          Test_Name: String(test?.Test_Name || test?.name || "").trim(),
          Group: String(test?.Group || category || "").trim(),
          Reference_Range: String(test?.Reference_Range || test?.reference || "").trim(),
          Units: String(test?.Units || test?.unit || "").trim(),
          Display_Name: String(test?.Display_Name || test?.name || test?.Test_Name || "").trim(),
          Raw_Test_Name: String(test?.Raw_Test_Name || test?.name || test?.Test_Name || "").trim(),
          meta: test?.meta || {}
        }))
      )
      .filter((test) => test.Group && test.Test_Name);

    setTestsMaster(normalizedTests);
    console.log("Tests fetched:", normalizedTests.length);
    setTestCategories(mergedCategories);
  } catch (err) {
    console.error("Error fetching tests:", err);
  }
};

const loadDiagnosticPanels = async () => {
  try {
    const panels = await fetchDiagnosticPanels({ force: true, includeInactive: false });
    setDiagnosticPanels(Array.isArray(panels) ? panels : []);
  } catch (err) {
    console.error("Error fetching diagnostic panels:", err);
    setDiagnosticPanels([]);
  }
};

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const normalizeLooseText = (value) =>
  normalizeText(value).replace(/[^a-z0-9]+/g, "");
const getMasterAliases = (master = {}) => {
  const aliases = Array.isArray(master?.meta?.aliases) ? master.meta.aliases : [];
  return aliases.map((alias) => String(alias || "").trim()).filter(Boolean);
};
const normalizedEquals = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return Boolean(a) && Boolean(b) && a === b;
};
const normalizedLooseEquals = (left, right) => {
  const a = normalizeLooseText(left);
  const b = normalizeLooseText(right);
  return Boolean(a) && Boolean(b) && a === b;
};
const masterMatchesText = (master = {}, value) => {
  if (!value) return false;

  const candidates = [
    master?.Display_Name,
    master?.Raw_Test_Name,
    master?.Group,
    master?.Test_Name,
    ...getMasterAliases(master)
  ].filter(Boolean);

  return candidates.some(
    (candidate) =>
      normalizedEquals(candidate, value) || normalizedLooseEquals(candidate, value)
  );
};

const findMasterTest = (test = {}) =>
  testsMaster.find((master) => {
    const candidateIds = [
      test?.Test_ID?._id,
      test?.Test_ID,
      test?._id
    ]
      .filter(Boolean)
      .map(String);

    const matchesId =
      candidateIds.length > 0 && candidateIds.includes(String(master._id));

    const matchesName =
      masterMatchesText(master, test?.Test_Name) ||
      masterMatchesText(master, test?.Group);

    return matchesId || matchesName;
  }) || null;

const getCategoryForTestName = (testName) => {
  if (!testName) return "";

  const match = (testsMaster || []).find((item) =>
    masterMatchesText(item, testName)
  );

  return match?.Group || "";
};

const createFormTestFromDoctorTest = (test) => {
  const doctorTestId = test?.Test_ID?._id || test?.Test_ID || "";
  const master = findMasterTest(test);

  const resolvedTestName =
    test?.Test_Name ||
    test?.Test_ID?.Group ||
    test?.Test_ID?.Test_Name ||
    test?.Group ||
    master?.Display_Name ||
    master?.Group ||
    master?.Test_Name ||
    "";

  const category =
    getCategoryForTestName(resolvedTestName) || "";

  return {
    Category: category,
    Test_ID: master?._id || doctorTestId || "",
    Test_Name: resolvedTestName,
    Result_Value: "",
    Reference_Range:
      master?.Reference_Range ??
      test?.Reference_Range ??
      test?.Test_ID?.Reference_Range ??
      "",
    Units:
      master?.Units ??
      test?.Units ??
      test?.Test_ID?.Units ??
      "",
    ReportFile: null
  };
};

const hydrateTestWithMasterData = (test) => {
  const master = findMasterTest(test);

  if (!master) {
    return {
      ...test,
      Category:
        test?.Category ||
        getCategoryForTestName(test?.Test_Name || test?.Group || "")
    };
  }

  const resolvedTestName =
    test?.Test_Name ||
    test?.Group ||
    master.Display_Name ||
    master.Group ||
    master.Test_Name ||
    "";

  return {
    ...test,
    Category:
      test?.Category ||
      getCategoryForTestName(resolvedTestName) ||
      "",
    Test_ID: master._id || test?.Test_ID || "",
    Test_Name: resolvedTestName,
    Reference_Range:
      master.Reference_Range ??
      test?.Reference_Range ??
      test?.Test_ID?.Reference_Range ??
      "",
    Units:
      master.Units ??
      test?.Units ??
      test?.Test_ID?.Units ??
      ""
  };
};

useEffect(() => {
  if (!testsMaster.length) return;

  setFormData((prev) => ({
    ...prev,
    Tests: (prev.Tests || []).map((test) => hydrateTestWithMasterData(test))
  }));
}, [testsMaster]);

useEffect(() => {
  if (!testsMaster.length || !formData.Tests.length) return;

  const hydratedTests = formData.Tests.map((test) => hydrateTestWithMasterData(test));

  const hasChanges = hydratedTests.some((test, index) => {
    const current = formData.Tests[index];

    return (
      String(test.Test_ID || "") !== String(current?.Test_ID || "") ||
      (test.Test_Name || "") !== (current?.Test_Name || "") ||
      (test.Category || "") !== (current?.Category || "") ||
      (test.Reference_Range || "") !== (current?.Reference_Range || "") ||
      (test.Units || "") !== (current?.Units || "")
    );
  });

  if (!hasChanges) return;

  setFormData((prev) => ({
    ...prev,
    Tests: prev.Tests.map((test) => hydrateTestWithMasterData(test))
  }));
}, [testsMaster, formData.Tests]);

const mergeDoctorTestsIntoForm = (testsToAdd = []) => {
  if (!testsToAdd.length) return;

  setFormData((prev) => {
    const mappedTests = testsToAdd
      .map(createFormTestFromDoctorTest)
      .filter((test) => test.Test_Name);

    if (!mappedTests.length) return prev;

    const existingKeys = new Set(
      (prev.Tests || [])
        .filter((test) => test.Test_Name)
        .map((test) => `${test.Test_ID || ""}::${test.Test_Name}`)
    );

    const uniqueTests = mappedTests.filter((test) => {
      const key = `${test.Test_ID || ""}::${test.Test_Name}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (!uniqueTests.length) return prev;

    return {
      ...prev,
      Tests: [...prev.Tests, ...uniqueTests]
    };
  });
};

const createEmptyTest = () => ({
  Category: "",
  Test_ID: "",
  Test_Name: "",
  Result_Value: "",
  Reference_Range: "",
  Units: "",
  ReportFile: null
});

const mapPanelTestToFormRow = (panelTest = {}, panel = {}) => ({
  Category: String(panel?.category_name || panelTest?.category_name || panelTest?.Group || "").trim(),
  Test_ID: String(panelTest?.test_id || panelTest?._id || "").trim(),
  Test_Name: String(panelTest?.test_name || panelTest?.name || "").trim(),
  Result_Value: "",
  Reference_Range: String(panelTest?.reference || "").trim(),
  Units: String(panelTest?.unit || "").trim(),
  ReportFile: null
});

const buildPanelTestSignature = (panelTest = {}) => {
  const testId = String(panelTest?.test_id || panelTest?._id || "").trim().toLowerCase();
  const testName = String(panelTest?.test_name || panelTest?.name || "").trim().toLowerCase();
  return testId || testName;
};

const isDoctorDiagnosisPanel = (order = {}) => {
  const tests = Array.isArray(order?.tests) ? order.tests : [];
  if (!tests.length || !diagnosticPanels.length) return false;

  const orderSignatures = new Set(
    tests
      .map((test) => buildPanelTestSignature(test))
      .filter(Boolean)
  );

  if (!orderSignatures.size) return false;

  return diagnosticPanels.some((panel) => {
    const panelSignatures = (panel?.tests || [])
      .map((panelTest) => buildPanelTestSignature(panelTest))
      .filter(Boolean);

    if (!panelSignatures.length) return false;
    if (panelSignatures.length !== orderSignatures.size) return false;

    return panelSignatures.every((signature) => orderSignatures.has(signature));
  });
};

const expandSelectedPanel = (panelId) => {
  const panel = (diagnosticPanels || []).find((item) => String(item?._id || item?.id || "") === String(panelId || ""));

  if (!panel) {
    setSelectedPanelId("");
    setFormData((prev) => ({
      ...prev,
      Tests: [createEmptyTest()]
    }));
    return;
  }

  setSelectedPanelId(String(panel._id || panel.id || ""));
  setFormData((prev) => ({
    ...prev,
    Tests: (panel.tests || []).map((panelTest) => mapPanelTestToFormRow(panelTest, panel))
  }));
};

  const handleTestChange = (index, field, value) => {
  setSubmitError("");
  setInvalidTestIndexes((previous) => previous.filter((item) => item !== index));
  setFormData(prev => {

    const updated = [...prev.Tests];

    if (field === "Test_ID") {
      const sel = testsMaster.find(t => t._id === value);
      if (sel) {
          updated[index] = {
            ...updated[index],
            Test_ID: sel._id,
            Test_Name: sel.Display_Name || sel.Group || sel.Test_Name,
            Reference_Range: sel.Reference_Range || "",
            Units: sel.Units || "",
            ReportFile: updated[index].ReportFile || null
        };
      }
    } else if (field === "Category") {
      // set category and clear test selection when category changes
      updated[index] = {
        ...updated[index],
        Category: value,
        Test_ID: "",
        Test_Name: "",
        Reference_Range: "",
        Units: ""
      };
    } else if (field === "Test_Name") {
      const cat = updated[index].Category;
      const list = cat && testsByCategory[cat] ? testsByCategory[cat] : [];
      const found = list.find(x => normalizeText(x.name) === normalizeText(value));
      const master = findMasterTest({ ...updated[index], Test_Name: value, Group: value });

      if (found) {
        updated[index] = {
          ...updated[index],
          Test_ID: master?._id || found._id || updated[index].Test_ID || "",
          Test_Name: found.name,
          Reference_Range:
            master?.Reference_Range || found.reference || updated[index].Reference_Range || "",
          Units:
            master?.Units || found.unit || updated[index].Units || ""
        };
      } else {
        updated[index] = {
          ...updated[index],
          Test_ID: master?._id || updated[index].Test_ID || "",
          Test_Name: value,
          Reference_Range: master?.Reference_Range || updated[index].Reference_Range || "",
          Units: master?.Units || updated[index].Units || ""
        };
      }
    } else {
      updated[index] = {
        ...updated[index],
        [field]: value
      };
    }

    return {
      ...prev,
      Tests: updated
    };

  });
};

const addTest = () =>
  setFormData(prev => ({
    ...prev,
    Tests: [
      ...prev.Tests,
      createEmptyTest()
    ]
  }));
  
  const removeTest = (i) => setFormData(prev => ({ 
    ...prev, 
    Tests: prev.Tests.filter((_, idx) => idx !== i) 
  }));

  const handleSubmit = async (e) => {

  e.preventDefault();
  setSubmitError("");
  setInvalidTestIndexes([]);

  if (!formData.Employee_ID) {
    alert("Please select a patient first");
    return;
  }

  if (formData.IsFamilyMember && !formData.FamilyMember_ID) {
    alert("Please select a family member");
    return;
  }

  if (!formData.Tests.length) {
    setSubmitError("Add at least one diagnostic test before saving.");
    return;
  }

  const incompleteTests = formData.Tests
    .map((test, index) => ({ test, index }))
    .filter(({ test }) =>
      !String(test?.Test_Name || "").trim() ||
      !String(test?.Result_Value || "").trim()
    );
  const missingResults = incompleteTests.filter(({ test }) =>
    String(test?.Test_Name || "").trim() && !String(test?.Result_Value || "").trim()
  );
  const missingTestNames = missingResults.map(({ test }) => String(test.Test_Name).trim());
  const missingSelections = incompleteTests.filter(({ test }) => !String(test?.Test_Name || "").trim());

  if (incompleteTests.length) {
    setInvalidTestIndexes(incompleteTests.map(({ index }) => index));
    const messages = [];
    if (missingResults.length) {
      messages.push(`${missingResults.length} test${missingResults.length === 1 ? " is" : "s are"} missing results: ${missingTestNames.join(", ")}.`);
    }
    if (missingSelections.length) {
      messages.push(`Select a test for row${missingSelections.length === 1 ? "" : "s"} ${missingSelections.map(({ index }) => index + 1).join(", ")}.`);
    }
    setSubmitError(messages.join(" "));
    return;
  }

  const fd = new FormData();

  fd.append("Institute_ID", formData.Institute_ID);
  fd.append("Employee_ID", formData.Employee_ID);
  fd.append("IsFamilyMember", formData.IsFamilyMember);
  fd.append("FamilyMember_ID", formData.FamilyMember_ID || "");
  fd.append("Diagnosis_Notes", formData.Diagnosis_Notes || "");
  fd.append("visit_id", visitId || "");

  const normalizedTests = formData.Tests.map((test) => ({
    ...test,
    test_id: test?.test_id || test?.Test_ID || "",
    test_name: test?.test_name || test?.Test_Name || ""
  }));

  fd.append("Tests", JSON.stringify(normalizedTests));

  formData.Tests.forEach((t) => {

    if (t.ReportFile) {
      fd.append("reports", t.ReportFile);
    }

  });

  try {

    await axios.post(
      `${BACKEND_URL}/diagnosis-api/add`,
      fd,
      {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      }
    );

    await fetchPastRecords();
    alert("✅ Diagnosis record saved successfully");

  } catch (err) {

    console.error(err);
    const message = err?.response?.data?.error || err?.response?.data?.message || "Failed to save diagnosis.";
    setSubmitError(message);

  }

};
  const handlePrint = () => {
    const section = document.getElementById("diagnosis-print-section");
    if (!section) return;

    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Diagnosis / Lab Test Entry</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ddd; padding: 8px; }
            button { display: none !important; }
          </style>
        </head>
        <body>${section.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

const filteredDoctorDiagnosis = (doctorDiagnosis || []).filter((order) => {
  if (!formData.IsFamilyMember) {
    return order.isFamilyMember === false;
  }

  return (
    order.isFamilyMember === true &&
    String(order.familyMemberId || "") === String(formData.FamilyMember_ID || "")
  );
});

const fetchVisitDetails = async (visitId) => {
  const res = await axios.get(
    `${BACKEND_URL}/visit-api/visit/${visitId}`
  );
  return res.data;
};
const fetchPastRecords = async () => {
  if (!formData.Employee_ID) return;

  try {
    const res = await axios.get(
      `${BACKEND_URL}/diagnosis-api/records/${formData.Employee_ID}?isFamily=${formData.IsFamilyMember}&familyId=${formData.FamilyMember_ID}`
    );
    console.log("Diagnosis Records:", res.data); 

    setPastRecords(res.data || []);
    setSelectedHistoryRecord(res.data?.[0] || null);
    setShowHistory(true);   // 👈 open modal
  } catch (err) {
    console.error("Error fetching past records:", err);
  }
};


  return (
   
       <div className="container-fluid mt-2 institutes-theme">
      {/* Back Button */}
      <button
        className="btn mb-3"
        onClick={() => navigate(-1)}
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #D6E0F0",
          borderRadius: "8px",
          padding: "6px 14px",
          fontSize: "14px",
          color: "#1F2933",
        }}
      >
        ← Back
      </button>
      <div className="row justify-content-center">
        {/* ================= HISTORY PANEL ================= */}
        {showHistory && (
          <div className="col-lg-4 mb-3">
            <div className="card shadow border-0 h-100">
              <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <strong>📊 Test History</strong>
                <button
                  className="btn btn-sm btn-light"
                  onClick={() => setShowHistory(false)}
                >
                  ✕
                </button>
              </div>
              <div
                className="card-body"
                style={{ maxHeight: "70vh", overflowY: "auto" }}
              >
                {!pastRecords || pastRecords.length === 0 ? (
                  <div className="text-muted text-center py-4">
                    📭 No previous records found.
                  </div>
                ) : (
                  <>
                    <div className="d-flex flex-wrap gap-2 mb-3">
                      {pastRecords.map((record, index) => (
                        <button
                          key={record._id || index}
                          type="button"
                          className={`btn btn-sm ${selectedHistoryRecord?._id === record?._id ? "btn-primary" : "btn-outline-primary"}`}
                          onClick={() => setSelectedHistoryRecord(record)}
                        >
                          {record?.createdAt ? formatDateDMY(record.createdAt) : `Report ${index + 1}`}
                        </button>
                      ))}
                    </div>
                    <ReportHtmlPreview
                      modulePath="diagnosis-api"
                      report={selectedHistoryRecord}
                      title="Diagnosis test history report"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= FORM ================= */}
        <div
          className={`mb-3 ${showHistory ? "col-lg-8" : "col-lg-10"}`}
          style={{ transition: "all 0.4s ease" }}
        >
          <div className="card shadow border-0">
            <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">🏥 Diagnosis / Lab Test Entry</h5>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handlePrint}
              >
                🖨️ Print
              </button>
            </div>

            <div className="card-body">
              <form onSubmit={handleSubmit}>
                {submitError && (
                  <div className="alert alert-danger" role="alert">
                    <strong>Cannot save diagnosis.</strong> {submitError}
                  </div>
                )}
                {/* Institute */}
                <div className="mb-4">
                  <label className="form-label fw-semibold">🏥 Institute</label>
                  <input
                    className="form-control"
                    value={instituteName || "Loading..."}
                    readOnly
                  />
                </div>

                {/* Patient Selector */}
                <div className="mb-4">
                  <PatientSelector
                    instituteId={formData.Institute_ID}
                    onlyDiagnosisQueue={true}
                    onSelect={({ employee, visit }) => {
                      console.log("VISIT OBJECT:", visit);

                      const vId = visit?._id || null;
                      const token = visit?.token_no || visit?.Token_Number || null;
                      setVisitId(vId);
                      setTokenNumber(token);

                      setSelectedFamilyMember(
                        visit?.IsFamilyMember ? visit.FamilyMember : null
                      );

                      setSelectedEmployee(employee);

                      setFormData(prev => ({
                        ...prev,
                        Employee_ID: employee._id,
                        IsFamilyMember: Boolean(visit?.IsFamilyMember),
                        FamilyMember_ID: visit?.IsFamilyMember
                          ? visit.FamilyMember?._id
                          : "",
                        Panel_ID: "",
                        Tests: [],
                        Diagnosis_Notes: ""
                      }));
                      setSelectedPanelId("");

                      // 🔥 THIS IS THE IMPORTANT PART
                      if (vId) {
                        fetchDoctorDiagnosis(vId);
                      } else {
                        setDoctorDiagnosis([]);
                      }
                    }}
                  />
                </div>

                {/* Selected Patient Info
                {selectedEmployee && (
                  <div className="alert alert-info mb-4">
                    <div className="d-flex gap-3 align-items-start">
                      <img
                        src={resolveProfileImageUrl(
                          formData.IsFamilyMember
                            ? selectedFamilyMember?.Photo
                            : selectedEmployee?.Photo
                        )}
                        alt="Patient"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = FALLBACK_PROFILE_IMAGE;
                        }}
                        style={{
                          width: "120px",
                          height: "120px",
                          borderRadius: "12px",
                          objectFit: "cover",
                          objectPosition: "center",
                          border: "1px solid rgba(191,219,254,0.9)",
                          boxShadow: "0 8px 18px rgba(15,23,42,0.12)",
                          background: "rgba(255,255,255,0.92)",
                          flexShrink: 0
                        }}
                      />
                      <div className="w-100">
                        <div className="row">
                      <div className="col-md-6">
                        <strong>👨 Employee:</strong> {selectedEmployee.Name}
                      </div>
                      <div className="col-md-3">
                        <strong>ID:</strong> {selectedEmployee.ABS_NO}
                      </div>
                      {tokenNumber && (
                        <div className="col-md-3">
                          <strong>🎫 Token:</strong> {tokenNumber}
                        </div>
                      )}
                    </div>
                    {formData.IsFamilyMember && selectedFamilyMember && (
                      <div className="row mt-2">
                        <div className="col-md-6">
                          <strong>👨‍👩‍👧 Family Member:</strong> {selectedFamilyMember.Name}
                        </div>
                        <div className="col-md-6">
                          <strong>Relation:</strong> {selectedFamilyMember.Relationship}
                        </div>
                      </div>
                    )}
                        </div>
                      </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={fetchPastRecords}
                      >
                        📄 View History
                      </button>
                    </div>
                  </div>
                )} */}
                {selectedEmployee && (
  <div
    className="mb-4 p-3"
    style={{
      borderRadius: "16px",
      background: "linear-gradient(135deg, #e0f2fe, #f8fafc)",
      border: "1px solid #bfdbfe",
      boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
    }}
  >
    <div className="d-flex gap-4 align-items-center">
      
      {/* Profile Image */}
      <img
        src={resolveProfileImageUrl(
          formData.IsFamilyMember
            ? selectedFamilyMember?.Photo
            : selectedEmployee?.Photo
        )}
        alt="Patient"
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = FALLBACK_PROFILE_IMAGE;
        }}
        style={{
          width: "110px",
          height: "110px",
          borderRadius: "14px",
          objectFit: "cover",
          border: "2px solid #93c5fd",
          boxShadow: "0 6px 14px rgba(0,0,0,0.1)",
        }}
      />

      {/* Info Section */}
      <div className="flex-grow-1">
        
        {/* Top Row */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0 fw-semibold">
            {selectedEmployee.Name}
          </h5>

          {tokenNumber && (
            <span
              style={{
                background: "#2563eb",
                color: "white",
                padding: "4px 10px",
                borderRadius: "999px",
                fontSize: "0.85rem",
                fontWeight: "500",
              }}
            >
              Token : {tokenNumber}
            </span>
          )}
        </div>

        {/* Details */}
        <div className="text-muted small mb-2">
          <span className="me-3">
            <strong>ID:</strong> {selectedEmployee.ABS_NO}
          </span>
        </div>

        {/* Family Member */}
        {formData.IsFamilyMember && selectedFamilyMember && (
          <div
            style={{
              background: "#f1f5f9",
              padding: "8px 12px",
              borderRadius: "10px",
              fontSize: "0.9rem",
              marginTop: "6px",
            }}
          >
            👨‍👩‍👧 <strong>{selectedFamilyMember.Name}</strong>  
            <span className="ms-2 text-muted">
              ({selectedFamilyMember.Relationship})
            </span>
          </div>
        )}

        {/* Button */}
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-sm"
            onClick={fetchPastRecords}
            style={{
              background: "#2563eb",
              color: "white",
              borderRadius: "8px",
              padding: "6px 14px",
              fontWeight: "500",
            }}
          >
            📄 View History
          </button>
        </div>

      </div>
    </div>
  </div>
)}

                {/* Doctor Diagnosis Reference */}
                {filteredDoctorDiagnosis.length > 0 && (
                  <div className="alert alert-warning mb-4">
                    <h6 className="alert-heading">👨‍⚕️ Doctor Diagnosis (Reference)</h6>
                    {(() => {
                      const bulkLabel = filteredDoctorDiagnosis.some(isDoctorDiagnosisPanel)
                        ? "➕ Add Panel Below"
                        : "➕ Add All Prescribed Tests Below";

                      return (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary mb-3"
                          onClick={() =>
                            mergeDoctorTestsIntoForm(
                              filteredDoctorDiagnosis.flatMap((order) => order.tests || [])
                            )
                          }
                        >
                          {bulkLabel}
                        </button>
                      );
                    })()}

                    {filteredDoctorDiagnosis.map((d, i) => (
                      <div key={i} className="mt-2">

                        <ul className="mb-2">
                          {(d.tests || []).map((t, idx) => (
                            <li
                              key={idx}
                              className="d-flex justify-content-between align-items-center gap-2"
                            >
                              <span>{t.Test_Name}</span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => mergeDoctorTestsIntoForm([t])}
                              >
                                Add Test
                              </button>
                            </li>
                          ))}
                        </ul>

                        {d.notes && (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-info"
                              onClick={() => setShowDoctorNotes(prev => ({ ...prev, [i]: !prev[i] }))}
                            >
                              {showDoctorNotes[i] ? "Hide Doctor Notes" : "Show Doctor Notes"}
                            </button>
                            {showDoctorNotes[i] && (
                              <div className="small text-muted mt-2">
                                Notes: {d.notes}
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    ))}
                  </div>
                )}

                {/* Tests Section */}
                <div className="mb-4">
                  <h6 className="fw-bold text-dark mb-3 border-bottom pb-2">
                    🧪 Tests
                  </h6>

                  <div className="row g-2 mb-3">
                    <div className="col-md-12">
                      <label className="form-label fw-semibold">Select Panel</label>
                      <select
                        className="form-select"
                        value={selectedPanelId}
                        onChange={(e) => {
                          const nextPanelId = e.target.value;
                          if (!nextPanelId) {
                            setSelectedPanelId("");
                            setFormData((prev) => ({
                              ...prev,
                              Tests: [createEmptyTest()]
                            }));
                            return;
                          }
                          expandSelectedPanel(nextPanelId);
                        }}
                      >
                        <option value="">No panel selected</option>
                        {(diagnosticPanels || []).map((panel) => (
                          <option key={panel._id || panel.id} value={panel._id || panel.id}>
                            {panel.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedPanelId ? (
                    <div className="border rounded p-3 bg-light mb-3">
                      <div className="fw-semibold mb-2">Panel tests will be stored as individual tests</div>
                      {(formData.Tests || []).map((test, index) => (
                        <div key={`${test.Test_ID || test.Test_Name || index}`} className="small py-1">
                          {index + 1}. {test.Test_Name}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {testsMaster.length === 0 ? (
                    <div className="alert alert-warning">
                      <strong>⚠️ No tests available</strong>
                      <div className="small mt-1">
                        Add tests to the master list first.
                      </div>
                    </div>
                  ) : (
                    <>
                      {formData.Tests.length === 0 && (
                        <div className="alert alert-secondary">
                          No tests added yet. Use <strong>Add Another Test</strong> or import the doctor's prescribed tests above.
                        </div>
                      )}

                      {formData.Tests.map((t, i) => (
                        <div
                          key={i}
                          className="border rounded p-3 mb-3 bg-light"
                        >
                          <div className="d-flex justify-content-between align-items-center mb-3">
                            <h6 className="mb-0">Test #{i + 1}</h6>
                            {formData.Tests.length > 1 && !selectedPanelId && (
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => removeTest(i)}
                              >
                                🗑️ Remove
                              </button>
                            )}
                          </div>

                          <div className="row g-3">
                            <div className="col-md-6">
                                <label className="form-label fw-semibold">Category</label>
                                <select
                                  className="form-select"
                                  value={t.Category || ""}
                                  disabled={Boolean(selectedPanelId)}
                                  onChange={e => handleTestChange(i, "Category", e.target.value)}
                                >
                                  <option value="">Select Category</option>
                                  {testCategoryOptions.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                  ))}
                                </select>
                            </div>

                            <div className="col-md-6">
                              <label className="form-label fw-semibold">Test Name</label>
                                {(() => {
                                  const categoryOptions =
                                    t.Category && testsByCategory[t.Category]
                                      ? testsByCategory[t.Category]
                                      : [];
                                  const hasSelectedOption = categoryOptions.some(
                                    (testObj) =>
                                      normalizeText(testObj.name) === normalizeText(t.Test_Name)
                                  );

                                  return (
                                <select
                                  className="form-select"
                                  value={t.Test_ID || t.Test_Name || ""}
                                  onChange={e => handleTestChange(i, "Test_ID", e.target.value)}
                                  disabled={Boolean(selectedPanelId) || (!t.Category && !t.Test_Name)}
                                >
                                  <option value="">Select Test</option>
                                  {t.Test_Name && !hasSelectedOption && (
                                    <option value={t.Test_Name}>{t.Test_Name}</option>
                                  )}
                                  {(
                                    categoryOptions
                                  ).map(testObj => (
                                    <option key={testObj._id || testObj.name} value={testObj._id || testObj.name}>{testObj.name}</option>
                                  ))}
                                </select>
                                  );
                                })()}
                            </div>

                            <div className="col-md-6">
                              <label className="form-label fw-semibold">Result</label>
                              <input
                                type="text"
                                className={`form-control${invalidTestIndexes.includes(i) && !String(t.Result_Value || "").trim() ? " is-invalid" : ""}`}
                                aria-invalid={invalidTestIndexes.includes(i) && !String(t.Result_Value || "").trim()}
                                placeholder="Result (e.g., 14.2)"
                                value={t.Result_Value}
                                onChange={e => handleTestChange(i, "Result_Value", e.target.value)}
                              />
                            </div>

                            <div className="col-md-3">
                              <label className="form-label fw-semibold">Reference Range</label>
                              <input
                                type="text"
                                className="form-control"
                                placeholder="Ref Range"
                                value={t.Reference_Range}
                                onChange={e => handleTestChange(i, "Reference_Range", e.target.value)}
                              />
                            </div>

                            <div className="col-md-3">
                              <label className="form-label fw-semibold">Units</label>
                              <input
                                type="text"
                                className="form-control"
                                placeholder="Units"
                                value={t.Units}
                                onChange={e => handleTestChange(i, "Units", e.target.value)}
                              />
                            </div>
                            <div className="col-md-12">
                              <label className="form-label fw-semibold">
                                Upload Report
                              </label>
                              <input
                                type="file"
                                className="form-control"
                                onChange={(e)=>
                                  handleTestChange(
                                    i,
                                    "ReportFile",
                                    e.target.files[0]
                                  )
                                }
                              />
                            </div>
                          </div>


                          {(t.Reference_Range || t.Units) && (
                            <div className="mt-2 p-2 bg-info bg-opacity-10 rounded small">
                              {t.Reference_Range && <span><strong>Ref Range:</strong> {t.Reference_Range} </span>}
                              {t.Units && <span><strong>Units:</strong> {t.Units}</span>}
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        className="btn btn-outline-success me-2"
                        onClick={addTest}
                        disabled={Boolean(selectedPanelId)}
                      >
                        ➕ Add Another Test
                      </button>
                    </>
                  )}
                </div>

                {/* Diagnosis Notes */}
                <div className="mb-4">
                  <label className="form-label fw-semibold">📝 Diagnosis Notes</label>
                  <textarea
                    className="form-control"
                    rows={4}
                    placeholder="Enter diagnosis notes, observations, or comments..."
                    value={formData.Diagnosis_Notes}
                    onChange={e => setFormData(prev => ({ ...prev, Diagnosis_Notes: e.target.value }))}
                  />
                </div>

                {/* Submit Button */}
                <div className="text-center">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg px-5"
                  >
                    💾 Save Diagnosis Record
                  </button>
                </div>
              </form>

              {/* Hidden Print Section */}
              <div id="diagnosis-print-section" style={{ display: "none" }}>
                <h2 style={{ textAlign: "center", marginBottom: "20px" }}>
                  🏥 Diagnosis / Lab Test Entry Report
                </h2>
                
                <div style={{ marginBottom: "20px", borderBottom: "1px solid #ddd", paddingBottom: "15px" }}>
                  <h4>Institute Information</h4>
                  <p><strong>Institute Name:</strong> {instituteName || "N/A"}</p>
                </div>

                {selectedEmployee && (
                  <div style={{ marginBottom: "20px", borderBottom: "1px solid #ddd", paddingBottom: "15px" }}>
                    <h4>Patient Information</h4>
                    <p><strong>Employee Name:</strong> {selectedEmployee.Name || "N/A"}</p>
                    <p><strong>ABS No:</strong> {selectedEmployee.ABS_NO || "N/A"}</p>
                    {tokenNumber && <p><strong>Token Number:</strong> {tokenNumber}</p>}
                    {formData.IsFamilyMember && selectedFamilyMember && (
                      <>
                        <p><strong>Family Member:</strong> {selectedFamilyMember.Name || "N/A"}</p>
                        <p><strong>Relationship:</strong> {selectedFamilyMember.Relationship || "N/A"}</p>
                      </>
                    )}
                  </div>
                )}

                {formData.Tests.length > 0 && (
                  <div style={{ marginBottom: "20px", borderBottom: "1px solid #ddd", paddingBottom: "15px" }}>
                    <h4>Tests</h4>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "15px" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f0f0f0", borderBottom: "2px solid #333" }}>
                          <th style={{ padding: "10px", textAlign: "left", border: "1px solid #ddd" }}>Test Name</th>
                          <th style={{ padding: "10px", textAlign: "left", border: "1px solid #ddd" }}>Result</th>
                          <th style={{ padding: "10px", textAlign: "left", border: "1px solid #ddd" }}>Reference Range</th>
                          <th style={{ padding: "10px", textAlign: "left", border: "1px solid #ddd" }}>Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.Tests.map((t, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                            <td style={{ padding: "10px", border: "1px solid #ddd" }}>{t.Test_Name || "N/A"}</td>
                            <td style={{ padding: "10px", border: "1px solid #ddd" }}>{t.Result_Value || "N/A"}</td>
                            <td style={{ padding: "10px", border: "1px solid #ddd" }}>{t.Reference_Range || "N/A"}</td>
                            <td style={{ padding: "10px", border: "1px solid #ddd" }}>{t.Units || "N/A"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {formData.Diagnosis_Notes && (
                  <div style={{ marginBottom: "20px" }}>
                    <h4>Diagnosis Notes</h4>
                    <p style={{ whiteSpace: "pre-wrap" }}>{formData.Diagnosis_Notes}</p>
                  </div>
                )}

                <div style={{ marginTop: "30px", textAlign: "center", color: "#666", fontSize: "12px" }}>
                  <p>Generated on: {new Date().toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosisEntryForm;
