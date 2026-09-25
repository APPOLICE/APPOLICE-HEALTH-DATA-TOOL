import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import PatientSelector from "../institutes/PatientSelector";
import { useNavigate } from "react-router-dom";
import { fetchMasterDataMap, fetchDiagnosticPanels, getMasterMedicineEntries, getMasterOptions } from "../../utils/masterData_clean";
import { mergeXrayTypes } from "../../data/xrayTypes";
import { buildReportDownloadUrl, downloadPdfBlob } from "../../utils/pdfDownload";
import ReportHtmlPreview from "../common/ReportHtmlPreview";
import "./InstitutesTheme.css";

const DoctorPrescriptionForm = () => {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 5200}`;
  const FALLBACK_PROFILE_IMAGE = "/profile-fallback.png";

  const resolveUrl = (u) => {
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    const base = (BACKEND_URL || '').replace(/\/$/, '');
    return `${base}/${String(u).replace(/^\/+/, '')}`;
  };
  const resolveProfileImageUrl = (photoPath) => {
    if (!photoPath) return FALLBACK_PROFILE_IMAGE;
    if (/^https?:\/\//i.test(photoPath)) return photoPath;
    const base = (BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(photoPath).replace(/^\/+/, "")}`;
  };
  const navigate = useNavigate();
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [lastTwoVisits, setLastTwoVisits] = useState([]);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [instituteName, setInstituteName] = useState("");
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [diseases, setDiseases] = useState([]);
  const [visitId, setVisitId] = useState(null);
  const [testsMaster, setTestsMaster] = useState([]);
  const [testCategories, setTestCategories] = useState([]);
  const [diagnosticPanels, setDiagnosticPanels] = useState([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [diagnosisData, setDiagnosisData] = useState({
    Tests: [{ Category: "", Test_ID: "", Test_Name: "" }]
  });
  const [employeeReport, setEmployeeReport] = useState(null);
  const [showReports, setShowReports] = useState(false);
  const [selectedDiagnosisReport, setSelectedDiagnosisReport] = useState(null);
  const [selectedXrayReport, setSelectedXrayReport] = useState(null); // { record, xray }
  const [selectedPrescriptionReport, setSelectedPrescriptionReport] = useState(null);
  const [prescriptionSuccessMessage, setPrescriptionSuccessMessage] = useState("");
  const [prescriptionErrorMessage, setPrescriptionErrorMessage] = useState("");
  const [isSubmittingPrescription, setIsSubmittingPrescription] = useState(false);
  const [inventoryMedicines, setInventoryMedicines] = useState([]);
  const [medicineStrengths, setMedicineStrengths] = useState({});
  const notesTextareaRef = useRef(null);
  const [xrayMaster, setXrayMaster] = useState([]);
  const [xrayBodyParts, setXrayBodyParts] = useState([]);
  const [xrayData, setXrayData] = useState({
    Xrays: [{ Body_Part: "", Xray_ID: "", Xray_Type: "" }]
  });
  const [downloadingXrayId, setDownloadingXrayId] = useState("");
  const [downloadingDiagnosisId, setDownloadingDiagnosisId] = useState("");
  const [downloadingPrescriptionId, setDownloadingPrescriptionId] = useState("");

  const [diseaseSearch, setDiseaseSearch] = useState("");
  const [filteredDiseases, setFilteredDiseases] = useState([]);
  const [showDiseaseDropdown, setShowDiseaseDropdown] = useState(false); // Track if field is focused

  const [diseaseMaster, setDiseaseMaster] = useState([]);
  const [cdDiseases, setCdDiseases] = useState([]);
  const [ncdDiseases, setNcdDiseases] = useState([]);
  const [masterMap, setMasterMap] = useState({});
  const [selectedType, setSelectedType] = useState("");
  const [selectedSubgroup, setSelectedSubgroup] = useState("");
  const [patientSelectorKey, setPatientSelectorKey] = useState(0); // For resetting PatientSelector

  const getXrayDownloadId = (report = {}) => {
    const record = report?.record || (report?.Xrays ? report : {});
    const xray = report?.xray || null;
    return String(
      record?._id ||
      record?.visit_id ||
      record?.visitId ||
      xray?._id ||
      xray?.Xray_ID ||
      "download"
    );
  };

  const getDiagnosisDownloadId = (report = {}) => {
    const record = report?.record || (report?.Tests ? report : {});
    const test = report?.test || null;
    return String(
      test?._id ||
      test?.Test_ID?._id ||
      test?.Test_ID ||
      record?._id ||
      record?.visit_id ||
      record?.visitId ||
      "download"
    );
  };

  const getPrescriptionDownloadId = (record = {}) =>
    String(record?._id || record?.visit_id || record?.visitId || "download");

  const isXrayImageFile = (file = {}) => {
    const mime = String(file?.mimetype || file?.mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const url = String(file?.url || file?.path || "");
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url);
  };

  const getXrayImageUrl = (report = {}) => {
    const record = report?.record || (report?.Xrays ? report : {});
    const xray = report?.xray || null;
    const xrays = xray ? [xray] : Array.isArray(record?.Xrays) ? record.Xrays : [];

    for (const item of xrays) {
      const files = Array.isArray(item?.Reports) ? item.Reports : [];
      for (const file of files) {
        if (!isXrayImageFile(file)) continue;
        const url = resolveUrl(file?.url || file?.path || "");
        if (url) return url;
      }
    }

    return "";
  };

  const isDiagnosisImageFile = (file = {}) => {
    const mime = String(file?.mimetype || file?.mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const url = String(file?.url || file?.path || "");
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url);
  };

  const getDiagnosisImageUrl = (report = {}) => {
    const record = report?.record || (report?.Tests ? report : {});
    const test = report?.test || null;
    const tests = test ? [test] : Array.isArray(record?.Tests) ? record.Tests : [];

    for (const item of tests) {
      const files = Array.isArray(item?.Reports) ? item.Reports : [];
      for (const file of files) {
        if (!isDiagnosisImageFile(file)) continue;
        const url = resolveUrl(file?.url || file?.path || "");
        if (url) return url;
      }
    }

    return "";
  };

  const openDiagnosisImageView = (report) => {
    const url = getDiagnosisImageUrl(report);
    if (!url) {
      alert("No diagnosis image available");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };


  const downloadDiagnosisReport = async (report) => {
    const downloadId = getDiagnosisDownloadId(report);

    try {
      setDownloadingDiagnosisId(downloadId);
      const downloadUrl = buildReportDownloadUrl(BACKEND_URL, "diagnosis-api", {
        recordId: report?.record?._id || report?._id || "",
        employeeId: selectedEmployee?._id || "",
        personId: report?.record?.IsFamilyMember ? (report?.record?.FamilyMember?._id || "") : "self",
      });

      await downloadPdfBlob({
        url: downloadUrl,
        filename: `diagnosis-report-${downloadId}.pdf`,
      });
    } catch (error) {
      console.error("Diagnosis report download failed", error);
      alert("Failed to download diagnosis report");
    } finally {
      setDownloadingDiagnosisId("");
    }
  };

  const downloadPrescriptionReport = async (record) => {
    const downloadId = getPrescriptionDownloadId(record);

    try {
      setDownloadingPrescriptionId(downloadId);
      const downloadUrl = buildReportDownloadUrl(BACKEND_URL, "prescription-api", {
        recordId: record?._id || "",
        employeeId: selectedEmployee?._id || "",
        personId: record?.IsFamilyMember ? (record?.FamilyMember?._id || "") : "self",
      });

      await downloadPdfBlob({
        url: downloadUrl,
        filename: `prescription-report-${downloadId}.pdf`,
      });
    } catch (error) {
      console.error("Prescription report download failed", error);
      alert("Failed to download prescription report");
    } finally {
      setDownloadingPrescriptionId("");
    }
  };

  const openXrayImageView = (report) => {
    const url = getXrayImageUrl(report);
    if (!url) {
      alert("No x-ray image available");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const downloadXrayReport = async (report) => {
    const downloadId = getXrayDownloadId(report);

    try {
      setDownloadingXrayId(downloadId);
      const downloadUrl = buildReportDownloadUrl(BACKEND_URL, "xray-api", {
        recordId: report?.record?._id || report?._id || "",
        employeeId: selectedEmployee?._id || "",
        personId: report?.record?.IsFamilyMember ? (report?.record?.FamilyMember?._id || "") : "self",
      });

      await downloadPdfBlob({
        url: downloadUrl,
        filename: `Xray_Report_${downloadId.slice(-6)}.pdf`,
      });
    } catch (err) {
      console.error("X-ray report download failed:", err);
      alert("Unable to download x-ray report");
    } finally {
      setDownloadingXrayId("");
    }
  };

  const normalizeMedicineText = (value) => String(value || "").trim().toLowerCase();
  const makeMedicineLookupKey = (medicineType, dosageForm, name) =>
    `${normalizeMedicineText(medicineType)}::${normalizeMedicineText(dosageForm)}::${normalizeMedicineText(name)}`;



  const [diseaseData, setDiseaseData] = useState({
    Category: "Communicable",
    Disease_Name: "",
    Severity_Level: "Mild"
  });


  const testsByCategory = useMemo(() => {
    const normalizeCategoryKey = (value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const allowedCategoryKeys = new Set((testCategories || []).map((cat) => normalizeCategoryKey(cat)).filter(Boolean));
    const grouped = {};
    (testsMaster || []).forEach((test) => {
      const group = String(test?.Group || "").trim();
      const testName = String(test?.Test_Name || "").trim();
      if (allowedCategoryKeys.size > 0 && !allowedCategoryKeys.has(normalizeCategoryKey(group))) return;
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
      Array.from(new Set((testCategories || []).map((item) => String(item || "").trim()).filter(Boolean))).filter(
        (category) => {
          const key = String(category || "").trim().toLowerCase();
          return !knownTestNameKeys.has(key) && !blockedTestCategoryKeys.has(key);
        }
      ),
    [blockedTestCategoryKeys, knownTestNameKeys, testCategories]
  );

  const [showOtherDiseaseInput, setShowOtherDiseaseInput] = useState(false);

  const diseaseCategoryOptions = getMasterOptions(masterMap, "Disease Categories");
  const diseaseSeverityOptions = getMasterOptions(masterMap, "Disease Severity Levels");
  const medicineTypeOptions = getMasterOptions(masterMap, "Medicine Types");
  const dosageFormOptions = getMasterOptions(masterMap, "Dosage Forms");
  const foodTimingOptions = getMasterOptions(masterMap, "Food Timings");
  const effectiveDiseaseSeverityOptions = diseaseSeverityOptions.length > 0
    ? diseaseSeverityOptions
    : ["Mild", "Moderate", "Severe", "Chronic", "Null"];

  const [formData, setFormData] = useState({
    Institute_ID: "",
    Employee_ID: "",
    IsFamilyMember: false,
    FamilyMember_ID: "",
    Vitals: {},
    Medicines: [{ Medicine_Name: "", Medicine_Type: "", Dosage_Form: "", Type: "", FoodTiming: "", Strength: "", Morning: false, Afternoon: false, Night: false, Duration: "", Remarks: "", Quantity: 0, ToBePrescribed: false, toBePrescribed: false, IsToBePrescribed: false }],
    Notes: "",
    Disease_Name: ""
  });
  const [quickMedicineSearches, setQuickMedicineSearches] = useState([]);
  const [quickMedicineSearchOpen, setQuickMedicineSearchOpen] = useState([]);
  const quickMedicineSearchRefs = useRef({});

  const SAMPLE_MEDICINES = [
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Tablet", Strength: "250mg" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Syrup", Strength: "120mg/5ml" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Injection", Strength: "150mg/ml" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Tablet", Strength: "500mg" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Suspension", Strength: "250mg/5ml" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Drop", Strength: "100mg/ml" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Caplet", Strength: "650mg" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Effervescent Tablet", Strength: "500mg" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Suppository", Strength: "125mg" },
    { Medicine_Name: "Paracetamol", Medicine_Type: "Analgesics & Anti Pyretics", Dosage_Form: "Infusion", Strength: "1g/100ml" }
  ];

  const normalizeSearchText = (value) => String(value || "").trim().toLowerCase();

  const getQuickMedicineOptionsForRow = (index) => {
    const typedValue = normalizeSearchText(quickMedicineSearches[index]);
    const allMedicines = Array.isArray(inventoryMedicines) && inventoryMedicines.length > 0 ? inventoryMedicines : SAMPLE_MEDICINES;
    if (!allMedicines.length) return [];
    if (!typedValue) return allMedicines;

    return allMedicines.filter((med) => {
      const haystack = [
        med?.Medicine_Name,
        med?.Medicine_Type,
        med?.Dosage_Form,
        med?.Strength,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(typedValue);
    });
  };

  const resetMedicineRow = (index) => {
    setFormData((prev) => {
      const nextMedicines = [...prev.Medicines];
      if (!nextMedicines[index]) return prev;
      nextMedicines[index] = {
        ...nextMedicines[index],
        Medicine_Name: "",
        Medicine_Type: "",
        Dosage_Form: "",
        Type: "",
        Strength: ""
      };
      return { ...prev, Medicines: nextMedicines };
    });
  };

  const closeAllQuickMedicineSearches = () => {
    setQuickMedicineSearchOpen((prev) => prev.map(() => false));
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      const refs = quickMedicineSearchRefs.current || {};
      const clickedInside = Object.values(refs).some((ref) => ref && ref.contains(event.target));
      if (!clickedInside) {
        closeAllQuickMedicineSearches();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const applyQuickMedicineSelection = (index, selectedMedicine) => {
    if (!selectedMedicine) return;

    const findExactMatch = (med) =>
      normalizeSearchText(med?.Medicine_Name) === normalizeSearchText(selectedMedicine?.Medicine_Name || selectedMedicine?.value_name) &&
      normalizeSearchText(med?.Medicine_Type) === normalizeSearchText(selectedMedicine?.Medicine_Type || selectedMedicine?.medicineType) &&
      normalizeSearchText(med?.Dosage_Form) === normalizeSearchText(selectedMedicine?.Dosage_Form || selectedMedicine?.dosageForm) &&
      normalizeSearchText(med?.Strength) === normalizeSearchText(selectedMedicine?.Strength || selectedMedicine?.strength);

    const inventoryMatch = (inventoryMedicines || []).find(findExactMatch) || selectedMedicine;

    const medicineName = String(inventoryMatch?.Medicine_Name || inventoryMatch?.value_name || "").trim();
    const medicineType = String(inventoryMatch?.Medicine_Type || inventoryMatch?.medicineType || "").trim();
    const dosageForm = String(inventoryMatch?.Dosage_Form || inventoryMatch?.dosageForm || "").trim();
    const strength = String(inventoryMatch?.Strength || inventoryMatch?.strength || "").trim();

    setFormData((prev) => {
      const nextMedicines = [...prev.Medicines];
      if (!nextMedicines[index]) {
        nextMedicines[index] = { Medicine_Name: "", Medicine_Type: "", Dosage_Form: "", Type: "", FoodTiming: "", Strength: "", Morning: false, Afternoon: false, Night: false, Duration: "", Remarks: "", Quantity: 0, ToBePrescribed: false, toBePrescribed: false, IsToBePrescribed: false };
      }
      nextMedicines[index].Medicine_Name = medicineName;
      nextMedicines[index].Medicine_Type = medicineType;
      nextMedicines[index].Type = medicineType;
      nextMedicines[index].Dosage_Form = dosageForm;
      nextMedicines[index].Strength = strength;
      return { ...prev, Medicines: nextMedicines };
    });

    setQuickMedicineSearches((prev) => {
      const next = [...prev];
      next[index] = medicineName;
      return next;
    });
    setQuickMedicineSearchOpen((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
  };

  const getStrengthOptions = (medicineName, medicineType = "", dosageForm = "") => {
    if (!medicineName) return [];
    const strictKey = makeMedicineLookupKey(medicineType, dosageForm, medicineName);
    const typeFallbackKey = makeMedicineLookupKey(medicineType, "", medicineName);
    const fullFallbackKey = makeMedicineLookupKey("", "", medicineName);
    return medicineStrengths[strictKey] || medicineStrengths[typeFallbackKey] || medicineStrengths[fullFallbackKey] || [];
  };

  const getMedicineOptionsByType = (selectedMedicineType = "", selectedDosageForm = "") => {
    const typeKey = normalizeMedicineText(selectedMedicineType);
    if (!typeKey) return [];

    const dosageKey = normalizeMedicineText(selectedDosageForm);

    const names = new Set();
    (inventoryMedicines || []).forEach((med) => {
      if (normalizeMedicineText(med?.Medicine_Type) === typeKey) {
        if (dosageKey && normalizeMedicineText(med?.Dosage_Form) !== dosageKey) {
          return;
        }
        const name = String(med?.Medicine_Name || "").trim();
        if (name) names.add(name);
      }
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  };

  const calculateQuantity = (morning, afternoon, night, duration) => {
    const daysMatch = String(duration || "").match(/(\d+)/);
    const days = daysMatch ? Number(daysMatch[1]) : 1;
    const dosesPerDay = (morning ? 1 : 0) + (afternoon ? 1 : 0) + (night ? 1 : 0);
    if (!dosesPerDay || !days) return 0;
    return dosesPerDay * days;
  };

  const refreshMedicines = async () => {
    let medicineEntries = [];

    try {
      const instituteId = localStorage.getItem("instituteId") || "";
      const res = await axios.get(`${BACKEND_URL}/master-data-api/medicines-structure`, {
        params: instituteId ? { instituteId } : {}
      });
      const payload = res.data && res.data.data ? res.data.data : res.data || {};
      medicineEntries = Array.isArray(payload?.medicines)
        ? payload.medicines.map((item) => ({
          value_name: item?.value_name,
          medicineType: item?.medicineType,
          dosageForm: item?.dosageForm,
          strength: item?.strength,
          status: item?.status || "Active"
        }))
        : [];
    } catch {
      medicineEntries = getMasterMedicineEntries(masterMap);
    }

    setInventoryMedicines(
      medicineEntries.map((item) => ({
        Medicine_Name: item.value_name,
        Medicine_Type: item.medicineType,
        Dosage_Form: item.dosageForm,
        Strength: item.strength
      }))
    );

    const strengthMap = {};
    medicineEntries.forEach((med) => {
      const name = String(med?.value_name || "").trim();
      const medicineType = String(med?.medicineType || "").trim();
      const dosageForm = String(med?.dosageForm || "").trim();
      const strength = String(med?.strength || "").trim();
      if (!name || !strength) return;

      const strictKey = makeMedicineLookupKey(medicineType, dosageForm, name);
      const typeFallbackKey = makeMedicineLookupKey(medicineType, "", name);
      const fallbackKey = makeMedicineLookupKey("", "", name);
      strengthMap[strictKey] = strengthMap[strictKey] || [];
      if (!strengthMap[strictKey].includes(strength)) {
        strengthMap[strictKey].push(strength);
      }
      strengthMap[typeFallbackKey] = strengthMap[typeFallbackKey] || [];
      if (!strengthMap[typeFallbackKey].includes(strength)) {
        strengthMap[typeFallbackKey].push(strength);
      }
      strengthMap[fallbackKey] = strengthMap[fallbackKey] || [];
      if (!strengthMap[fallbackKey].includes(strength)) {
        strengthMap[fallbackKey].push(strength);
      }
    });

    setMedicineStrengths(strengthMap);
  };

  useEffect(() => {
    refreshMedicines();
  }, []);

  const xrayBodyPartOptions = useMemo(() => {
    const parts = new Set();
    [...mergeXrayTypes(xrayMaster || []), ...(xrayBodyParts || [])].forEach((item) => {
      const part = String(item?.Body_Part || "").trim();
      if (part) parts.add(part);
    });
    return Array.from(parts).sort((a, b) => a.localeCompare(b));
  }, [xrayMaster, xrayBodyParts]);

  const getXrayOptionsByBodyPart = (bodyPart = "") => {
    const key = String(bodyPart || "").trim().toLowerCase();
    if (!key) return [];
    return mergeXrayTypes(xrayMaster || [])
      .filter((item) => String(item?.Body_Part || "").trim().toLowerCase() === key)
      .sort((a, b) => String(a?.Xray_Type || "").localeCompare(String(b?.Xray_Type || "")));
  };

  const getXrayOptionValue = (item = {}) => {
    const id = String(item?._id || "").trim();
    if (id) return id;
    return `${String(item?.Xray_Type || "").trim()}||${String(item?.Body_Part || "").trim()}`;
  };

  const fetchXrayTypes = async () => {
    try {
      const instituteId = localStorage.getItem("instituteId") || "";
      const [typesRes, bodyPartsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/xray-api/types`, {
          params: instituteId ? { instituteId } : {}
        }),
        axios.get(`${BACKEND_URL}/xray-api/body-parts`, {
          params: instituteId ? { instituteId } : {}
        }).catch(() => ({ data: [] }))
      ]);

      setXrayMaster(mergeXrayTypes(Array.isArray(typesRes.data) ? typesRes.data : []));
      setXrayBodyParts(Array.isArray(bodyPartsRes.data) ? bodyPartsRes.data : []);
    } catch (err) {
      console.error("Error fetching X-ray types:", err);
      setXrayMaster(mergeXrayTypes([]));
      setXrayBodyParts([]);
    }
  };

  useEffect(() => {
    fetchXrayTypes();
  }, []);

  useEffect(() => {
    // Duplicate/merged block removed — medicines are refreshed by `refreshMedicines()` on mount
  }, []);
  // medicines are refreshed on mount; updates are handled by a single
  // `master-data-updated` listener registered in the disease/masters effect
  // below to avoid duplicate listeners and merge conflict fragments.


  const fetchTests = async () => {
    setTestsLoading(true);
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
      const categoryByName = new Map();
      const testsByCategory = {};

      masterValues.forEach((item) => {
        const kind = String(item?.meta?.kind || "").trim();
        const valueName = String(item?.value_name || item?.name || "").trim();
        if (!valueName) return;

        if (kind === "category") {
          categoryByName.set(valueName.toLowerCase(), valueName);
          if (!testsByCategory[valueName]) testsByCategory[valueName] = [];
          return;
        }

        if (kind !== "test") return;
        const category = String(item?.meta?.category || "").trim();
        if (!category) return;
        if (!testsByCategory[category]) testsByCategory[category] = [];
        testsByCategory[category].push({
          _id: item?._id,
          Test_Name: valueName,
          Group: category,
          Reference_Range: String(item?.meta?.reference || "").trim(),
          Units: String(item?.meta?.unit || "").trim(),
          Display_Name: valueName,
          Raw_Test_Name: valueName
        });
      });

      const mergedCategories = Array.from(
        new Set([...Array.from(categoryByName.values()), ...Object.keys(testsByCategory)])
      ).sort((a, b) => a.localeCompare(b));

      const normalizedTests = Object.entries(testsByCategory).flatMap(([category, rows]) =>
        (Array.isArray(rows) ? rows : []).map((test, idx) => ({
          _id: test?._id || `master-${category}-${idx}`,
          Test_Name: String(test?.Test_Name || test?.name || "").trim(),
          Group: String(test?.Group || category || "").trim(),
          Reference_Range: String(test?.Reference_Range || test?.reference || "").trim(),
          Units: String(test?.Units || test?.unit || "").trim(),
          Display_Name: String(test?.Display_Name || test?.name || test?.Test_Name || "").trim(),
          Raw_Test_Name: String(test?.Raw_Test_Name || test?.name || test?.Test_Name || "").trim()
        }))
      ).filter((test) => test.Group && test.Test_Name);

      setTestsMaster(normalizedTests);
      setTestCategories(mergedCategories);
      setTestsLoading(false);
      return;
      if (false) {
        const normalizeLoose = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
        const normalizeCategoryKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
        const isActive = (status) => String(status || "active").trim().toLowerCase() === "active";
        const structRes = await axios
          .get(`${BACKEND_URL}/master-data-api/tests-structure`, {
            params: instituteId
              ? { instituteId, includeInactive: false, _t: Date.now() }
              : { includeInactive: false, _t: Date.now() }
          })
          .catch(() => ({ data: { categories: [], testsByCategory: {} } }));

        const categoryItems = Array.isArray(structRes.data?.categoryItems)
          ? structRes.data.categoryItems
          : [];
        const apiTestsByCategory = structRes.data?.testsByCategory && typeof structRes.data.testsByCategory === "object"
          ? structRes.data.testsByCategory
          : {};

        const activeCategoryItems = categoryItems
          .filter((item) => item && !item.archived && isActive(item.status))
          .map((item) => ({
            _id: String(item?._id || item?.id || "").trim(),
            name: String(item?.name || item?.value_name || "").trim()
          }))
          .filter((item) => item.name);

        const categoryNameById = new Map(
          activeCategoryItems
            .filter((item) => item._id)
            .map((item) => [item._id, item.name])
        );
        const allowedCategoryMap = new Map(
          activeCategoryItems.map((item) => [normalizeCategoryKey(item.name), item.name])
        );

        const normalizedTests = Object.entries(apiTestsByCategory).flatMap(([category, rows]) =>
          (Array.isArray(rows) ? rows : []).map((test) => {
            const rawCategoryId = String(test?.category_id || test?.categoryId || "").trim();
            const preferredCategory = rawCategoryId ? categoryNameById.get(rawCategoryId) : "";
            const fallbackCategory = String(test?.category_name || test?.Group || category || "").trim();
            const resolvedCategory = String(preferredCategory || fallbackCategory || "").trim();
            const canonicalCategory = allowedCategoryMap.get(normalizeCategoryKey(resolvedCategory)) || resolvedCategory;
            return {
              _id: test?._id || test?.id || "",
              Test_Name: String(test?.name || test?.Test_Name || "").trim(),
              Group: canonicalCategory,
              Reference_Range: String(test?.reference || test?.Reference_Range || "").trim(),
              Units: String(test?.unit || test?.Units || "").trim(),
              category_id: rawCategoryId || null,
              status: String(test?.status || "Active").trim(),
              archived: Boolean(test?.archived)
            };
          })
        )
          .filter((test) => {
            if (!test.Group || !test.Test_Name || test.archived || !isActive(test.status)) return false;
            if (allowedCategoryMap.size === 0) return true;
            return allowedCategoryMap.has(normalizeCategoryKey(test.Group));
          })
          .filter((test, index, arr) => {
            const key = `${normalizeLoose(test.Group)}::${normalizeLoose(test.Test_Name)}`;
            return arr.findIndex((row) => `${normalizeLoose(row.Group)}::${normalizeLoose(row.Test_Name)}` === key) === index;
          });

        const categoriesFromTests = Array.from(
          new Map(
            normalizedTests.map((test) => [normalizeCategoryKey(test.Group), test.Group])
          ).values()
        )
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const finalCategories = allowedCategoryMap.size > 0
          ? Array.from(
            new Map(
              categoriesFromTests
                .filter((name) => allowedCategoryMap.has(normalizeCategoryKey(name)))
                .map((name) => [normalizeCategoryKey(name), allowedCategoryMap.get(normalizeCategoryKey(name)) || name])
            ).values()
          ).sort((a, b) => a.localeCompare(b))
          : categoriesFromTests;

        setTestsMaster(normalizedTests);
        setTestCategories(finalCategories);
      }
    } catch (err) {
      console.error(err);
      setTestsMaster([]);
      setTestCategories([]);
    } finally {
      setTestsLoading(false);
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

  useEffect(() => {
    const instituteId = localStorage.getItem("instituteId");
    if (!instituteId) return;

    setFormData((f) => ({ ...f, Institute_ID: instituteId }));
    fetchInstitute(instituteId);
    fetchTests();
    loadDiagnosticPanels();
    // fetchEmployees();
    // fetchInventory(instituteId);
  }, []);

  useEffect(() => {
    const onWindowFocus = () => {
      fetchTests();
      loadDiagnosticPanels();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchTests();
        loadDiagnosticPanels();
      }
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const fetchTopTwoPrescriptions = async (employeeId, familyId = null) => {
    try {
      const params = {
        isFamily: !!familyId,
        familyId: familyId || null
      };

      const [actionsRes, diagnosisRes, xrayRes, pharmacyRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/medical-actions/employee/${employeeId}`),
        axios.get(`${BACKEND_URL}/diagnosis-api/records/${employeeId}`, { params }),
        axios.get(`${BACKEND_URL}/xray-api/records/${employeeId}`, { params }),
        axios.get(`${BACKEND_URL}/prescription-api/employee/${employeeId}`)
      ]);

      const data = getEnrichedPrescriptionHistory(
        actionsRes.data || [],
        pharmacyRes.data || [],
        diagnosisRes.data || [],
        xrayRes.data || [],
        familyId
      );
      setLastTwoVisits(data.slice(0, 2));

    } catch (err) {
      console.error(err);
      setLastTwoVisits([]);
    }
  };
  /* ================= API CALLS ================= */
  const fetchInstitute = async (id) => {
    const res = await axios.get(`${BACKEND_URL}/institute-api/institution/${id}`);
    setInstituteName(res.data?.Institute_Name || "");
  };


  const fetchDiseases = async (employeeId) => {
    try {
      const res = await axios.get(`${BACKEND_URL}/disease-api/employee/${employeeId}`);
      setDiseases(res.data?.employeeDiseases || []);
    } catch {
      setDiseases([]);
    }
  };


  useEffect(() => {
    if (!formData.Employee_ID) return;

    axios
      .get(`${BACKEND_URL}/employee-api/profile/${formData.Employee_ID}`)
      .then((res) => setEmployeeProfile(res.data))
      .catch(() => setEmployeeProfile(null));
  }, [formData.Employee_ID]);

  useEffect(() => {
    const instituteId = localStorage.getItem("instituteId") || "";

    let mounted = true;

    const loadDiseaseMasters = async () => {
      const normalizeRows = (rows) =>
        (Array.isArray(rows) ? rows : [])
          .map((item) => (typeof item === "string" ? { name: item } : item))
          .filter((item) => item?.name)
          .map((item) => ({
            ...item,
            name: String(item.name).trim()
          }));

      const dedupeByName = (rows) => {
        const seen = new Set();
        return rows.filter((item) => {
          const key = String(item?.name || "").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      try {
        const [cdRes, ncdRes, masterMap] = await Promise.all([
          axios.get(`${BACKEND_URL}/disease-master-api/cd`, { params: { instituteId } }).catch(() => ({ data: [] })),
          axios.get(`${BACKEND_URL}/disease-master-api/ncd`, { params: { instituteId } }).catch(() => ({ data: [] })),
          fetchMasterDataMap({ force: false }).catch(() => ({}))
        ]);

        if (mounted) setMasterMap(masterMap || {});

        const customDiseases = Array.isArray(masterMap?.Diseases) ? masterMap.Diseases : [];
        const customCd = customDiseases
          .filter((item) => item?.meta?.kind === "disease" && item?.meta?.group === "Communicable")
          .map((item) => ({ name: item.value_name, type: "Custom" }));
        const customNcd = customDiseases
          .filter((item) => item?.meta?.kind === "disease" && item?.meta?.group === "Non-Communicable")
          .map((item) => ({ name: item.value_name, type: "Custom" }));

        setCdDiseases(dedupeByName([...normalizeRows(cdRes.data), ...normalizeRows(customCd)]));
        setNcdDiseases(dedupeByName([...normalizeRows(ncdRes.data), ...normalizeRows(customNcd)]));
      } catch {
        setMasterMap({});
        setCdDiseases([]);
        setNcdDiseases([]);
      }
    };

    loadDiseaseMasters();
    const onMasterUpdated = () => {
      loadDiseaseMasters();
      try {
        refreshMedicines();
      } catch (e) {
        // ignore
      }
    };
    const onMasterUpdatedAll = () => {
      // refresh tests/categories too
      try {
        fetchTests();
      } catch (e) {
        // ignore
      }
      try {
        loadDiagnosticPanels();
      } catch (e) {
        // ignore
      }
      try {
        fetchXrayTypes();
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener("master-data-updated", onMasterUpdated);
    window.addEventListener("master-data-updated", onMasterUpdatedAll);
    const onStorageUpdated = (event) => {
      if (event.key === "master-data-updated-at") {
        fetchTests();
        loadDiagnosticPanels();
        fetchXrayTypes();
      }
    };
    window.addEventListener("storage", onStorageUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("master-data-updated", onMasterUpdated);
      window.removeEventListener("master-data-updated", onMasterUpdatedAll);
      window.removeEventListener("storage", onStorageUpdated);
    };
  }, []);

  const allDiseases = [...cdDiseases, ...ncdDiseases];

  useEffect(() => {
    const source =
      diseaseData.Category === "Communicable"
        ? cdDiseases
        : ncdDiseases;

    // If no search term, show all diseases in alphabetical order
    if (!diseaseSearch.trim()) {
      const sorted = [...source].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      setFilteredDiseases(sorted); // Show all diseases, not just 5
      return;
    }

    // Otherwise filter based on search
    const search = diseaseSearch.toLowerCase();

    const filtered = source.filter(d => {
      return (
        d.name?.toLowerCase().includes(search) ||
        d.type?.toLowerCase().includes(search) ||
        d.subgroup?.toLowerCase().includes(search)
      );
    });

    setFilteredDiseases(filtered.slice(0, 20));

  }, [diseaseSearch, cdDiseases, ncdDiseases, diseaseData.Category]);


  /* ================= DISEASE FILTER ================= */
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const relevantDiseases = diseases.filter((d) => {
    if (formData.IsFamilyMember) {
      return (
        d.IsFamilyMember === true &&
        String(d.FamilyMember_ID) === String(formData.FamilyMember_ID)
      );
    }

    return d.IsFamilyMember === false;
  });

  const communicableRecent = relevantDiseases.filter(
    (d) =>
      d.Category === "Communicable" &&
      new Date(d.createdAt) >= twoMonthsAgo
  );

  const addMedicine = () =>
    setFormData((prev) => ({
      ...prev,
      Medicines: [
        ...prev.Medicines,
        { Medicine_Name: "", Medicine_Type: "", Dosage_Form: "", Type: "", FoodTiming: "", Strength: "", Morning: false, Afternoon: false, Night: false, Duration: "", Remarks: "", Quantity: 0, ToBePrescribed: false, toBePrescribed: false, IsToBePrescribed: false, _uid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
      ]
    }));

  const removeMedicine = (index) =>
    setFormData((prev) => ({
      ...prev,
      Medicines: prev.Medicines.filter((_, i) => i !== index)
    }));


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingPrescription) return;
    setPrescriptionSuccessMessage("");
    setPrescriptionErrorMessage("");

    if (!formData.Employee_ID) {
      alert("Please select an employee");
      return;
    }

    if (formData.IsFamilyMember && !formData.FamilyMember_ID) {
      alert("Please select a family member");
      return;
    }

    setIsSubmittingPrescription(true);

    try {
      try {
        await submitPendingDiagnosisTests();
        await submitPendingXrays();
      } catch (err) {
        console.error("Failed to auto-submit pending diagnostics", err);
        const message = err?.response?.data?.error || err?.response?.data?.message || "Unable to submit tests or x-rays with the prescription.";
        setPrescriptionErrorMessage(message);
        alert(`❌ ${message}`);
        return;
      }

      const selectedMedicines = formData.Medicines
        .filter((med) => med.Medicine_Name?.trim())
        .map((med) => ({
          Medicine_Name: med.Medicine_Name,
          Type: med.Medicine_Type || med.Type,
          Dosage_Form: med.Dosage_Form || "",
          FoodTiming: med.FoodTiming,
          Strength: med.Strength,
          Morning: med.Morning,
          Afternoon: med.Afternoon,
          Night: med.Night,
          Duration: med.Duration,
          Remarks: med.Remarks,
          Quantity: med.Quantity,
          ToBePrescribed: med.ToBePrescribed || med.toBePrescribed || med.IsToBePrescribed || false
        }));

      // Removed validation - allow custom medicine names
      // for (let med of selectedMedicines) {
      //   if (!uniqueMedicines.includes(med.Medicine_Name)) {
      //     alert("Invalid medicine selected. Please choose from list.");
      //     return;
      //   }
      // }

      // Medicines are now optional - removed validation

      const token = localStorage.getItem("instituteToken") || localStorage.getItem("token");
      await axios.post(`${BACKEND_URL}/doctor-prescription-api/add`, {
        Institute_ID: formData.Institute_ID,
        Employee_ID: formData.Employee_ID,
        IsFamilyMember: formData.IsFamilyMember,
        FamilyMember_ID: formData.IsFamilyMember
          ? formData.FamilyMember_ID
          : null,
        visit_id: formData.visit_id || null,
        Medicines: selectedMedicines,
        Notes: formData.Notes
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      await fetchTopTwoPrescriptions(
        formData.Employee_ID,
        formData.IsFamilyMember ? formData.FamilyMember_ID : null
      );

      if (showReports) {
        await loadEmployeeReports();
      }

      // ✅ Save Disease (if selected)
      if (diseaseData.Disease_Name?.trim()) {
        await axios.post(
          `${BACKEND_URL}/disease-api/diseases`,
          {
            Institute_ID: formData.Institute_ID,
            Employee_ID: formData.Employee_ID,
            IsFamilyMember: formData.IsFamilyMember,
            FamilyMember_ID: formData.IsFamilyMember
              ? formData.FamilyMember_ID
              : null,
            Disease_Name: diseaseData.Disease_Name,
            Category: diseaseData.Category,
            Description: "",
            Symptoms: [],
            Common_Medicines: [],
            Severity_Level: diseaseData.Severity_Level,
            Notes: formData.Notes
          }
        );

      }


      alert("✅ Prescription saved successfully");
      setPrescriptionSuccessMessage("Prescription submitted successfully.");

      // Reset all form fields
      setFormData({
        Institute_ID: formData.Institute_ID,
        Employee_ID: "",
        IsFamilyMember: false,
        FamilyMember_ID: "",
        Medicines: [{ Medicine_Name: "", Medicine_Type: "", Dosage_Form: "", Type: "", FoodTiming: "", Strength: "", Morning: false, Afternoon: false, Night: false, Duration: "", Remarks: "", Quantity: 0, ToBePrescribed: false, toBePrescribed: false, IsToBePrescribed: false }],
        Notes: "",
        Disease_Name: ""
      });

      setDiseaseData({
        Category: "Communicable",
        Disease_Name: "",
        Severity_Level: "Mild"
      });

      setDiagnosisData({
        Tests: [{ Category: "", Test_ID: "", Test_Name: "" }]
      });

      setXrayData({
        Xrays: [{ Body_Part: "", Xray_ID: "", Xray_Type: "" }]
      });

      setSelectedEmployee(null);
      setLastTwoVisits([]);
      setSelectedVisit(null);
      setEmployeeProfile(null);
      setDiseases([]);
      setVisitId(null);
      setSelectedDiagnosisReport(null);
      setSelectedXrayReport(null);
      setSelectedPrescriptionReport(null);
      setDiseaseSearch("");
      setFilteredDiseases([]);
      setSelectedType("");
      setSelectedSubgroup("");

      // Reset PatientSelector component by changing key
      setPatientSelectorKey(prev => prev + 1);

      if (notesTextareaRef.current) {
        notesTextareaRef.current.value = "";
      }
    } catch (err) {
      console.error("Failed to submit prescription", err);
      const backendError = err?.response?.data?.error || err?.response?.data?.message;
      const message = backendError || "Failed to submit prescription";
      setPrescriptionErrorMessage(message);
      alert(`❌ ${message}`);
    } finally {
      setIsSubmittingPrescription(false);
    }
  };

  const getRecordFamilyId = (record) =>
    record?.FamilyMember?._id ||
    record?.FamilyMember_ID ||
    record?.data?.FamilyMember_ID ||
    record?.FamilyMember ||
    null;

  const matchesPersonScope = (record, familyId = null) => {
    if (familyId) {
      return Boolean(record?.IsFamilyMember) && String(getRecordFamilyId(record)) === String(familyId);
    }
    return !record?.IsFamilyMember;
  };

  const normalizeMedicineRow = (medicine = {}, source = "Doctor") => ({
    ...medicine,
    Medicine_Name: medicine?.Medicine_Name || medicine?.medicineName || "-",
    Type: medicine?.Type || medicine?.Medicine_Type || medicine?.medicineType || "",
    Medicine_Type: medicine?.Medicine_Type || medicine?.Type || medicine?.medicineType || "",
    Dosage_Form: medicine?.Dosage_Form || medicine?.dosageForm || "",
    FoodTiming: medicine?.FoodTiming || medicine?.foodTiming || "",
    Strength: medicine?.Strength || "",
    Morning: Boolean(medicine?.Morning),
    Afternoon: Boolean(medicine?.Afternoon),
    Night: Boolean(medicine?.Night),
    Duration: medicine?.Duration || "",
    Remarks: medicine?.Remarks || "",
    Quantity: medicine?.Quantity || 0,
    _source: source
  });

  const getMetricValue = (source, key) => {
    const profile = source?.IsFamilyMember ? source?.FamilyMember : source?.Employee;
    return (
      profile?.[key] ||
      source?.VisitSummary?.Vitals?.[key] ||
      source?.Vitals?.[key] ||
      source?.PatientMetrics?.[key] ||
      ""
    );
  };

  const formatDateDMY = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString("en-GB");
  };

  const formatDateTime = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString("en-GB");
  };

  const calculateAge = (dob) => {
    if (!dob) return "";
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }
    return age;
  };

  const getPrescriptionTimestamp = (record) =>
    record?.Timestamp || record?.created_at || record?.createdAt || null;

  const selectedPatientProfile = selectedVisit?.IsFamilyMember
    ? selectedVisit?.FamilyMember || null
    : selectedEmployee || selectedVisit?.employee_id || null;
  const selectedPatientName = selectedVisit?.IsFamilyMember
    ? selectedVisit?.FamilyMember?.Name || "Family Member"
    : selectedEmployee?.Name || selectedVisit?.employee_id?.Name || "Patient";
  const selectedPatientAge = selectedPatientProfile?.Age || calculateAge(selectedPatientProfile?.DOB) || "—";
  const selectedPatientAbsNo = selectedEmployee?.ABS_NO || selectedVisit?.employee_id?.ABS_NO || "—";
  const selectedPatientBloodGroup = selectedPatientProfile?.Blood_Group || "—";
  const selectedPatientGender = selectedPatientProfile?.Gender || "—";
  const selectedPatientLastVisit = lastTwoVisits?.[0]?.Timestamp
    ? formatDateDMY(lastTwoVisits[0].Timestamp)
    : "—";

  const getDiagnosisReportDate = (record) =>
    record?.Tests?.[0]?.Timestamp || record?.Timestamp || record?.updatedAt || record?.createdAt || null;

  const getXrayReportDate = (record) =>
    record?.Xrays?.[0]?.Timestamp || record?.Timestamp || record?.updatedAt || record?.createdAt || null;

  const getReportStatus = (resultValue) => {
    if (resultValue === null || resultValue === undefined) return "pending";
    return String(resultValue).trim() ? "result out" : "pending";
  };

  const buildVisitNotes = (visitSummary) => {
    if (!visitSummary) return "";
    if (typeof visitSummary === "string") return visitSummary;

    const parts = [
      visitSummary?.symptoms ? `Symptoms: ${visitSummary.symptoms}` : "",
      visitSummary?.Notes ? `Notes: ${visitSummary.Notes}` : "",
      visitSummary?.Vitals?.Blood_Pressure ? `BP: ${visitSummary.Vitals.Blood_Pressure}` : "",
      visitSummary?.Vitals?.Temperature !== null && visitSummary?.Vitals?.Temperature !== undefined
        ? `Temp: ${visitSummary.Vitals.Temperature}`
        : ""
    ].filter(Boolean);

    return parts.join(" | ");
  };

  const isSameCalendarDay = (left, right) => {
    if (!left || !right) return false;
    const a = new Date(left);
    const b = new Date(right);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;

    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  };

  const getPrescriptionReportForLabel = (record) => {
    if (record?.IsFamilyMember) {
      const name = record?.FamilyMember?.Name || record?.patientLabel || "Family Member";
      const relation = record?.FamilyMember?.Relationship || record?.relationship || "";
      return relation ? `${name} (${relation})` : name;
    }
    return record?.Employee?.Name || selectedEmployee?.Name || "Self";
  };

  const getPrescriptionMedicines = (record) => {
    const source = record?.Source === "DOCTOR_PRESCRIPTION" ? "Doctor" : "Pharmacy";
    const rows = Array.isArray(record?.mergedMedicines)
      ? record.mergedMedicines
      : Array.isArray(record?.Medicines)
        ? record.Medicines
        : [];

    return rows.map((medicine) => normalizeMedicineRow(medicine, medicine?._source || source));
  };

  const isTestResultOut = (result) =>
    Boolean(result && String(result?.Result_Value || "").trim());

  const isXrayResultOut = (result) =>
    Boolean(
      result &&
      (
        String(result?.Findings || "").trim() ||
        String(result?.Impression || "").trim() ||
        String(result?.Remarks || "").trim() ||
        (Array.isArray(result?.Reports) && result.Reports.length > 0)
      )
    );

  const formatDoseCell = (value) => (value ? "Yes" : "-");

  const getEnrichedPrescriptionHistory = (
    actions = [],
    prescriptions = [],
    diagnosisRecords = [],
    xrayRecords = [],
    familyId = null
  ) => {
    const safeActions = Array.isArray(actions) ? actions : [];
    const safePrescriptions = Array.isArray(prescriptions) ? prescriptions : [];
    const safeDiagnosis = (Array.isArray(diagnosisRecords) ? diagnosisRecords : []).filter((record) =>
      matchesPersonScope(record, familyId)
    );
    const safeXrays = (Array.isArray(xrayRecords) ? xrayRecords : []).filter((record) =>
      matchesPersonScope(record, familyId)
    );

    const scopedPrescriptions = safePrescriptions.filter((record) =>
      matchesPersonScope(record, familyId)
    );

    const doctorPrescriptionActions = safeActions.filter(
      (action) => action?.action_type === "DOCTOR_PRESCRIPTION"
    );
    const diagnosisActions = safeActions.filter(
      (action) => action?.action_type === "DOCTOR_DIAGNOSIS" && matchesPersonScope(action?.data || {}, familyId)
    );
    const xrayActions = safeActions.filter(
      (action) => action?.action_type === "DOCTOR_XRAY" && matchesPersonScope(action?.data || {}, familyId)
    );

    const findDoctorPrescriptionAction = (record) => {
      const recordActionId = String(record?._id || "");
      const recordVisitId = String(record?.visit_id || "");

      return doctorPrescriptionActions.find((action) => {
        if (recordActionId && String(action?._id || "") === recordActionId) return true;
        if (recordVisitId && String(action?.visit_id || "") === recordVisitId) return true;
        return false;
      }) || null;
    };

    const findRelatedAction = (actionList, record) => {
      const recordVisitId = String(record?.visit_id || "");
      if (recordVisitId) {
        const visitMatch = actionList.find((action) => String(action?.visit_id || "") === recordVisitId);
        if (visitMatch) return visitMatch;
      }

      const recordTimestamp = getPrescriptionTimestamp(record);
      return actionList.find((action) =>
        isSameCalendarDay(action?.created_at || action?.createdAt, recordTimestamp)
      ) || null;
    };

    const matchDiagnosisResult = (requestedTest, record) => {
      const requestedId = String(requestedTest?.Test_ID?._id || requestedTest?.Test_ID || "");
      const requestedName = String(
        requestedTest?.Test_Name || requestedTest?.Test_ID?.Test_Name || ""
      ).trim().toLowerCase();
      const recordVisitId = String(record?.visit_id || "");

      const matchingRecord = safeDiagnosis.find((diagnosisRecord) => {
        const diagnosisVisitId = String(diagnosisRecord?.Visit?._id || diagnosisRecord?.Visit || "");
        if (recordVisitId && diagnosisVisitId) {
          return diagnosisVisitId === recordVisitId;
        }
        return isSameCalendarDay(getDiagnosisReportDate(diagnosisRecord), getPrescriptionTimestamp(record));
      });

      if (!matchingRecord) return null;

      const matchedTest = (matchingRecord?.Tests || []).find((test) => {
        const testId = String(test?.Test_ID?._id || test?.Test_ID || "");
        const testName = String(test?.Test_Name || test?.Test_ID?.Test_Name || "").trim().toLowerCase();
        if (requestedId && testId) return requestedId === testId;
        return requestedName && requestedName === testName;
      });

      if (!matchedTest) return null;

      return {
        ...matchedTest,
        record: matchingRecord
      };
    };

    const matchXrayResult = (requestedXray, record) => {
      const requestedId = String(requestedXray?.Xray_ID?._id || requestedXray?.Xray_ID || "");
      const requestedType = String(requestedXray?.Xray_Type || "").trim().toLowerCase();

      const matchingRecord = safeXrays.find((xrayRecord) =>
        isSameCalendarDay(getXrayReportDate(xrayRecord), getPrescriptionTimestamp(record))
      );

      if (!matchingRecord) return null;

      const matchedXray = (matchingRecord?.Xrays || []).find((xray) => {
        const xrayId = String(xray?.Xray_ID?._id || xray?.Xray_ID || "");
        const xrayType = String(xray?.Xray_Type || "").trim().toLowerCase();
        if (requestedId && xrayId) return requestedId === xrayId;
        return requestedType && requestedType === xrayType;
      });

      if (!matchedXray) return null;

      return {
        ...matchedXray,
        record: matchingRecord
      };
    };

    return scopedPrescriptions
      .map((record) => {
        const doctorAction = findDoctorPrescriptionAction(record);
        const diagnosisAction = findRelatedAction(diagnosisActions, record);
        const xrayAction = findRelatedAction(xrayActions, record);

        const doctorMedicines = (doctorAction?.data?.medicines || []).map((medicine) =>
          normalizeMedicineRow(medicine, "Doctor")
        );
        const issuedMedicines = (record?.Medicines || []).map((medicine) =>
          normalizeMedicineRow(medicine, "Pharmacy")
        );

        const mergedMedicines = doctorMedicines.length > 0
          ? doctorMedicines.map((doctorMedicine) => {
            const pharmacyMatch = issuedMedicines.find((issuedMedicine) => {
              const leftName = String(issuedMedicine?.Medicine_Name || "").trim().toLowerCase();
              const rightName = String(doctorMedicine?.Medicine_Name || "").trim().toLowerCase();
              const leftStrength = String(issuedMedicine?.Strength || "").trim().toLowerCase();
              const rightStrength = String(doctorMedicine?.Strength || "").trim().toLowerCase();

              return leftName === rightName && (!leftStrength || !rightStrength || leftStrength === rightStrength);
            });

            return {
              ...doctorMedicine,
              Quantity: pharmacyMatch?.Quantity || doctorMedicine?.Quantity || 0,
              _source: pharmacyMatch ? "Pharmacy" : "Doctor"
            };
          })
          : issuedMedicines;

        const relatedTests = (diagnosisAction?.data?.tests || []).map((test) => ({
          ...test,
          matchedResult: matchDiagnosisResult(test, record)
        }));

        const relatedXrays = (xrayAction?.data?.xrays || []).map((xray) => ({
          ...xray,
          matchedResult: matchXrayResult(xray, record)
        }));

        return {
          ...record,
          visit_id: record?.visit_id || doctorAction?.visit_id || null,
          mergedMedicines,
          doctorNotes: doctorAction?.remarks || record?.doctorNotes || (record?.Source === "DOCTOR_PRESCRIPTION" ? record?.Notes : ""),
          pharmacyNotes: record?.Source === "DOCTOR_PRESCRIPTION"
            ? []
            : (record?.Notes ? [record.Notes] : []),
          relatedTests,
          relatedXrays,
          instituteDisplayName:
            record?.Institute?.Institute_Name ||
            doctorAction?.Institute?.Institute_Name ||
            instituteName ||
            ""
        };
      })
      .sort((left, right) => new Date(getPrescriptionTimestamp(right) || 0) - new Date(getPrescriptionTimestamp(left) || 0));
  };

  const loadEmployeeReports = async () => {
    if (!selectedEmployee?._id) {
      alert("Please select an employee first");
      return;
    }

    const isFamily = Boolean(selectedVisit?.IsFamilyMember);
    const familyId = selectedVisit?.FamilyMember?._id || null;

    try {
      const [reportRes, prescriptionRes, actionsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/employee-api/health-report-detailed`, {
          params: {
            employeeId: selectedEmployee._id,
            isFamily,
            familyMemberId: familyId || undefined
          }
        }),
        axios.get(`${BACKEND_URL}/prescription-api/employee/${selectedEmployee._id}`, {
          params: {
            personId: familyId || "self"
          }
        }),
        axios.get(`${BACKEND_URL}/api/medical-actions/employee/${selectedEmployee._id}`).catch(() => ({ data: [] }))
      ]);

      const payload = reportRes?.data || {};
      const diagnosisRows = Array.isArray(payload?.diagnosisRecords) ? payload.diagnosisRecords : [];
      const xrayRows = Array.isArray(payload?.xrayRecords) ? payload.xrayRecords : [];

      setEmployeeReport({
        ...payload,
        diseases: Array.isArray(payload?.diseases) ? payload.diseases : [],
        diagnosisRecords: diagnosisRows,
        xrayRecords: xrayRows,
        previousPrescriptions: getEnrichedPrescriptionHistory(
          actionsRes?.data || [],
          prescriptionRes?.data || [],
          diagnosisRows,
          xrayRows,
          familyId
        )
      });
      setShowReports(true);
    } catch (err) {
      console.error("Employee reports fetch error:", err);
      alert("Unable to fetch employee reports");
    }
  };

  const renderPrescriptionHistoryCard = (prescription, key) => {
    const medicines = getPrescriptionMedicines(prescription).slice(0, 3);
    const remainingCount = Math.max(getPrescriptionMedicines(prescription).length - medicines.length, 0);

    return (
      <div key={key} className="border rounded p-3 bg-light mb-3">
        <div className="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div className="fw-semibold">{getPrescriptionReportForLabel(prescription)}</div>
            <div className="small text-muted">{formatDateTime(getPrescriptionTimestamp(prescription))}</div>
          </div>
          <span className={`badge ${prescription?.Source === "DOCTOR_PRESCRIPTION" ? "bg-secondary" : "bg-info text-dark"}`}>
            {prescription?.Source === "DOCTOR_PRESCRIPTION" ? "Doctor" : "Pharmacy"}
          </span>
        </div>

        <div className="small mt-2">
          <div className="text-muted mb-2">
            Height: {getMetricValue(prescription, "Height") || "-"} cm | Weight: {getMetricValue(prescription, "Weight") || "-"} kg | BMI: {getMetricValue(prescription, "BMI") || "-"}
          </div>
          {medicines.length > 0 ? (
            medicines.map((medicine, index) => (
              <div key={`${medicine?.Medicine_Name || "medicine"}-${index}`}>
                {medicine?.Medicine_Name}
                {medicine?.Strength ? ` (${medicine.Strength})` : ""}
              </div>
            ))
          ) : (
            <span className="text-muted">No medicines recorded</span>
          )}
          {remainingCount > 0 && (
            <div className="text-muted">+{remainingCount} more</div>
          )}
        </div>

        <div className="d-flex justify-content-between align-items-center mt-3">
          <small className="text-muted">
            Tests: {prescription?.relatedTests?.length || 0} | X-rays: {prescription?.relatedXrays?.length || 0}
          </small>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary view-action"
            onClick={() => {
              setSelectedPrescriptionReport(prescription);
            }}
          >
            View
          </button>
        </div>
      </div>
    );
  };

  const createEmptyDiagnosisTest = () => ({
    Category: "",
    Test_ID: "",
    test_id: "",
    Test_Name: "",
    test_name: "",
    Panel_ID: "",
    Panel_Name: "",
    Result_Value: "",
    Reference_Range: "",
    Units: "",
    ReportFile: null
  });

  const mapPanelTestToFormRow = (panelTest = {}, panel = {}) => ({
    Category: String(panel?.category_name || panelTest?.category_name || panelTest?.Group || "").trim(),
    Test_ID: String(panelTest?.test_id || panelTest?._id || "").trim(),
    test_id: String(panelTest?.test_id || panelTest?._id || "").trim(),
    Test_Name: String(panelTest?.test_name || panelTest?.name || "").trim(),
    test_name: String(panelTest?.test_name || panelTest?.name || "").trim(),
    Result_Value: "",
    Reference_Range: String(panelTest?.reference || "").trim(),
    Units: String(panelTest?.unit || "").trim(),
    ReportFile: null
  });

  const getDiagnosticPanelById = (panelId = "") =>
    (diagnosticPanels || []).find((item) => String(item?._id || item?.id || "") === String(panelId || ""));

  const applyPanelToDiagnosisRow = (index, panelId) => {
    const panel = getDiagnosticPanelById(panelId);
    setDiagnosisData((prev) => {
      const copy = [...(prev.Tests || [])];
      copy[index] = {
        ...(copy[index] || createEmptyDiagnosisTest()),
        Panel_ID: panel ? String(panel._id || panel.id || "") : "",
        Panel_Name: panel ? String(panel.name || "") : "",
        Category: "",
        Test_ID: "",
        test_id: "",
        Test_Name: "",
        test_name: ""
      };
      return {
        ...prev,
        Tests: copy
      };
    });
  };

  const clearDiagnosisRowPanel = (index) => {
    setDiagnosisData((prev) => {
      const copy = [...(prev.Tests || [])];
      copy[index] = {
        ...(copy[index] || createEmptyDiagnosisTest()),
        Panel_ID: "",
        Panel_Name: ""
      };
      return {
        ...prev,
        Tests: copy
      };
    });
  };

  const buildNormalizedDiagnosisTests = () => {
    const seen = new Set();
    const normalizedTests = [];

    (diagnosisData.Tests || []).forEach((test) => {
      const panelId = String(test?.Panel_ID || "").trim();

      if (panelId) {
        const panel = getDiagnosticPanelById(panelId);
        (panel?.tests || []).forEach((panelTest) => {
          const row = mapPanelTestToFormRow(panelTest, panel);
          const testId = String(row.test_id || row.Test_ID || "").trim();
          const testName = String(row.test_name || row.Test_Name || "").trim();
          const key = testId || testName.toLowerCase();
          if (!testId && !testName) return;
          if (seen.has(key)) return;
          seen.add(key);
          normalizedTests.push({
            ...row,
            test_id: testId,
            test_name: testName
          });
        });
        return;
      }

      const testId = String(test?.test_id || test?.Test_ID || "").trim();
      const testName = String(test?.test_name || test?.Test_Name || "").trim();
      if (!testId && !testName) return;

      const key = testId || testName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalizedTests.push({
        ...test,
        test_id: testId,
        test_name: testName
      });
    });

    return normalizedTests;
  };

  const buildNormalizedXrayRows = () =>
    (xrayData.Xrays || [])
      .filter((xray) => String(xray?.Xray_ID || "").trim() || String(xray?.Xray_Type || "").trim())
      .map((xray) => ({
        ...xray,
        Xray_ID: xray?.Xray_ID || "",
        Xray_Type: xray?.Xray_Type || ""
      }));

  const submitPendingDiagnosisTests = async () => {
    const normalizedTests = buildNormalizedDiagnosisTests();
    if (!normalizedTests.length) return false;

    await axios.post(`${BACKEND_URL}/api/medical-actions`, {
      employee_id: formData.Employee_ID,
      visit_id: formData.visit_id || null,
      action_type: "DOCTOR_DIAGNOSIS",
      source: "DOCTOR",
      data: {
        Institute_ID: formData.Institute_ID,
        IsFamilyMember: formData.IsFamilyMember,
        FamilyMember_ID: formData.IsFamilyMember ? formData.FamilyMember_ID : null,
        tests: normalizedTests,
        notes: formData.Notes
      }
    });

    return true;
  };

  const submitPendingXrays = async () => {
    const xrays = buildNormalizedXrayRows();
    if (!xrays.length) return false;

    await axios.post(`${BACKEND_URL}/api/medical-actions`, {
      employee_id: formData.Employee_ID,
      visit_id: formData.visit_id || null,
      action_type: "DOCTOR_XRAY",
      source: "DOCTOR",
      data: {
        Institute_ID: formData.Institute_ID,
        IsFamilyMember: formData.IsFamilyMember,
        FamilyMember_ID: formData.IsFamilyMember ? formData.FamilyMember_ID : null,
        xrays,
        notes: formData.Notes
      }
    });

    return true;
  };



  const handleDiagnosisSubmit = async () => {
    if (!formData.Employee_ID) {
      alert("Please select employee first");
      return;
    }
    const normalizedTests = buildNormalizedDiagnosisTests();

    if (!normalizedTests.length) {
      alert("Please select at least one test");
      return;
    }
    await axios.post(`${BACKEND_URL}/api/medical-actions`, {
      employee_id: formData.Employee_ID,
      visit_id: formData.visit_id || null,
      action_type: "DOCTOR_DIAGNOSIS",
      source: "DOCTOR",
      data: {
        Institute_ID: formData.Institute_ID,
        IsFamilyMember: formData.IsFamilyMember,
        FamilyMember_ID: formData.IsFamilyMember ? formData.FamilyMember_ID : null,
        tests: normalizedTests,
        notes: formData.Notes   // 🔥 SAME NOTES USED
      }
    });

    alert("✅ Diagnosis saved successfully");

    setDiagnosisData({
      Tests: [{ Category: "", Test_ID: "", Test_Name: "" }]
    });
  };

  const handleXraySubmit = async () => {
    if (!formData.Employee_ID) {
      alert("Please select employee first");
      return;
    }

    const validXrays = buildNormalizedXrayRows();

    if (validXrays.length === 0) {
      alert("Please select at least one X-ray");
      return;
    }

    await axios.post(`${BACKEND_URL}/api/medical-actions`, {
      employee_id: formData.Employee_ID,
      visit_id: formData.visit_id || null,
      action_type: "DOCTOR_XRAY",
      source: "DOCTOR",
      data: {
        Institute_ID: formData.Institute_ID,
        IsFamilyMember: formData.IsFamilyMember,
        FamilyMember_ID: formData.IsFamilyMember ? formData.FamilyMember_ID : null,
        xrays: validXrays,
        notes: formData.Notes
      }
    });

    alert("✅ X-ray order saved");

    setXrayData({
      Xrays: [{ Body_Part: "", Xray_ID: "", Xray_Type: "" }]
    });
  };


  /* ================= UI ================= */
  return (

    <div className="container-fluid mt-1 institutes-theme">
      {prescriptionSuccessMessage ? (
        <div className="alert alert-success shadow-sm mb-3" role="alert">
          <strong>Submitted:</strong> {prescriptionSuccessMessage}
        </div>
      ) : null}
      {prescriptionErrorMessage ? (
        <div className="alert alert-danger shadow-sm mb-3" role="alert">
          <strong>Cannot save prescription:</strong> {prescriptionErrorMessage}
        </div>
      ) : null}
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
        {/* ================= LEFT REPORTS ================= */}
        {showReports && (
          <div className="col-lg-3 mb-3">
            <div className="card shadow border-0 h-100">
              <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <strong>Employee Reports</strong>

                {/* 🔥 Cancel Button */}
                <button
                  className="btn btn-sm btn-light"
                  onClick={() => setShowReports(false)}
                >
                  ✕
                </button>
              </div>
              <div
                className="card-body"
                style={{ maxHeight: "70vh", overflowY: "auto" }}
              >
                <h6 className="fw-bold text-dark mb-3">Previous Prescriptions</h6>

                {(() => {
                  const previousPrescriptions = employeeReport?.previousPrescriptions || [];

                  return previousPrescriptions.length > 0 ? (
                    previousPrescriptions.map((prescription, index) =>
                      renderPrescriptionHistoryCard(prescription, `report-panel-${index}`)
                    )
                  ) : (
                    <div className="text-muted">No previous prescriptions available</div>
                  );
                })()}

                <hr className="my-4" />

                <h6 className="fw-bold text-dark mb-3">Recent Tests</h6>

                {(() => {
                  const diagnosisRecords = employeeReport?.diagnosisRecords || [];
                  const recentTests = diagnosisRecords
                    .flatMap(record =>
                      (record?.Tests || []).map((test, index) => ({
                        key: `${record._id}-${test.Test_ID?._id || test.Test_ID || index}`,
                        record,
                        test,
                        reportDate: test?.Timestamp || getDiagnosisReportDate(record)
                      }))
                    )
                    .sort(
                      (a, b) => new Date(b.reportDate || 0) - new Date(a.reportDate || 0)
                    )
                    .slice(0, 5);

                  return recentTests.length > 0 ? (
                    recentTests.map(({ key, record, test, reportDate }) => {
                      const status = getReportStatus(test?.Result_Value);
                      const visitNotes = buildVisitNotes(record?.visitSummary);

                      return (
                        <div key={key} className="border-bottom pb-2 mb-3">
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <div>
                              <div className="fw-semibold">
                                {test?.Test_Name || test?.Test_ID?.Test_Name || "Unknown Test"}
                              </div>
                              <small className="text-muted">
                                {formatDateDMY(reportDate)}
                              </small>
                            </div>
                            <span className={`badge ${status === "result out" ? "bg-success" : "bg-warning text-dark"}`}>
                              {status}
                            </span>
                          </div>

                          <div className="small mt-2">
                            Result: {status === "result out" ? `${test?.Result_Value || "-"} ${test?.Units || test?.Test_ID?.Units || ""}`.trim() : "Pending"}
                          </div>

                          {visitNotes && (
                            <div className="small text-muted mt-1">
                              Notes: {visitNotes}
                            </div>
                          )}

                          {test?.Reports && test.Reports.length > 0 ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary mt-2 me-2 view-action"
                              onClick={() => setSelectedDiagnosisReport({ record, test })}
                            >
                              View Report
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-outline-secondary mt-2"
                              disabled
                            >
                              No Report
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-muted">No tests available</div>
                  );
                })()}

                <hr className="my-4" />

                <h6 className="fw-bold text-dark mb-3">Recent X-rays</h6>

                {(() => {
                  const xrayRecords = employeeReport?.xrayRecords || [];
                  const recentXrays = xrayRecords
                    .flatMap(record =>
                      (record?.Xrays || []).map((xray, index) => ({
                        key: `${record._id}-${xray.Xray_ID || xray.Xray_Type || index}`,
                        record,
                        xray,
                        reportDate: xray?.Timestamp || getXrayReportDate(record)
                      }))
                    )
                    .sort(
                      (a, b) => new Date(b.reportDate || 0) - new Date(a.reportDate || 0)
                    )
                    .filter(({ xray }) => {
                      // only show xrays where results are out
                      const status = xray?.Findings || xray?.Impression || xray?.Remarks ? "result out" : "pending";
                      return status === "result out";
                    })
                    .slice(0, 5);

                  return recentXrays.length > 0 ? (
                    recentXrays.map(({ key, record, xray, reportDate }) => {
                      const status =
                        xray?.Findings || xray?.Impression || xray?.Remarks
                          ? "result out"
                          : "pending";

                      return (
                        <div key={key} className="border-bottom pb-2 mb-3">
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <div>
                              <div className="fw-semibold">
                                {xray?.Xray_Type || "X-ray"}
                              </div>
                              <small className="text-muted">
                                {formatDateDMY(reportDate)}
                              </small>
                            </div>
                            <span className={`badge ${status === "result out" ? "bg-success" : "bg-warning text-dark"}`}>
                              {status}
                            </span>
                          </div>

                          <div className="small mt-2">
                            {xray?.Body_Part || "Body part not available"}
                          </div>

                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary mt-2 view-action"
                            disabled={status !== "result out"}
                            onClick={() => setSelectedXrayReport({ record, xray })}
                          >
                            View
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-muted">No X-rays available</div>
                  );
                })()}

                <hr className="my-4" />

                <h6 className="fw-bold text-dark mb-3">Diseases</h6>

                {(() => {
                  const allDiseases = employeeReport?.diseases || [];

                  const twoWeeksAgo = new Date();
                  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

                  const nonCommunicable = allDiseases.filter(
                    d => d.Category === "Non-Communicable"
                  );

                  const communicableRecent = allDiseases.filter(
                    d =>
                      d.Category === "Communicable" &&
                      new Date(d.createdAt) >= twoWeeksAgo
                  );

                  return (
                    <>
                      {nonCommunicable.map((d, index) => (
                        <div key={`nc-${index}`} className="border-bottom pb-2 mb-2">
                          <div className="fw-semibold text-secondary">
                            {d.Disease_Name}
                          </div>
                          <small className="text-muted">
                            {new Date(d.createdAt).toLocaleDateString("en-GB")}
                          </small>
                          <div>
                            <span className="badge bg-info mt-1">
                              {d.Severity_Level}
                            </span>
                          </div>
                        </div>
                      ))}

                      {communicableRecent.map((d, index) => (
                        <div key={`c-${index}`} className="border-bottom pb-2 mb-2">
                          <div className="fw-semibold text-danger">
                            {d.Disease_Name}
                          </div>
                          <small className="text-muted">
                            {new Date(d.createdAt).toLocaleDateString("en-GB")}
                          </small>
                          <div>
                            <span className="badge bg-danger mt-1">
                              {d.Severity_Level}
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>

            </div>
          </div>
        )}

        {/* X-ray single-item modal */}
        {selectedXrayReport && (
          <div className="modal fade show d-block" style={{ background: "rgba(15,23,42,0.28)", zIndex: 2050 }}>
            <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" style={{ zIndex: 2060, maxWidth: '90%' }}>
              <div className="modal-content">
                <div className="modal-header bg-primary text-white">
                  <h5 className="modal-title">X‑ray Detail</h5>
                  <button className="btn-close btn-close-white" onClick={() => setSelectedXrayReport(null)} />
                </div>

                <div className="modal-body p-0">
                  <ReportHtmlPreview
                    modulePath="xray-api"
                    report={selectedXrayReport}
                    title="X-ray report preview"
                  />
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => openXrayImageView(selectedXrayReport)}
                    disabled={!getXrayImageUrl(selectedXrayReport)}
                  >
                    View Image
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => downloadXrayReport(selectedXrayReport)}
                    disabled={downloadingXrayId === getXrayDownloadId(selectedXrayReport)}
                  >
                    {downloadingXrayId === getXrayDownloadId(selectedXrayReport) ? "Preparing..." : "Download Report"}
                  </button>
                  <button className="btn btn-outline-primary" onClick={() => setSelectedXrayReport(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedPrescriptionReport && (
          <div className="modal fade show d-block" style={{ background: "rgba(15,23,42,0.28)", zIndex: 2050 }}>
            <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" style={{ zIndex: 2060 }}>
              <div className="modal-content">
                <div className="modal-header bg-dark text-white d-flex justify-content-between align-items-center">
                  <div className="d-flex align-items-center gap-2">
                    <h5 className="modal-title mb-0">Prescription Report</h5>
                  </div>

                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => { setSelectedPrescriptionReport(null); }}
                  />
                </div>

                <div className="modal-body p-0">
                  <ReportHtmlPreview
                    modulePath="prescription-api"
                    report={selectedPrescriptionReport}
                    params={{
                      source: selectedPrescriptionReport?.Source || "",
                    }}
                    title="Prescription report preview"
                  />
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => downloadPrescriptionReport(selectedPrescriptionReport)}
                    disabled={downloadingPrescriptionId === getPrescriptionDownloadId(selectedPrescriptionReport)}
                  >
                    {downloadingPrescriptionId === getPrescriptionDownloadId(selectedPrescriptionReport) ? "Preparing..." : "Download Report"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => setSelectedPrescriptionReport(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FORM */}
        <div
          className={`mb-3 ${showReports ? "col-lg-6" : "col-lg-9"
            }`}
          style={{ transition: "all 0.4s ease" }}
        >

          <div className="card shadow border-0">
            <div className="card-header bg-dark text-white">
              <h5 className="mb-0">Doctor Prescription</h5>
            </div>

            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Institute</label>
                  <input className="form-control" value={instituteName} readOnly />
                </div>


                <PatientSelector
                  key={patientSelectorKey}
                  instituteId={formData.Institute_ID}
                  onSelect={async ({ employee, visit }) => {

                    setSelectedEmployee(employee);
                    setSelectedVisit(visit);
                    const isFamily = visit?.IsFamilyMember || false;
                    const familyId = visit?.FamilyMember?._id || null;

                    setFormData(prev => ({
                      ...prev,
                      Employee_ID: employee._id,
                      visit_id: visit?._id || null,
                      IsFamilyMember: isFamily,
                      FamilyMember_ID: familyId
                    }));

                    // Set visit vitals (read-only) and keep doctor's notes editable
                    if (visit) {
                      const patientProfile = isFamily ? visit.FamilyMember : employee;
                      const visitVitals = visit.Vitals || {};
                      const vitals = {
                        ...visitVitals,
                        Height: patientProfile?.Height || visitVitals.Height || "",
                        Weight: patientProfile?.Weight || visitVitals.Weight || "",
                        BMI: patientProfile?.BMI || visitVitals.BMI || ""
                      };
                      setFormData(prev => ({
                        ...prev,
                        Vitals: vitals,
                        // prefill Notes with symptoms only if there wasn't any existing note
                        Notes: prev.Notes || (visit.symptoms ? `Symptoms: ${visit.symptoms}` : "")
                      }));
                    }

                    // 🔥 FETCH HISTORY AND CHECK FOR EXISTING PRESCRIPTION
                    try {
                      // Fetch all medical actions for this employee
                      const actionsRes = await axios.get(`${BACKEND_URL}/api/medical-actions/employee/${employee._id}`);
                      const actions = actionsRes.data || [];

                      // Filter to get prescriptions for this specific visit
                      const existingPrescription = actions.find(action =>
                        action.action_type === "DOCTOR_PRESCRIPTION" &&
                        action.visit_id === visit?._id &&
                        (isFamily ? action.data?.FamilyMember_ID === familyId : !action.data?.FamilyMember_ID)
                      );

                      if (existingPrescription && existingPrescription.data) {
                        // Pre-fill form with existing prescription data
                        const prescriptionData = existingPrescription.data;

                        setFormData(prev => ({
                          ...prev,
                          Medicines: prescriptionData.medicines && prescriptionData.medicines.length > 0
                            ? prescriptionData.medicines.map(med => ({
                              Medicine_Name: med.Medicine_Name || "",
                              Medicine_Type: med.Medicine_Type || med.Type || "",
                              Dosage_Form: med.Dosage_Form || "",
                              Type: med.Medicine_Type || med.Type || "",
                              FoodTiming: med.FoodTiming || "",
                              Strength: med.Strength || "",
                              Morning: med.Morning || false,
                              Afternoon: med.Afternoon || false,
                              Night: med.Night || false,
                              Duration: med.Duration || "",
                              Remarks: med.Remarks || "",
                              Quantity: med.Quantity || 0,
                              ToBePrescribed: med.ToBePrescribed || med.toBePrescribed || med.IsToBePrescribed || false,
                              toBePrescribed: med.ToBePrescribed || med.toBePrescribed || med.IsToBePrescribed || false,
                              IsToBePrescribed: med.ToBePrescribed || med.toBePrescribed || med.IsToBePrescribed || false
                            }))
                            : [{ Medicine_Name: "", Medicine_Type: "", Dosage_Form: "", Type: "", FoodTiming: "", Strength: "", Morning: false, Afternoon: false, Night: false, Duration: "", Remarks: "", Quantity: 0, ToBePrescribed: false, toBePrescribed: false, IsToBePrescribed: false }],
                          Notes: prescriptionData.notes || prev.Notes
                        }));
                      }
                    } catch (err) {
                      console.error("Error loading existing prescription:", err);
                    }

                    // Fetch prescription history for sidebar
                    fetchTopTwoPrescriptions(employee._id, familyId);
                  }}
                />
                {selectedVisit && (
                  <div className="alert alert-info mt-3 d-flex justify-content-between align-items-center">
                    <div>
                      <strong>
                        Token {selectedVisit.token_no} —
                      </strong>{" "}
                      {selectedVisit.IsFamilyMember
                        ? `${selectedVisit.FamilyMember?.Name} (${selectedVisit.FamilyMember?.Relationship})`
                        : selectedVisit.employee_id?.Name}
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary view-action"
                      onClick={loadEmployeeReports}
                    >
                      View Reports
                    </button>
                  </div>
                )}

                {communicableRecent.length > 0 && (
                  <div className="alert alert-warning">
                    <strong>Disease History (Reference Only)</strong>
                    <ul className="mb-0 mt-2">
                      {communicableRecent.map((d, i) => (
                        <li key={i}>{d.Disease_Name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <h6 className="fw-bold" style={{ marginTop: "20px" }}>Disease</h6>

                <div className="row g-3 mt-2">

                  {/* Category */}
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Category</label>
                    <select
                      className="form-select"
                      value={diseaseData.Category}
                      onChange={(e) => {
                        setDiseaseData(prev => ({
                          ...prev,
                          Category: e.target.value,
                          Disease_Name: ""
                        }));
                        setShowOtherDiseaseInput(false);
                      }}
                    >
                      {diseaseCategoryOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>

                  {/* Disease Name */}
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Disease Name</label>

                    <div className="position-relative">

                      {/* ✅ INPUT FIELD (YOU MISSED THIS) */}
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Search disease..."
                        value={diseaseSearch}
                        onChange={(e) => {
                          setDiseaseSearch(e.target.value);
                        }}
                        onFocus={() => setShowDiseaseDropdown(true)}
                        onBlur={() => {
                          // Delay hiding to allow click on dropdown items
                          setTimeout(() => setShowDiseaseDropdown(false), 200);
                        }}
                      />

                      {/* ✅ SUGGESTIONS */}
                      {showDiseaseDropdown && filteredDiseases.length > 0 && (
                        <ul
                          className="list-group position-absolute w-100"
                          style={{ zIndex: 1000, maxHeight: "200px", overflowY: "auto" }}
                        >
                          {filteredDiseases.map((d, i) => (
                            <li
                              key={i}
                              className="list-group-item list-group-item-action"
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                setDiseaseSearch(d.name);
                                setDiseaseData(prev => ({
                                  ...prev,
                                  Disease_Name: d.name
                                }));
                                setFilteredDiseases([]);
                                setShowDiseaseDropdown(false);
                              }}
                            >
                              {/* 🔥 FINAL FORMAT */}
                              {d.subgroup
                                ? `${d.type} - ${d.subgroup} - ${d.name}`
                                : `${d.type} - ${d.name}`}
                            </li>
                          ))}
                        </ul>
                      )}

                    </div>
                  </div>

                  {/* Severity */}
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Severity</label>
                    <select
                      className="form-select"
                      value={diseaseData.Severity_Level}
                      onChange={(e) =>
                        setDiseaseData(prev => ({
                          ...prev,
                          Severity_Level: e.target.value
                        }))
                      }
                    >
                      {effectiveDiseaseSeverityOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Other Disease Input */}
                {showOtherDiseaseInput && (
                  <div className="mt-3">
                    <input
                      className="form-control"
                      placeholder="Enter disease name"
                      value={diseaseData.Disease_Name}
                      onChange={(e) =>
                        setDiseaseData(prev => ({
                          ...prev,
                          Disease_Name: e.target.value
                        }))
                      }
                    />
                  </div>
                )}

                <div className="row g-3 mt-3">
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Vitals</label>
                    <div className="border rounded p-3 bg-light" style={{ minHeight: "160px", whiteSpace: "pre-wrap" }}>
                      <div><strong>Symptoms:</strong> {selectedVisit?.symptoms || "—"}</div>
                      <div><strong>Temperature:</strong> {(formData.Vitals?.Temperature ?? "") !== "" ? `${formData.Vitals.Temperature}°F` : "—"}</div>
                      <div><strong>BP:</strong> {formData.Vitals?.Blood_Pressure || "—"}</div>
                      <div><strong>Pulse:</strong> {formData.Vitals?.Pulse || "—"}</div>
                      <div><strong>Oxygen:</strong> {formData.Vitals?.Oxygen || "—"}</div>
                      <div><strong>GRBS:</strong> {formData.Vitals?.GRBS || "—"}</div>
                      <div><strong>Height:</strong> {formData.Vitals?.Height ? `${formData.Vitals.Height} cm` : "—"}</div>
                      <div><strong>Weight:</strong> {formData.Vitals?.Weight ? `${formData.Vitals.Weight} kg` : "—"}</div>
                      <div><strong>BMI:</strong> {formData.Vitals?.BMI || "—"}</div>
                    </div>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Notes</label>
                    <textarea
                      ref={notesTextareaRef}
                      className="form-control"
                      rows="6"
                      value={formData.Notes}
                      style={{ minHeight: "160px", resize: "none", overflow: "hidden" }}
                      onChange={(e) =>
                        setFormData((f) => ({ ...f, Notes: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <h6 className="fw-bold mt-4">Medicines</h6>

                {formData.Medicines.map((med, i) => (
                  <div key={med._uid || i} className="mb-4 border rounded p-3 bg-light">
                    {!med.ToBePrescribed && (
                      <div className="mb-3 position-relative" ref={(el) => { quickMedicineSearchRefs.current[i] = el; }}>
                        <label className="form-label fw-semibold">Quick Medicine Search</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Search medicine by name"
                          value={quickMedicineSearches[i] ?? ""}
                          onFocus={() => {
                            setQuickMedicineSearchOpen((prev) => {
                              const next = [...prev];
                              next[i] = true;
                              return next;
                            });
                          }}
                          onChange={(e) => {
                            const value = e.target.value;
                            setQuickMedicineSearches((prev) => {
                              const next = [...prev];
                              next[i] = value;
                              return next;
                            });
                            setQuickMedicineSearchOpen((prev) => {
                              const next = [...prev];
                              next[i] = true;
                              return next;
                            });
                            if (!value.trim()) {
                              resetMedicineRow(i);
                            }
                          }}
                        />

                        {quickMedicineSearchOpen[i] && (
                          <div className="border rounded bg-white shadow-sm mt-1 position-relative" style={{ maxHeight: "220px", overflowY: "auto", zIndex: 15 }}>
                            {getQuickMedicineOptionsForRow(i).length > 0 ? (
                              getQuickMedicineOptionsForRow(i).map((item, optionIndex) => {
                                const isSelected =
                                  normalizeSearchText(item.Medicine_Name || item.value_name) === normalizeSearchText(formData.Medicines[i]?.Medicine_Name) &&
                                  normalizeSearchText(item.Medicine_Type || item.medicineType) === normalizeSearchText(formData.Medicines[i]?.Medicine_Type || formData.Medicines[i]?.Type) &&
                                  normalizeSearchText(item.Dosage_Form || item.dosageForm) === normalizeSearchText(formData.Medicines[i]?.Dosage_Form) &&
                                  normalizeSearchText(item.Strength || item.strength) === normalizeSearchText(formData.Medicines[i]?.Strength);

                                return (
                                  <button
                                    key={`${item.Medicine_Name || item.value_name || optionIndex}-${item.Strength || item.strength || "no-strength"}-${item.Dosage_Form || item.dosageForm || "no-form"}-${item.Medicine_Type || item.medicineType || "no-type"}`}
                                    type="button"
                                    className={`d-block text-start w-100 border-0 px-3 py-2 ${isSelected ? "bg-primary text-white" : "bg-white"}`}
                                    style={{ borderBottom: optionIndex < getQuickMedicineOptionsForRow(i).length - 1 ? "1px solid #f1f1f1" : "none" }}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applyQuickMedicineSelection(i, item)}
                                  >
                                    <div className="fw-semibold fs-6">{item.Medicine_Name || item.value_name || "Unnamed medicine"}</div>
                                    <div className="small mt-1 d-flex flex-wrap gap-2 align-items-center">
                                      <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                        {item.Strength || item.strength || "No strength"}
                                      </span>
                                      <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                        {item.Dosage_Form || item.dosageForm || "No dosage form"}
                                      </span>
                                      <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                        {item.Medicine_Type || item.medicineType || "No type"}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })
                            ) : (
                              <div className="px-3 py-2 text-muted small">No medicines found.</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* First Row: Medicine Selection */}
                    <div className="row g-2 align-items-end mb-3">
                      <div className="col-md-2">
                        <label className="form-label fw-semibold">To Be Prescribed</label>
                        <div className="form-check d-flex align-items-center h-100">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            id={`toBePrescribed-${i}`}
                            checked={med.ToBePrescribed || med.toBePrescribed || med.IsToBePrescribed || false}
                            onChange={(e) => {
                              const copy = [...formData.Medicines];
                              copy[i].ToBePrescribed = e.target.checked;
                              copy[i].toBePrescribed = e.target.checked;
                              copy[i].IsToBePrescribed = e.target.checked;
                              setFormData(prev => ({ ...prev, Medicines: copy }));
                            }}
                          />
                          <label className="form-check-label ms-2" htmlFor={`toBePrescribed-${i}`}>
                            Yes
                          </label>
                        </div>
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Medicine Type</label>
                        <select
                          className="form-select"
                          value={med.Medicine_Type}
                          disabled={med.ToBePrescribed}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].Medicine_Type = e.target.value;
                            copy[i].Type = e.target.value;
                            copy[i].Dosage_Form = "";
                            const allowedMedicines = getMedicineOptionsByType(copy[i].Medicine_Type, copy[i].Dosage_Form);
                            if (!allowedMedicines.includes(copy[i].Medicine_Name)) {
                              copy[i].Medicine_Name = "";
                              copy[i].Strength = "";
                            }
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        >
                          <option value="">
                            {med.ToBePrescribed ? "Disabled (Manual Entry)" : "Select Type"}
                          </option>
                          {medicineTypeOptions.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Dosage Form</label>
                        <select
                          className="form-select"
                          value={med.Dosage_Form}
                          disabled={!med.Medicine_Type || med.ToBePrescribed}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].Dosage_Form = e.target.value;
                            const allowedMedicines = getMedicineOptionsByType(copy[i].Medicine_Type, copy[i].Dosage_Form);
                            if (!allowedMedicines.includes(copy[i].Medicine_Name)) {
                              copy[i].Medicine_Name = "";
                              copy[i].Strength = "";
                            }
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        >
                          <option value="">
                            {med.ToBePrescribed
                              ? "Disabled (Manual Entry)"
                              : med.Medicine_Type
                                ? "Select Dosage Form"
                                : "Select Medicine Type First"
                            }
                          </option>
                          {dosageFormOptions.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Medicine</label>
                        {med.ToBePrescribed ? (
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Type medicine name"
                            value={med.Medicine_Name}
                            onChange={(e) => {
                              const copy = [...formData.Medicines];
                              copy[i].Medicine_Name = e.target.value;
                              setFormData(prev => ({ ...prev, Medicines: copy }));
                            }}
                          />
                        ) : (
                          <select
                            className="form-select"
                            value={med.Medicine_Name}
                            disabled={!med.Medicine_Type}
                            onChange={(e) => {
                              const copy = [...formData.Medicines];
                              copy[i].Medicine_Name = e.target.value;
                              if (!getStrengthOptions(e.target.value, copy[i].Medicine_Type, copy[i].Dosage_Form).includes(copy[i].Strength)) {
                                copy[i].Strength = "";
                              }
                              setFormData(prev => ({ ...prev, Medicines: copy }));
                            }}
                          >
                            <option value="">{med.Medicine_Type ? "Select Medicine" : "Select Medicine Type First"}</option>
                            {getMedicineOptionsByType(med.Medicine_Type, med.Dosage_Form).map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Food Timing</label>
                        <select
                          className="form-select"
                          value={med.FoodTiming}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].FoodTiming = e.target.value;
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        >
                          <option value="">Select Timing</option>
                          {foodTimingOptions.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Strength</label>
                        {med.ToBePrescribed ? (
                          <input
                            type="text"
                            className="form-control"
                            placeholder="e.g., 500mg, 5ml"
                            value={med.Strength || ""}
                            onChange={(e) => {
                              const copy = [...formData.Medicines];
                              copy[i].Strength = e.target.value;
                              setFormData(prev => ({ ...prev, Medicines: copy }));
                            }}
                          />
                        ) : (
                          <select
                            className="form-select"
                            value={med.Strength || ""}
                            disabled={!med.Medicine_Name}
                            onChange={(e) => {
                              const copy = [...formData.Medicines];
                              copy[i].Strength = e.target.value;
                              setFormData(prev => ({ ...prev, Medicines: copy }));
                            }}
                          >
                            <option value="">
                              {getStrengthOptions(med.Medicine_Name, med.Medicine_Type, med.Dosage_Form).length > 0
                                ? "Select Strength"
                                : "Not specified"}
                            </option>
                            {getStrengthOptions(med.Medicine_Name, med.Medicine_Type, med.Dosage_Form).map((strength, idx) => (
                              <option key={`${med._uid || i}-str-${idx}`} value={strength}>
                                {strength}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Second Row: Dosage Details */}
                    <div className="row g-2 align-items-end">
                      <div className="col-md-4">
                        <label className="form-label fw-semibold">Dosage Times</label>
                        <div className="d-flex gap-3 mt-2">
                          <div className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              id={`morning-${i}`}
                              checked={med.Morning}
                              onChange={(e) => {
                                const copy = [...formData.Medicines];
                                copy[i].Morning = e.target.checked;
                                copy[i].Quantity = calculateQuantity(copy[i].Morning, copy[i].Afternoon, copy[i].Night, copy[i].Duration);
                                setFormData(prev => ({ ...prev, Medicines: copy }));
                              }}
                            />
                            <label className="form-check-label" htmlFor={`morning-${i}`}>
                              Morning
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              id={`afternoon-${i}`}
                              checked={med.Afternoon}
                              onChange={(e) => {
                                const copy = [...formData.Medicines];
                                copy[i].Afternoon = e.target.checked;
                                copy[i].Quantity = calculateQuantity(copy[i].Morning, copy[i].Afternoon, copy[i].Night, copy[i].Duration);
                                setFormData(prev => ({ ...prev, Medicines: copy }));
                              }}
                            />
                            <label className="form-check-label" htmlFor={`afternoon-${i}`}>
                              Afternoon
                            </label>
                          </div>
                          <div className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              id={`night-${i}`}
                              checked={med.Night}
                              onChange={(e) => {
                                const copy = [...formData.Medicines];
                                copy[i].Night = e.target.checked;
                                copy[i].Quantity = calculateQuantity(copy[i].Morning, copy[i].Afternoon, copy[i].Night, copy[i].Duration);
                                setFormData(prev => ({ ...prev, Medicines: copy }));
                              }}
                            />
                            <label className="form-check-label" htmlFor={`night-${i}`}>
                              Night
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="col-md-2">
                        <label className="form-label fw-semibold">Duration</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="5 days"
                          value={med.Duration}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].Duration = e.target.value;
                            copy[i].Quantity = calculateQuantity(copy[i].Morning, copy[i].Afternoon, copy[i].Night, e.target.value);
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        />
                      </div>

                      <div className="col-md-3">
                        <label className="form-label fw-semibold">Remarks</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Doctor's remarks"
                          value={med.Remarks}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].Remarks = e.target.value;
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        />
                      </div>

                      <div className="col-md-1">
                        <label className="form-label fw-semibold">Quantity</label>
                        <input
                          type="number"
                          className="form-control"
                          min="0"
                          value={med.Quantity}
                          onChange={(e) => {
                            const copy = [...formData.Medicines];
                            copy[i].Quantity = Number(e.target.value) || 0;
                            setFormData(prev => ({ ...prev, Medicines: copy }));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn btn-outline-primary mt-2"
                  onClick={addMedicine}
                >
                  + Add Medicine
                </button>

                <button
                  type="submit"
                  className="btn btn-dark w-100 mt-4"
                  disabled={isSubmittingPrescription}
                >
                  {isSubmittingPrescription ? "Submitting..." : "Submit Prescription"}
                </button>
              </form>
            </div>
          </div>
        </div>
        <div className="col-lg-3">
          {(selectedEmployee || selectedVisit) && (
            <div className="card shadow border-0 mb-3">
              <div className="card-header bg-secondary text-white">
                <strong>Patient Profile</strong>
              </div>
              <div className="card-body py-3 px-3">
                <div className="d-flex gap-3 align-items-start">
                  <img
                    src={resolveProfileImageUrl(
                      selectedVisit?.IsFamilyMember
                        ? selectedVisit?.FamilyMember?.Photo
                        : selectedEmployee?.Photo || selectedVisit?.employee_id?.Photo
                    )}
                    alt="Patient"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = FALLBACK_PROFILE_IMAGE;
                    }}
                    style={{
                      width: "140px",
                      height: "140px",
                      borderRadius: "14px",
                      objectFit: "cover",
                      objectPosition: "center",
                      border: "1px solid rgba(191,219,254,0.9)",
                      boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
                      background: "rgba(255,255,255,0.92)",
                      flexShrink: 0,
                      marginRight: "14px"
                    }}
                  />
                  <div className="small" style={{ color: "#1F2933", minWidth: 0 }}>
                    <div className="fw-semibold mb-2" style={{ fontSize: "14px", wordBreak: "break-word" }}>
                      {selectedPatientName}
                    </div>
                    <div className="mb-1"><strong>ABS No:</strong> {selectedPatientAbsNo}</div>
                    <div className="mb-1"><strong>Blood Group:</strong> {selectedPatientBloodGroup}</div>
                    <div className="mb-1"><strong>Gender:</strong> {selectedPatientGender}</div>
                    <div className="mb-1"><strong>Age:</strong> {selectedPatientAge}</div>
                    <div><strong>Last Visit:</strong> {selectedPatientLastVisit}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Previous 2 Prescriptions */}
          {lastTwoVisits.length > 0 && (
            <div className="card shadow border-0 mb-3">
              <div className="card-header bg-secondary text-white">
                <strong>Previous 2 Prescriptions</strong>
              </div>

              <div className="card-body">
                {lastTwoVisits.map((prescription, index) =>
                  renderPrescriptionHistoryCard(prescription, `sidebar-${index}`)
                )}
              </div>
            </div>
          )}

          {/* 🔥 ADD A TEST CARD */}
          <div className="card shadow border-0">
            <div className="card-header bg-dark text-white">
              <strong>Add a Test</strong>
            </div>


            <div className="card-body">
              {diagnosisData.Tests.map((t, i) => {
                const panel = t.Panel_ID ? getDiagnosticPanelById(t.Panel_ID) : null;
                const panelSummary = panel
                  ? (panel.tests || [])
                    .map((panelTest, index) => `${index + 1}. ${String(panelTest?.test_name || panelTest?.name || "").trim()}`)
                    .filter((line) => !line.endsWith(". "))
                  : [];

                return (
                  <div key={i} className="border rounded p-3 mb-3 bg-light">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h6 className="mb-0">Test #{i + 1}</h6>
                      {diagnosisData.Tests.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => {
                            const copy = diagnosisData.Tests.filter((_, idx) => idx !== i);
                            setDiagnosisData((prev) => ({
                              ...prev,
                              Tests: copy
                            }));
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="row g-3">
                      <div className="col-md-12">
                        <label className="form-label fw-semibold">Select Panel</label>
                        <select
                          className="form-select"
                          value={t.Panel_ID || ""}
                          onChange={(e) => {
                            const panelId = e.target.value;
                            if (!panelId) {
                              clearDiagnosisRowPanel(i);
                              return;
                            }
                            applyPanelToDiagnosisRow(i, panelId);
                          }}
                        >
                          <option value="">No panel selected</option>
                          {(diagnosticPanels || []).map((panelItem) => (
                            <option key={panelItem._id || panelItem.id} value={panelItem._id || panelItem.id}>
                              {panelItem.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {panel ? (
                        <div className="col-md-12">
                          <label className="form-label fw-semibold mb-2">Panel tests</label>
                          <textarea
                            className="form-control"
                            rows={Math.min(8, Math.max(3, panelSummary.length || 3))}
                            value={panelSummary.join("\n")}
                            readOnly
                          />
                        </div>
                      ) : (
                        <>
                          <div className="col-md-6">
                            <label className="form-label fw-semibold">Category</label>
                            <select
                              className="form-select"
                              value={t.Category || ""}
                              onChange={(e) => {
                                const copy = [...diagnosisData.Tests];
                                copy[i] = {
                                  ...(copy[i] || createEmptyDiagnosisTest()),
                                  Category: e.target.value,
                                  Test_ID: "",
                                  Test_Name: "",
                                  test_id: "",
                                  test_name: ""
                                };

                                setDiagnosisData((prev) => ({
                                  ...prev,
                                  Tests: copy
                                }));
                              }}
                            >
                              <option value="">Select Category</option>
                              {testCategoryOptions.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-md-6">
                            <label className="form-label fw-semibold">Test Name</label>
                            <select
                              className="form-select"
                              value={t.Test_ID || t.Test_Name || ""}
                              disabled={!t.Category || testsLoading}
                              onChange={(e) => {
                                const list = t.Category && testsByCategory[t.Category] ? testsByCategory[t.Category] : [];
                                const found = list.find((x) => String(x._id || "") === String(e.target.value));

                                const copy = [...diagnosisData.Tests];
                                if (found) {
                                  copy[i] = {
                                    ...(copy[i] || createEmptyDiagnosisTest()),
                                    Test_ID: found._id || "",
                                    Test_Name: found.name || "",
                                    test_id: found._id || "",
                                    test_name: found.name || ""
                                  };
                                } else {
                                  copy[i] = {
                                    ...(copy[i] || createEmptyDiagnosisTest()),
                                    Test_ID: "",
                                    Test_Name: e.target.value || "",
                                    test_id: "",
                                    test_name: e.target.value || ""
                                  };
                                }

                                setDiagnosisData((prev) => ({ ...prev, Tests: copy }));
                              }}
                            >
                              <option value="">{testsLoading ? "Loading tests..." : "Select Test"}</option>
                              {(testsByCategory[t.Category] || []).map((test) => (
                                <option key={`${t.Category}-${test._id || test.name}`} value={test._id || test.name}>
                                  {test.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                className="btn btn-outline-primary w-100 mt-2"
                onClick={() =>
                  setDiagnosisData((prev) => ({
                    ...prev,
                    Tests: [...prev.Tests, createEmptyDiagnosisTest()]
                  }))
                }
              >
                + Add Test
              </button>

              <button
                type="button"
                className="btn btn-success w-100 mt-3"
                onClick={handleDiagnosisSubmit}
              >
                Submit Test
              </button>

            </div>
          </div>
          {/* ADD AN XRAY CARD */}
          <div className="card shadow border-0 mt-3">
            <div className="card-header bg-dark text-white">
              <strong>Add an X-ray</strong>
            </div>

            <div className="card-body">

              {xrayData.Xrays.map((x, i) => (
                <div key={i} className="mb-2">
                  <div className="row g-2 align-items-end">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Body Part</label>
                      <select
                        className="form-select"
                        value={x.Body_Part || ""}
                        onChange={(e) => {
                          const selectedBodyPart = e.target.value;
                          const copy = [...xrayData.Xrays];
                          copy[i] = {
                            ...copy[i],
                            Body_Part: selectedBodyPart,
                            Xray_ID: "",
                            Xray_Type: ""
                          };
                          setXrayData(prev => ({
                            ...prev,
                            Xrays: copy
                          }));
                        }}
                      >
                        <option value="">Select body part</option>
                        {xrayBodyPartOptions.map((part) => (
                          <option key={part} value={part}>
                            {part}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-md-8">
                      <label className="form-label fw-semibold">X-ray Selection</label>
                      <select
                        className="form-select"
                        value={x.Xray_ID || getXrayOptionValue(x)}
                        onChange={(e) => {
                          const selected = getXrayOptionsByBodyPart(x.Body_Part).find(
                            (xr) => getXrayOptionValue(xr) === e.target.value
                          ) || xrayMaster.find(
                            (xr) => getXrayOptionValue(xr) === e.target.value
                          );

                          const copy = [...xrayData.Xrays];
                          copy[i] = {
                            ...copy[i],
                            Body_Part: selected?.Body_Part || copy[i].Body_Part || "",
                            Xray_ID: selected?._id || "",
                            Xray_Type: selected?.Xray_Type || ""
                          };

                          setXrayData(prev => ({
                            ...prev,
                            Xrays: copy
                          }));
                        }}
                        disabled={!x.Body_Part}
                      >
                        <option value="">{x.Body_Part ? "Select X-ray test" : "Select body part first"}</option>
                        {getXrayOptionsByBodyPart(x.Body_Part).map(xr => (
                          <option key={getXrayOptionValue(xr)} value={getXrayOptionValue(xr)}>
                            {xr.Xray_Type}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {xrayData.Xrays.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger w-100"
                      onClick={() => {
                        const copy = xrayData.Xrays.filter(
                          (_, idx) => idx !== i
                        );
                        setXrayData(prev => ({
                          ...prev,
                          Xrays: copy
                        }));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                className="btn btn-outline-primary w-100 mt-2"
                onClick={() =>
                  setXrayData(prev => ({
                    ...prev,
                    Xrays: [
                      ...prev.Xrays,
                      { Body_Part: "", Xray_ID: "", Xray_Type: "" }
                    ]
                  }))
                }
              >
                + Add X-ray
              </button>

              <button
                type="button"
                className="btn btn-success w-100 mt-3"
                onClick={handleXraySubmit}
              >
                Submit X-ray
              </button>

            </div>
          </div>

        </div>

      </div>
      {selectedDiagnosisReport && (
        <div
          className="modal fade show d-block"
          style={{ background: "rgba(15,23,42,0.28)" }}
        >
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">Diagnosis Report</h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setSelectedDiagnosisReport(null)}
                />
              </div>

              <div className="modal-body p-0">
                <ReportHtmlPreview
                  modulePath="diagnosis-api"
                  report={selectedDiagnosisReport}
                  title="Diagnosis report preview"
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => openDiagnosisImageView(selectedDiagnosisReport)}
                  disabled={!getDiagnosisImageUrl(selectedDiagnosisReport)}
                >
                  View Image
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadDiagnosisReport(selectedDiagnosisReport)}
                  disabled={downloadingDiagnosisId === getDiagnosisDownloadId(selectedDiagnosisReport)}
                >
                  {downloadingDiagnosisId === getDiagnosisDownloadId(selectedDiagnosisReport) ? "Preparing..." : "Download Report"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => setSelectedDiagnosisReport(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedXrayReport && (
        <div
          className="modal fade show d-block"
          style={{ background: "rgba(15,23,42,0.28)" }}
        >
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">X-ray Report</h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setSelectedXrayReport(null)}
                />
              </div>

              <div className="modal-body p-0">
                <ReportHtmlPreview
                  modulePath="xray-api"
                  report={selectedXrayReport}
                  title="X-ray report preview"
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => openXrayImageView(selectedXrayReport)}
                  disabled={!getXrayImageUrl(selectedXrayReport)}
                >
                  View Image
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => downloadXrayReport(selectedXrayReport)}
                  disabled={downloadingXrayId === getXrayDownloadId(selectedXrayReport)}
                >
                  {downloadingXrayId === getXrayDownloadId(selectedXrayReport) ? "Preparing..." : "Download Report"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => setSelectedXrayReport(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorPrescriptionForm;
