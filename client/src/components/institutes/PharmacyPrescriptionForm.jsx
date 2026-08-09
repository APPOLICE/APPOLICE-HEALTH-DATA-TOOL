import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import PatientSelector from "../institutes/PatientSelector";
import "./PharmacyPrescriptionForm.css";
import "./InstitutesTheme.css";
import { useNavigate } from "react-router-dom";
import { fetchMasterDataMap, getMasterMedicinesByTypeAndForm, getMasterOptions, getMasterMedicineEntries } from "../../utils/masterData_clean";

const { useMemo } = React;

const PharmacyPrescriptionForm = () => {                       
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const FALLBACK_PROFILE_IMAGE = "/profile-fallback.png";
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [visitId, setVisitId] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [instituteName, setInstituteName] = useState("");
  const [diseases, setDiseases] = useState([]);
  const [medicineErrors, setMedicineErrors] = useState({});
  const [doctorPrescription, setDoctorPrescription] = useState([]);
  const [lastTwoVisits, setLastTwoVisits] = useState([]);
  const [showDoctorPrescription, setShowDoctorPrescription] = useState(true);
  const [filteredDoctorPrescription, setFilteredDoctorPrescription] = useState([]);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [employeeReport, setEmployeeReport] = useState(null);
  const [showReports, setShowReports] = useState(false);
  const [masterMap, setMasterMap] = useState({});
  const [showDoctorNotes, setShowDoctorNotes] = useState({});

  const resolveProfileImageUrl = (photoPath) => {
    if (!photoPath) return FALLBACK_PROFILE_IMAGE;
    if (/^https?:\/\//i.test(photoPath)) return photoPath;
    const base = String(BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(photoPath).replace(/^\/+/, "")}`;
  };

  const medicineTypeOptions = getMasterOptions(masterMap, "Medicine Types");
  const dosageFormOptions = getMasterOptions(masterMap, "Dosage Forms");

  const normalizeText = (value) => String(value || "").trim().toLowerCase();
  const getInventoryMedicineType = (item) => item?.Medicine_Type || item?.Type || "";
  const getInventoryDosageForm = (item) => item?.Dosage_Form || item?.dosageForm || "";
  const getMedicineOptionValue = (medicine) => {
    if (medicine?.medicineId) return `code::${medicine.medicineId}`;
    if (medicine?.medicineName) return `name::${medicine.medicineName}`;
    return "";
  };

  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    Institute_ID: "",
    Employee_ID: "",
    IsFamilyMember: false,
    FamilyMember_ID: "",
    Medicines: [{ medicineId: "", medicineName: "", medicineType: "", dosageForm: "", type: "", strength: "", expiryDate: "", quantity: 0 }],
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

  const getQuickMedicineCandidates = () => {
    const masterEntries = Array.isArray(getMasterMedicineEntries(masterMap)) ? getMasterMedicineEntries(masterMap) : [];
    const masterCandidates = masterEntries.map((entry) => ({
      Medicine_Name: entry.value_name,
      Medicine_Type: entry.medicineType,
      Dosage_Form: entry.dosageForm,
      Strength: entry.strength,
      source: "master"
    }));

    const inventoryCandidates = (inventory || []).map((item) => ({
      Medicine_Name: item.Medicine_Name,
      Medicine_Type: item.Medicine_Type || item.Type || "",
      Dosage_Form: item.Dosage_Form || item.dosageForm || "",
      Strength: item.Strength || "",
      source: "inventory",
      raw: item
    }));

    const all = [...inventoryCandidates, ...masterCandidates];
    const unique = [];
    const seen = new Set();

    all.forEach((item) => {
      const key = `${normalizeSearchText(item.Medicine_Name)}|${normalizeSearchText(item.Medicine_Type)}|${normalizeSearchText(item.Dosage_Form)}|${normalizeSearchText(item.Strength)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    });

    return unique.length ? unique : SAMPLE_MEDICINES;
  };

  const getQuickMedicineOptionsForRow = (index) => {
    const typedValue = normalizeSearchText(quickMedicineSearches[index]);
    const allMedicines = getQuickMedicineCandidates();
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
      const next = [...prev.Medicines];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        medicineId: "",
        medicineName: "",
        medicineType: "",
        type: "",
        dosageForm: "",
        strength: "",
        expiryDate: ""
      };
      return { ...prev, Medicines: next };
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

    const matchedInventory = (inventory || []).find((item) =>
      normalizeSearchText(item.Medicine_Name) === normalizeSearchText(selectedMedicine.Medicine_Name) &&
      normalizeSearchText(item.Medicine_Type || item.Type) === normalizeSearchText(selectedMedicine.Medicine_Type) &&
      normalizeSearchText(item.Medicine_Form || item.Dosage_Form || item.dosageForm) === normalizeSearchText(selectedMedicine.Dosage_Form) &&
      normalizeSearchText(item.Strength) === normalizeSearchText(selectedMedicine.Strength)
    );

    const selected = matchedInventory || selectedMedicine;
    const medicineName = String(selected.Medicine_Name || selected.name || "").trim();
    const medicineType = String(selected.Medicine_Type || selected.Type || selected.medicineType || "").trim();
    const dosageForm = String(selected.Dosage_Form || selected.dosageForm || selected.Dosage_Form || "").trim();
    const strength = String(selected.Strength || selected.strength || "").trim();
    const medicineId = matchedInventory ? String(matchedInventory.Medicine_Code || "") : "";
    const expiryDate = matchedInventory ? matchedInventory.Expiry_Date : "";

    setFormData((prev) => {
      const next = [...prev.Medicines];
      if (!next[index]) next[index] = { medicineId: "", medicineName: "", medicineType: "", dosageForm: "", type: "", strength: "", expiryDate: "", quantity: 0 };
      next[index] = {
        ...next[index],
        medicineId,
        medicineName,
        medicineType,
        type: medicineType,
        dosageForm,
        strength,
        expiryDate
      };
      return { ...prev, Medicines: next };
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

  // Build options for medicine select combining inventory and master data
  const getPharmacyOptionsByTypeAndForm = (medicineTypeValue, dosageFormValue) => {
    const typeKey = normalizeText(medicineTypeValue);
    if (!typeKey) return [];

    const formKey = normalizeText(dosageFormValue);

    const masterEntries = getMasterMedicinesByTypeAndForm(masterMap, medicineTypeValue, dosageFormValue);
    const masterNames = masterEntries.map((e) => ({ name: e.value_name, strength: e.strength || "" }));

    const inventoryByForm = (inventory || []).filter((item) => {
      if (!typeKey) return false;
      if (normalizeText(getInventoryMedicineType(item)) !== typeKey) return false;
      if (!formKey) return true;
      const inventoryForm = normalizeText(getInventoryDosageForm(item));
      return !inventoryForm || inventoryForm === formKey;
    });

    const options = [];
    // Add inventory options first
    inventoryByForm.forEach((item) => {
      options.push({
        value: `code::${item.Medicine_Code}`,
        label: `${item.Medicine_Name}${item.Strength ? ` (${item.Strength})` : ""}${item.Expiry_Date ? ` - Exp ${formatExpiryMY(item.Expiry_Date)}` : ""} - Stock ${item.Quantity || 0}`,
        kind: "inventory",
        inventory: item
      });
    });

    // If no inventory entries, expose master entries as options
    if (!inventoryByForm.length) {
      masterNames.forEach((m) => {
        options.push({ value: `name::${m.name}`, label: `${m.name}${m.strength ? ` (${m.strength})` : ""} - Not in stock`, kind: "master", master: m });
      });
      return options;
    }

    // Add master-only names that are not already present in inventory
    masterNames.forEach((m) => {
      const exists = inventoryByForm.some((inv) => normalizeText(inv.Medicine_Name) === normalizeText(m.name) && (m.strength ? normalizeText(inv.Strength) === normalizeText(m.strength) : true));
      if (!exists) {
        options.push({ value: `name::${m.name}`, label: `${m.name}${m.strength ? ` (${m.strength})` : ""} - Not in stock`, kind: "master", master: m });
      }
    });

    return options;
  };
  

  /* ================= FILTER DOCTOR PRESCRIPTIONS ================= */
  useEffect(() => {
    if (doctorPrescription.length > 0) {
      const filtered = doctorPrescription.filter(p => {
        const isFamily = p.data?.IsFamilyMember === true;
        const familyId = p.data?.FamilyMember_ID || null;

        if (!formData.IsFamilyMember) {
          return isFamily === false;
        }

        return (
          isFamily === true &&
          String(familyId) === String(formData.FamilyMember_ID)
        );
      });
      setFilteredDoctorPrescription(filtered);
    } else {
      setFilteredDoctorPrescription([]);
    }
  }, [doctorPrescription, formData.IsFamilyMember, formData.FamilyMember_ID]);

  const fetchDoctorActions = async (employeeId, visitId) => {
    try {
      const res = await axios.get(
        `${BACKEND_URL}/api/medical-actions/visit/${visitId}`
      );
      const actions = res.data || [];

      const doctorPrescriptions = actions.filter(a => a.action_type === "DOCTOR_PRESCRIPTION");
      setDoctorPrescription(doctorPrescriptions);
    } catch (error) {
      console.error("Error fetching doctor actions:", error);
      setDoctorPrescription([]);
    }
  };

  const fetchLastTwoPrescriptions = async (employeeId, familyId = null) => {
  try {
    const res = await axios.get(
      `${BACKEND_URL}/prescription-api/employee/${employeeId}`
    );

    let data = res.data || [];

    // 🔥 SAME FILTER AS DOCTOR FORM
    if (familyId) {
      data = data.filter(p =>
        p.IsFamilyMember &&
        String(p.FamilyMember?._id) === String(familyId)
      );
    } else {
      data = data.filter(p => !p.IsFamilyMember);
    }

    // 🔥 SAME SORT AS DOCTOR FORM
    data.sort(
      (a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)
    );

    setLastTwoVisits(data.slice(0, 2));

  } catch (err) {
    console.error("Error fetching previous prescriptions:", err);
    setLastTwoVisits([]);
  }
};
const checkStockAvailability = (medicineCode, requestedQty) => {
  const item = inventory.find(
    m => m.Medicine_Code === medicineCode
  );

  const availableQty = item?.Quantity || 0;

  if (requestedQty <= availableQty) {
    return { status: "AVAILABLE", maxQty: availableQty };
  }

  return { status: "EXCEEDS", maxQty: availableQty };
};


const loadEmployeeReports = async () => {
  if (!selectedEmployee || !selectedEmployee.ABS_NO) {
    alert("No employee selected");
    return;
  }

  try {
      const reportRes = await axios.get(
  `${BACKEND_URL}/employee-api/health-report`,
  { params: { absNo: selectedEmployee.ABS_NO } }
);

    const diseaseRes = await axios.get(
      `${BACKEND_URL}/disease-api/employee/${selectedEmployee._id}`
    );


    setEmployeeReport({
      ...reportRes.data,
      allDiseases: diseaseRes.data || []
    });

    setShowReports(true);

  } catch (err) {
    console.error("Report fetch error:", err);
    alert("Unable to fetch reports");
  }
};


  const formatDateDMY = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "—";
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };

  const formatExpiryMY = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "—";

    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${mm}-${yyyy}`;
  };

  const calculateAge = (dob) => {
    if (!dob) return "";
    const birth = new Date(dob);
    if (isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }
    return age;
  };

  const isMedicineExpired = (value) => {
    if (!value) return false;

    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return false;

    const expiryEndOfDay = new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      23,
      59,
      59,
      999
    );

    return expiryEndOfDay < new Date();
  };

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    const instituteId = localStorage.getItem("instituteId");
    if (!instituteId) return;

    setFormData((f) => ({ ...f, Institute_ID: instituteId }));
    fetchInstitute(instituteId);
    fetchInventory(instituteId);

    let mounted = true;
    const loadMaster = async () => {
      try {
        const data = await fetchMasterDataMap({ force: false });
        if (mounted) setMasterMap(data || {});
      } catch {
        if (mounted) setMasterMap({});
      }
    };

    loadMaster();

    const onMasterUpdated = () => loadMaster();
    window.addEventListener("master-data-updated", onMasterUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("master-data-updated", onMasterUpdated);
    };
  }, []);


  /* ================= API CALLS ================= */
  const fetchInstitute = async (id) => {
    try {
      const res = await axios.get(
        `${BACKEND_URL}/institute-api/institution/${id}`
      );
      setInstituteName(res.data?.Institute_Name || "");
    } catch (error) {
      console.error("Error fetching institute:", error);
    }
  };

  const fetchInventory = async (id) => {
    try {
      const res = await axios.get(
        `${BACKEND_URL}/institute-api/inventory/${id}`
      );
      const usableInventory = (res.data || []).filter(
        (item) => Number(item?.Quantity || 0) > 0 && !isMedicineExpired(item?.Expiry_Date)
      );
      setInventory(
        usableInventory.map((item) => ({
          ...item,
          Medicine_Type: item?.Medicine_Type || item?.Type || "",
          Dosage_Form: item?.Dosage_Form || item?.dosageForm || ""
        }))
      );
    } catch (error) {
      console.error("Error fetching inventory:", error);
      setInventory([]);
    }
  };

  const fetchDiseases = async (employeeId) => {
    try {
      const res = await axios.get(
        `${BACKEND_URL}/disease-api/employee/${employeeId}`
      );
      setDiseases(res.data || []);
    } catch {
      setDiseases([]);
    }
  };

  /* ================= DISEASE FILTER ================= */
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const relevantDiseases = diseases.filter((d) => {
    if (formData.IsFamilyMember) {
      return String(d.FamilyMember_ID?._id) === String(formData.FamilyMember_ID);
    }
    return !d.IsFamilyMember;
  });

  const communicableRecent = relevantDiseases.filter(
    (d) =>
      d.Category === "Communicable" &&
      new Date(d.createdAt) >= twoMonthsAgo
  );
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

  /* ================= MEDICINE VALIDATION ================= */
  const validateMedicineQuantity = async (index, medicineName, quantity) => {
    try {
      await axios.post(
        `${BACKEND_URL}/medicine-limit-api/validate-medicine-quantity`,
        {
          medicine_name: medicineName.trim(),
          quantity: Number(quantity)
        }
      );

      setMedicineErrors((prev) => {
        const updated = { ...prev };
        delete updated[index];
        return updated;
      });
    } catch (err) {
      const max = err?.response?.data?.max_quantity;
      setMedicineErrors((prev) => ({
        ...prev,
        [index]: `Maximum allowed quantity is ${max}`
      }));
    }
  };

  /* ================= MEDICINE HANDLERS ================= */
const handleMedicineChange = (index, field, value) => {
  setFormData(prev => {
    const updated = [...prev.Medicines];
    if (field === "medicineId") {
      // value can be 'code::<Medicine_Code>' for inventory or 'name::<Medicine Name>' for master-only
      if (String(value).startsWith("code::")) {
        const code = String(value).slice(6);
        const selected = inventory.find(m => String(m.Medicine_Code) === String(code));
        if (!selected) return prev;

        updated[index] = {
          ...updated[index],   // keep existing quantity
          medicineId: selected.Medicine_Code,
          medicineName: selected.Medicine_Name,
          dosageForm: selected.Dosage_Form || updated[index].dosageForm || "",
          medicineType: selected.Medicine_Type || updated[index].medicineType || updated[index].type || "",
          type: selected.Medicine_Type || updated[index].medicineType || updated[index].type || "",
          strength: selected.Strength || updated[index].strength || "",
          expiryDate: selected.Expiry_Date
        };
      } else if (String(value).startsWith("name::")) {
        const name = String(value).slice(6);
        // find in master entries
        const masterEntry = (getMasterMedicineEntries(masterMap) || []).find(e => normalizeText(e.value_name) === normalizeText(name) && (updated[index].dosageForm ? normalizeText(e.dosageForm) === normalizeText(updated[index].dosageForm) : true));

        updated[index] = {
          ...updated[index],
          medicineId: "",
          medicineName: name,
          medicineType: updated[index].medicineType || updated[index].type || (masterEntry ? masterEntry.medicineType : ""),
          dosageForm: updated[index].dosageForm || (masterEntry ? masterEntry.dosageForm : ""),
          type: updated[index].medicineType || updated[index].type || (masterEntry ? masterEntry.medicineType : ""),
          strength: masterEntry ? masterEntry.strength || "" : "",
          expiryDate: masterEntry ? masterEntry.expiryDate || "" : ""
        };
      } else {
        // legacy: treat as code
        const selected = inventory.find(m => String(m.Medicine_Code) === String(value));
        if (!selected) return prev;
        updated[index] = {
          ...updated[index],
          medicineId: selected.Medicine_Code,
          medicineName: selected.Medicine_Name,
          dosageForm: selected.Dosage_Form || updated[index].dosageForm || "",
          medicineType: selected.Medicine_Type || updated[index].medicineType || updated[index].type || "",
          type: selected.Medicine_Type || updated[index].medicineType || updated[index].type || "",
          strength: selected.Strength || updated[index].strength || "",
          expiryDate: selected.Expiry_Date
        };
      }
    }

    if (field === "medicineType") {
      const currentMedicineCode = updated[index].medicineId;
      const currentSelectedValue = getMedicineOptionValue(updated[index]);
      const currentSelected = inventory.find(
        (item) => item.Medicine_Code === currentMedicineCode
      );

      updated[index] = {
        ...updated[index],
        medicineType: value,
        type: value
      };

      const allowed = getPharmacyOptionsByTypeAndForm(value, updated[index].dosageForm || "");
      const isStillValid = allowed.some((item) => String(item.value) === String(currentSelectedValue));

      if (currentSelected && !isStillValid) {
        updated[index] = {
          ...updated[index],
          medicineId: "",
          medicineName: "",
          strength: "",
          expiryDate: ""
        };
      }
    }

    if (field === "dosageForm") {
      const currentSelectedValue = getMedicineOptionValue(updated[index]);

      updated[index] = {
        ...updated[index],
        dosageForm: value
      };

      const allowed = getPharmacyOptionsByTypeAndForm(updated[index].medicineType || "", value);
      const isStillValid = allowed.some((item) => String(item.value) === String(currentSelectedValue));
      if (!isStillValid) {
        updated[index] = {
          ...updated[index],
          medicineId: "",
          medicineName: "",
          strength: "",
          expiryDate: ""
        };
      }
    }

if (field === "quantity") {
  const requestedQty = Number(value);
  const medicineCode = updated[index].medicineId;

  if (!medicineCode) {
    updated[index].quantity = requestedQty;
    return { ...prev, Medicines: updated };
  }

  const stockCheck = checkStockAvailability(medicineCode, requestedQty);

if (stockCheck.status === "AVAILABLE")
{
    updated[index].quantity = requestedQty;

    setMedicineErrors(prev => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  }


else {
  updated[index].quantity = stockCheck.maxQty;

  setMedicineErrors(prev => ({
    ...prev,
    [index]: `❌ Only ${stockCheck.maxQty} available`
  }));
}

}
    return { ...prev, Medicines: updated };
  });
};

const calculateQuantity = (dosage, duration) => {
  if (!dosage || !duration) return 1;

  // Example dosage: "1-0-1"
  const parts = dosage.split("-").map(n => Number(n) || 0);
  const perDay = parts.reduce((a, b) => a + b, 0);

  // Example duration: "5 days"
  const daysMatch = duration.match(/\d+/);
  const days = daysMatch ? Number(daysMatch[0]) : 1;

  return perDay * days;
};

  /* ================= ADD DOCTOR PRESCRIBED MEDICINE TO FORM ================= */
const addDoctorPrescribedMedicine = (medicine) => {
  const baseName = medicine.Medicine_Name?.trim();
  // Calculate quantity from Morning + Afternoon + Night over duration
  const perDay = (Number(medicine.Morning) || 0) + (Number(medicine.Afternoon) || 0) + (Number(medicine.Night) || 0);
  const daysMatch = medicine.Duration?.match(/\d+/);
  const days = daysMatch ? Number(daysMatch[0]) : 1;
  const calculatedQty = perDay * days;
  const matchedInventory = (inventory || []).find((item) => {
    const sameName = normalizeText(item.Medicine_Name) === normalizeText(baseName);
    const sameType = !medicine.Type || normalizeText(getInventoryMedicineType(item)) === normalizeText(medicine.Type);
    const sameDosageForm = !medicine.Dosage_Form || !getInventoryDosageForm(item) || normalizeText(getInventoryDosageForm(item)) === normalizeText(medicine.Dosage_Form);
    const sameStrength =
      !medicine.Strength || normalizeText(item.Strength) === normalizeText(medicine.Strength);
    return sameName && sameType && sameDosageForm && sameStrength;
  });

  setFormData(prev => {
    const medicinesCopy = [...prev.Medicines];

    // 🔥 Find first empty row
    const emptyIndex = medicinesCopy.findIndex(
      m => !m.medicineName
    );


    if (emptyIndex !== -1) {
      // Use existing empty row
      medicinesCopy[emptyIndex] = {
        ...medicinesCopy[emptyIndex],
        medicineId: matchedInventory?.Medicine_Code || "",
        medicineName: matchedInventory?.Medicine_Name || baseName,
        medicineType: matchedInventory?.Medicine_Type || medicine.Type || "",
        type: matchedInventory?.Medicine_Type || medicine.Type || "",
        dosageForm: matchedInventory?.Dosage_Form || medicine.Dosage_Form || "",
        foodTiming: medicine.FoodTiming || "",
        strength: matchedInventory?.Strength || medicine.Strength || "",
        expiryDate: matchedInventory?.Expiry_Date || "",
        quantity: calculatedQty
      };
    } else {
      // Otherwise add new row
      medicinesCopy.push({
        medicineId: matchedInventory?.Medicine_Code || "",
        medicineName: matchedInventory?.Medicine_Name || baseName,
        medicineType: matchedInventory?.Medicine_Type || medicine.Type || "",
        type: matchedInventory?.Medicine_Type || medicine.Type || "",
        dosageForm: matchedInventory?.Dosage_Form || medicine.Dosage_Form || "",
        foodTiming: medicine.FoodTiming || "",
        strength: matchedInventory?.Strength || medicine.Strength || "",
        expiryDate: matchedInventory?.Expiry_Date || "",
        quantity: calculatedQty
      });
    }

    return { ...prev, Medicines: medicinesCopy };
  });
};


// Helper function with trimmed logging
const addMedicineToForm = (inventoryItem, quantity) => {
  const itemName = inventoryItem.Medicine_Name?.trim();
  const itemCode = inventoryItem.Medicine_Code?.trim();

  if (inventoryItem.Quantity === 0) {
    alert(
      `❌ "${itemName}" is not available in sub-store. Please collect from main store.`
    );
    return;
  }

  // Check if already in prescription (using trimmed code)
  const isAlreadyAdded = formData.Medicines.some(
    med => med.medicineId === itemCode
  );

  if (isAlreadyAdded) {
    const confirmAddMore = window.confirm(
      `"${itemName}" is already in the prescription. Do you want to add more?`
    );

    if (!confirmAddMore) return;
  }

  // Add to form with trimmed values
  setFormData((prev) => ({
    ...prev,
    Medicines: [
      ...prev.Medicines,
      {
        medicineId: itemCode,
        medicineName: itemName,
        medicineType: inventoryItem.Medicine_Type || "",
        type: inventoryItem.Medicine_Type || "",
        dosageForm: inventoryItem.Dosage_Form || "",
        strength: inventoryItem.Strength || "",
        expiryDate: inventoryItem.Expiry_Date,
        quantity: quantity || 1
      }
    ]
  }));

};

  const addMedicine = () =>
    setFormData((prev) => ({
      ...prev,
      Medicines: [
        ...prev.Medicines,
        { medicineId: "", medicineName: "", medicineType: "", dosageForm: "", type: "", strength: "", quantity: 0, _uid: `${Date.now()}-${Math.random().toString(36).slice(2,8)}` }
      ]
    }));

  const removeMedicine = (index) =>
    setFormData((prev) => ({
      ...prev,
      Medicines: prev.Medicines.filter((_, i) => i !== index)
    }));

  /* ================= SUBMIT ================= */
const handleSubmit = async (e) => {
  e.preventDefault();

  if (!formData.Institute_ID) {
    alert("Institute information is missing. Please reload the page or select the institute again.");
    return;
  }

  if (!formData.Employee_ID) {
    alert("Please select a patient from the queue before submitting the prescription.");
    return;
  }

  const selectedRows = formData.Medicines.filter((medicine) => medicine.medicineId);

  if (selectedRows.length === 0) {
    alert("Please select at least one medicine from the sub-store list.");
    return;
  }

  const hasManualEntry = formData.Medicines.some((medicine) =>
    (medicine.medicineName?.trim() || Number(medicine.quantity) > 0) && !medicine.medicineId
  );

  if (hasManualEntry) {
    alert("Please select medicine from suggestions only. Manual entry is not allowed.");
    return;
  }

  const invalidSelected = selectedRows.some((medicine) => {
    const invItem = inventory.find((item) => item.Medicine_Code === medicine.medicineId);
    return !invItem || Number(medicine.quantity) <= 0;
  });

  if (invalidSelected) {
    alert("Please select valid medicine and quantity from sub-store.");
    return;
  }

  // Build payload with PROPER Medicine_ID
  const payload = {
    Institute_ID: formData.Institute_ID,
    Employee_ID: formData.Employee_ID,
    IsFamilyMember: formData.IsFamilyMember,
    FamilyMember_ID: formData.IsFamilyMember ? formData.FamilyMember_ID : null,
    Medicines: selectedRows.map(m => {
      // Find medicine in inventory - IMPORTANT: Get the _id!
      const invItem = inventory.find(item =>
        item.Medicine_Code === m.medicineId
      );


      // Send Medicine_ID as string (ObjectId from inventory)
      return {
        Medicine_ID: invItem?._id || null,  // THIS MUST BE THE _id FROM DATABASE
        Medicine_Code: m.medicineId,
        Medicine_Name: m.medicineName,
        Type: m.medicineType || m.type || "",
        Dosage_Form: m.dosageForm || "",
        Strength: m.strength || invItem?.Strength || "",
        Quantity: Number(m.quantity),
        source: "PHARMACY"
      };
    }),
    Notes: formData.Notes,
    visit_id: visitId
  };

  try {
    const response = await axios.post(
      `${BACKEND_URL}/prescription-api/add`,
      payload
    );

    alert("✅ Prescription saved successfully!");

    // Reset form
    setFormData({
      Institute_ID: formData.Institute_ID,
      Employee_ID: "",
      IsFamilyMember: false,
      FamilyMember_ID: "",
      Medicines: [{ medicineId: "", medicineName: "", medicineType: "", dosageForm: "", type: "", strength: "", expiryDate: "", quantity: 0 }],
      Notes: ""
    });
    setSelectedEmployee(null);
    setVisitId(null);
    setDoctorPrescription([]);
    setLastTwoVisits([]);
    setFilteredDoctorPrescription([]);

  } catch (error) {
    console.error("❌ Error details:", error.response?.data);
    alert("❌ Failed to save: " + (error.response?.data?.message || error.message));
  }
};

  /* ================= UI ================= */
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
      <div className="row">
        {/* LEFT REPORTS */}
{showReports && (
  <div className="col-lg-3 mb-3">
    <div className="card shadow border-0 h-100">
      <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <strong>Employee Reports</strong>

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

  {!employeeReport ? (
    <div className="text-muted">No reports available</div>
  ) : (
    <>
      {/* BASIC DETAILS */}
      <div className="mb-3">
  <div>
    <strong>Name:</strong> {employeeReport.employee?.Name}
  </div>
  <div>
    <strong>ABS No:</strong> {employeeReport.employee?.ABS_NO}
  </div>
  <div>
    <strong>Age:</strong> {employeeReport.employee?.Age}
  </div>
  <div>
    <strong>Blood Group:</strong> {employeeReport.employee?.Blood_Group}
  </div>
</div>


      {/* DISEASE HISTORY */}
      {employeeReport.allDiseases?.length > 0 && (
        <div className="mb-3">
          <h6 className="fw-bold">Disease History</h6>
          <ul className="small ps-3">
            {employeeReport.allDiseases.map((d, i) => (
              <li key={i}>
                {d.Disease_Name}
                {d.Category && ` (${d.Category})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* LAB TEST REPORTS */}
      {employeeReport.tests?.length > 0 && (
        <div>
          <h6 className="fw-bold">Lab Reports</h6>

          {employeeReport.tests.map((t, idx) => (
            <div key={idx} className="border rounded p-2 mb-2 small">
              <div><strong>{t.Test_Name}</strong></div>
              <div>Result: {t.Result_Value}</div>
              {t.Reference_Range && (
                <div>Ref Range: {t.Reference_Range}</div>
              )}
              {t.Units && (
                <div>Units: {t.Units}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )}
</div>

            </div>
          </div>
        )}

        {/* FORM - MAIN CONTENT */}
        <div className={`${showReports ? "col-lg-6" : "col-lg-9"} mb-3`}>
          {/* ===== TOP BAR WITH INVENTORY BUTTON ===== */}
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h4 className="fw-bold mb-0">Pharmacy Prescription</h4>
              <small className="text-muted">
                Issue medicines to employees
              </small>
            </div>

            <button
              className="btn btn-outline-primary"
              onClick={() => navigate("/institutes/inventory?mode=embedded")}
            >
              🏥 Inventory
            </button>
          </div>
          <div className="card shadow border-0 pharmacy-card">
            <div className="card-header bg-dark text-white">
              <h5 className="mb-0">Pharmacy Prescription</h5>
            </div>

            <div className="card-body">
              <form onSubmit={handleSubmit}>
                {/* Institute Info */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">Institute</label>
                  <input className="form-control" value={instituteName} readOnly />
                </div>

                {/* Patient Selector */}
                <PatientSelector
                  instituteId={formData.Institute_ID}
                  onlyPharmacyQueue={true}
                  onSelect={({ employee, visit }) => {
                    setSelectedEmployee(employee);
                    setSelectedVisit(visit);
                    setVisitId(visit?._id || null);
                    const isFamily = visit?.IsFamilyMember || false;
                    const familyId = visit?.FamilyMember?._id || null;

                    setFormData(prev => ({
                      ...prev,
                      Employee_ID: employee._id,
                      IsFamilyMember: isFamily,
                      FamilyMember_ID: familyId
                    }));

                    fetchDiseases(employee._id);

                    if (visit?._id) {
                      fetchDoctorActions(employee._id, visit._id);
                    }

                    fetchLastTwoPrescriptions(employee._id, familyId);
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
                      onClick={()=>{
                        loadEmployeeReports()}}
                    >
                      View Reports
                    </button>
                  </div>
                )}

                {/* Disease History Warning */}
                {communicableRecent.length > 0 && (
                  <div className="alert alert-warning">
                    <strong>⚠ Disease History (Reference Only)</strong>
                    <ul className="mb-0 mt-2">
                      {communicableRecent.map((d, i) => (
                        <li key={i}>{d.Disease_Name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ================= DOCTOR PRESCRIPTION SECTION ================= */}
                {filteredDoctorPrescription.length > 0 && (
                  <div className="card mb-4 border-primary">
                    <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                      <h6 className="mb-0">👨⚕ Doctor Prescribed Medicines</h6>
                      <button
                        type="button"
                        className="btn btn-sm btn-light"
                        onClick={() => setShowDoctorPrescription(!showDoctorPrescription)}
                      >
                        {showDoctorPrescription ? "Hide" : "Show"}
                      </button>
                    </div>

                    {showDoctorPrescription && (
                      <div className="card-body">
                        {filteredDoctorPrescription.map((prescription, pIdx) => (
                          <div key={pIdx} className="mb-3">
                            <div className="d-flex justify-content-between align-items-center mb-2">
                              <small className="text-muted">
                                Prescribed on: {formatDateDMY(prescription.createdAt)}
                              </small>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => {
                                  // Add all doctor prescribed medicines to form
                                  prescription.data.medicines.forEach(med => {
                                    addDoctorPrescribedMedicine(med);
                                  });
                                }}
                              >
                                Add All to Pharmacy Prescription
                              </button>
                            </div>

                            <table className="table table-sm table-bordered">
                              <thead>
                                <tr>
                                  <th>Medicine</th>
                                  <th>Type</th>
                                  <th>Food Timing</th>
                                  <th>Strength</th>
                                  <th>Morning</th>
                                  <th>Afternoon</th>
                                  <th>Night</th>
                                  <th>Duration</th>
                                  <th>Remarks</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {prescription.data.medicines.map((medicine, mIdx) => (
                                  <tr key={mIdx}>
                                    <td>{medicine.Medicine_Name}</td>
                                    <td>{medicine.Type || "-"}</td>
                                    <td>{medicine.FoodTiming || "-"}</td>
                                    <td>{medicine.Strength || "-"}</td>
                                    <td>{medicine.Morning || "0"}</td>
                                    <td>{medicine.Afternoon || "0"}</td>
                                    <td>{medicine.Night || "0"}</td>
                                    <td>{medicine.Duration || "-"}</td>
                                    <td>{medicine.Remarks || "-"}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-success"
                                        onClick={() => addDoctorPrescribedMedicine(medicine)}
                                      >
                                        Add to Prescription
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {prescription.data.notes && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-info"
                                  onClick={() => setShowDoctorNotes(prev => ({ ...prev, [pIdx]: !prev[pIdx] }))}
                                >
                                  {showDoctorNotes[pIdx] ? "Hide Doctor Notes" : "Show Doctor Notes"}
                                </button>
                                {showDoctorNotes[pIdx] && (
                                  <div className="alert alert-info mt-2 mb-0 p-2">
                                    <small><strong>Doctor Notes:</strong> {prescription.data.notes}</small>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ================= PHARMACY PRESCRIPTION SECTION ================= */}
                <h6 className="fw-bold mt-4 mb-3">
                  📋 Pharmacy Prescription
                  <small className="text-muted ms-2">(Dispensing Medicines)</small>
                </h6>

                {formData.Medicines.map((med, i) => (
                  <div key={i} className="mb-3 medicine-row">
                    <div className="mb-2 position-relative" ref={(el) => { quickMedicineSearchRefs.current[i] = el; }}>
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
                                normalizeSearchText(item.Medicine_Name) === normalizeSearchText(med.medicineName) &&
                                normalizeSearchText(item.Medicine_Type) === normalizeSearchText(med.medicineType || med.type) &&
                                normalizeSearchText(item.Dosage_Form) === normalizeSearchText(med.dosageForm) &&
                                normalizeSearchText(item.Strength) === normalizeSearchText(med.strength);

                              return (
                                <button
                                  key={`${item.Medicine_Name || optionIndex}-${item.Strength || "no-strength"}-${item.Dosage_Form || "no-form"}-${item.Medicine_Type || "no-type"}`}
                                  type="button"
                                  className={`d-block text-start w-100 border-0 px-3 py-2 ${isSelected ? "bg-primary text-white" : "bg-white"}`}
                                  style={{ borderBottom: optionIndex < getQuickMedicineOptionsForRow(i).length - 1 ? "1px solid #f1f1f1" : "none" }}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => applyQuickMedicineSelection(i, item)}
                                >
                                  <div className="fw-semibold fs-6">{item.Medicine_Name || "Unnamed medicine"}</div>
                                  <div className="small mt-1 d-flex flex-wrap gap-2 align-items-center">
                                    <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                      {item.Strength || "No strength"}
                                    </span>
                                    <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                      {item.Dosage_Form || "No dosage form"}
                                    </span>
                                    <span className={`rounded-pill px-2 py-1 ${isSelected ? "bg-white text-primary" : "bg-light text-dark"}`}>
                                      {item.Medicine_Type || "No type"}
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

                    <div className="d-flex gap-2 align-items-start">
                      <select
                        className="form-select"
                        value={med.medicineType || ""}
                        onChange={(e) => handleMedicineChange(i, "medicineType", e.target.value)}
                      >
                        <option value="">Select Medicine Type</option>
                        {medicineTypeOptions.map((typeOption) => (
                          <option key={typeOption} value={typeOption}>
                            {typeOption}
                          </option>
                        ))}
                      </select>

                      <select
                        className="form-select"
                        value={med.dosageForm || ""}
                        disabled={!med.medicineType}
                        onChange={(e) => handleMedicineChange(i, "dosageForm", e.target.value)}
                      >
                        <option value="">{med.medicineType ? "Select Dosage Form" : "Select Medicine Type First"}</option>
                        {dosageFormOptions.map((formOption) => (
                          <option key={formOption} value={formOption}>
                            {formOption}
                          </option>
                        ))}
                      </select>

                      <select
                        className={`form-select ${med.medicineName ? "medicine-auto-filled" : ""}`}
                        value={getMedicineOptionValue(med)}
                        disabled={!med.medicineType}
                        onChange={(e) => handleMedicineChange(i, "medicineId", e.target.value)}
                      >
                        <option value="">{med.medicineType ? "Select Medicine" : "Select Medicine Type First"}</option>
                        {getPharmacyOptionsByTypeAndForm(med.medicineType, med.dosageForm).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        className="form-control"
                        value={med.strength || ""}
                        placeholder="Strength"
                        readOnly
                      />

                      <input
                        type="number"
                        className="form-control quantity-input"
                        value={med.quantity}
                        onChange={(e) =>
                          handleMedicineChange(i, "quantity", e.target.value)
                        }
                        placeholder="Qty"
                        required
                        min="1"
                      />

                      <button
                        type="button"
                        className="btn btn-outline-danger"
                        onClick={() => removeMedicine(i)}
                      >
                        ✕
                      </button>
                    </div>
                    {medicineErrors[i] && (
                      <div
                        className={`fw-bold mt-1 ${
                          medicineErrors[i].startsWith("⚠")
                            ? "text-warning"
                            : "text-danger"
                        }`}
                      >
                        {medicineErrors[i]}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="btn btn-outline-primary mt-2"
                  onClick={addMedicine}
                >
                  + Add Medicine
                </button>

                {/* Notes */}
                <div className="mt-4">
                  <label className="form-label fw-semibold">Pharmacy Notes</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={formData.Notes}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, Notes: e.target.value }))
                    }
                    placeholder="Any additional notes from pharmacy..."
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  className="btn btn-dark w-100 mt-4"
                  disabled={Object.values(medicineErrors).some(
                    (msg) => msg.startsWith("❌")
                  )}
                >
                  Submit Pharmacy Prescription
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
                        marginRight: "20px"
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
            {lastTwoVisits.length > 0 && (
              <div className="card shadow border-0 mb-3">
                <div className="card-header bg-secondary text-white">
                  <strong>Previous 2 Pharmacy Prescriptions</strong>
                </div>

                <div className="card-body">
                  {lastTwoVisits.map((p, idx) => {

                    const formattedDate = p.Timestamp
                      ? new Date(p.Timestamp).toLocaleDateString("en-GB")
                      : "-";

                    return (
                      <div key={idx} className="mb-3 border-bottom pb-2">

                        <div className="fw-semibold mb-1">
                          {formattedDate}
                        </div>

                        {p.FamilyMember && (
                          <div className="text-muted small mb-1">
                            {p.FamilyMember.Name} ({p.FamilyMember.Relationship})
                          </div>
                        )}

                        <ul className="small mb-2 ps-3">
                          {p.Medicines?.map((m, i) => (
                            <li key={i}>
                              {m.Medicine_Name || m.Medicine_ID?.Medicine_Name}
                              {m.Strength ? ` (${m.Strength})` : ""}
                              {" — "}
                              Qty: {m.Quantity}
                            </li>
                          ))}
                        </ul>

                        {p.Notes && (
                          <div className="fst-italic small text-muted">
                            {p.Notes}
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default PharmacyPrescriptionForm;
