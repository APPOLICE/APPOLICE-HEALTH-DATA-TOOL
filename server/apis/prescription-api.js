const express = require("express");
const mongoose = require("mongoose");
const prescriptionApp = express.Router();
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const Prescription = require("../models/Prescription");
const Institute = require("../models/master_institute");
const Employee = require("../models/employee");
const FamilyMember = require("../models/family_member");
const InstituteLedger = require("../models/InstituteLedger");
const MedicalAction = require("../models/medical_action");
const DailyVisit = require("../models/daily_visit");
// 🔴 IMPORTANT: THIS IS NOW SUBSTORE STOCK
const Medicine = require("../models/master_medicine");
const { normalizePatientMetrics } = require("../utils/healthMetrics");
const {
  generateSingleReportPdf,
  generateCombinedReportPdf,
  buildReportHtml,
} = require("../utils/reportLayout");
const {
  ensureStoredReportPdf,
  sendStoredReportPdf,
  storeReportPdf,
} = require("../utils/storedReportPdf");
const { hydratePrescriptionInvestigations } = require("../utils/prescriptionInvestigations");

const getPatientMetrics = async ({ employeeId, isFamilyMember, familyMemberId }) => {
  const patient = isFamilyMember && familyMemberId
    ? await FamilyMember.findById(familyMemberId).select("Height Weight BMI").lean()
    : await Employee.findById(employeeId).select("Height Weight BMI").lean();

  return normalizePatientMetrics(patient || {});
};

const getDisplayPatientMetrics = (currentPatient = {}, fallbackMetrics = {}) =>
  normalizePatientMetrics({
    Height: currentPatient?.Height || fallbackMetrics?.Height || "",
    Weight: currentPatient?.Weight || fallbackMetrics?.Weight || "",
    BMI: currentPatient?.BMI || fallbackMetrics?.BMI || ""
  });

const parseDateInput = (value, endOfDay = false) => {
  if (!value) return null;

  const raw = String(value).trim();
  const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const yyyymmdd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let parsed = null;

  if (ddmmyyyy) {
    parsed = new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10)
    );
  } else if (yyyymmdd) {
    parsed = new Date(
      parseInt(yyyymmdd[1], 10),
      parseInt(yyyymmdd[2], 10) - 1,
      parseInt(yyyymmdd[3], 10)
    );
  } else {
    parsed = new Date(raw);
  }

  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  else parsed.setHours(0, 0, 0, 0);

  return parsed;
};

const buildDateRange = (fromDate, toDate) => {
  let start = parseDateInput(fromDate, false);
  let end = parseDateInput(toDate, true);

  if (start && end && start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return { start, end };
};

const isWithinDateRange = (value, start, end) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

const matchesPersonFilter = (record, personId) => {
  if (personId === "all" || !personId) return true;
  if (personId === "self") return !record.IsFamilyMember;
  return record.IsFamilyMember && String(record.FamilyMember?._id || record.FamilyMember || "") === String(personId);
};

const normalizeMedicineRows = (medicines) =>
  (Array.isArray(medicines) ? medicines : []).map((medicine, index) => ({
    _id: medicine?._id || `med-${index}`,
    Medicine_ID: medicine?.Medicine_ID || null,
    Medicine_Name: medicine?.Medicine_Name || "-",
    Strength: medicine?.Strength || "",
    Medicine_Type: medicine?.Medicine_Type || medicine?.Type || medicine?.medicineType || "",
    Type: medicine?.Type || medicine?.Medicine_Type || medicine?.medicineType || "",
    Dosage_Form: medicine?.Dosage_Form || medicine?.dosageForm || "",
    FoodTiming: medicine?.FoodTiming || medicine?.foodTiming || "",
    Frequency: medicine?.Frequency || medicine?.frequency || "",
    Morning: Boolean(medicine?.Morning),
    Afternoon: Boolean(medicine?.Afternoon),
    Night: Boolean(medicine?.Night),
    Duration: medicine?.Duration || medicine?.duration || "",
    Remarks: medicine?.Remarks || medicine?.remarks || "",
    Quantity: Number(medicine?.Quantity || 0)
  }));

const hasAnyVitals = (vitals = {}) =>
  Boolean(
    vitals.Temperature !== null && vitals.Temperature !== undefined && vitals.Temperature !== "" ||
    vitals.Blood_Pressure ||
    vitals.Oxygen !== null && vitals.Oxygen !== undefined && vitals.Oxygen !== "" ||
    vitals.Pulse !== null && vitals.Pulse !== undefined && vitals.Pulse !== "" ||
    vitals.GRBS !== null && vitals.GRBS !== undefined && vitals.GRBS !== "" ||
    vitals.Height ||
    vitals.Weight ||
    vitals.BMI
  );

const groupPrescriptionRows = (records) => {
  const grouped = new Map();

  (Array.isArray(records) ? records : []).forEach((record) => {
    const ts = record?.Timestamp ? new Date(record.Timestamp) : null;
    if (!ts || Number.isNaN(ts.getTime())) return;

    const dateKey = [
      ts.getFullYear(),
      String(ts.getMonth() + 1).padStart(2, "0"),
      String(ts.getDate()).padStart(2, "0")
    ].join("-");

    const personKey = record.IsFamilyMember
      ? `family-${record.FamilyMember?._id || record.FamilyMember || "unknown"}`
      : `self-${record.Employee?._id || record.Employee || "employee"}`;

    const key = `${dateKey}-${personKey}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...record,
        Medicines: []
      });
    }

    const groupedRecord = grouped.get(key);
    const incomingVitals = record?.VisitSummary?.Vitals || {};
    const existingVitals = groupedRecord?.VisitSummary?.Vitals || {};

    if (hasAnyVitals(incomingVitals) && !hasAnyVitals(existingVitals)) {
      groupedRecord.VisitSummary = record.VisitSummary;
    }

    if (!hasAnyVitals(groupedRecord.PatientMetrics || {}) && hasAnyVitals(record.PatientMetrics || {})) {
      groupedRecord.PatientMetrics = record.PatientMetrics;
    }

    groupedRecord.Medicines.push(...normalizeMedicineRows(record.Medicines));
  });

  return Array.from(grouped.values()).sort(
    (a, b) => new Date(b.Timestamp || 0) - new Date(a.Timestamp || 0)
  );
};

const buildDoctorPrescriptionRecord = (action, visitMap, employeeMap, familyMap) => {
  const actionData = action?.data || {};
  const medicines = normalizeMedicineRows(actionData.medicines);
  if (medicines.length === 0) return null;

  const familyId = actionData.FamilyMember_ID || actionData.family_member_id || null;
  const isFamilyMember = actionData.IsFamilyMember ?? actionData.is_family_member ?? false;
  const visit = visitMap.get(String(action.visit_id || "")) || null;
  const employee = employeeMap.get(String(action.employee_id || "")) || null;
  const familyMember = familyId ? familyMap.get(String(familyId)) || null : null;

  return {
    _id: action._id,
    Timestamp: action.created_at || action.createdAt || new Date(),
    visit_id: action.visit_id || null,
    IsFamilyMember: Boolean(isFamilyMember),
    FamilyMember: familyMember,
    Employee: employee,
    Institute: visit?.Institute_ID || null,
    VisitSummary: visit
      ? {
          _id: visit._id,
          symptoms: visit.symptoms || "",
          Vitals: visit.Vitals || {}
        }
      : null,
    PatientMetrics: getDisplayPatientMetrics(
      Boolean(isFamilyMember) ? familyMember : employee,
      visit?.Vitals || actionData.PatientMetrics || {}
    ),
    Medicines: medicines,
    Notes: actionData.notes || action.remarks || "",
    Source: "DOCTOR_PRESCRIPTION"
  };
};

const populatePrescriptionActionRecord = async (action) => {
  if (!action) return null;

  const familyId = action?.data?.FamilyMember_ID || action?.data?.family_member_id || null;
  const isFamilyMember = action?.data?.IsFamilyMember ?? action?.data?.is_family_member ?? false;

  const [visit, employee, familyMember] = await Promise.all([
    action?.visit_id
      ? DailyVisit.findById(action.visit_id).populate("Institute_ID", "Institute_Name").lean()
      : Promise.resolve(null),
    action?.employee_id
      ? Employee.findById(action.employee_id).select("_id Name ABS_NO DOB Gender Blood_Group Height Weight BMI").lean()
      : Promise.resolve(null),
    familyId
      ? FamilyMember.findById(familyId).select("_id Name Relationship DOB Gender Blood_Group Height Weight BMI").lean()
      : Promise.resolve(null)
  ]);

  const record = buildDoctorPrescriptionRecord(
    action,
    new Map(visit ? [[String(visit._id), visit]] : []),
    new Map(employee ? [[String(employee._id), employee]] : []),
    new Map(familyMember ? [[String(familyMember._id), familyMember]] : [])
  );

  return record
    ? {
        record: await hydratePrescriptionInvestigations(record),
        source: "medical_action"
      }
    : null;
};

const resolveSinglePrescriptionDownloadRecord = async ({ recordId, sourceHint }) => {
  const normalizedRecordId = String(recordId || "").trim();
  if (!normalizedRecordId) return null;

  const loadPrescription = async () =>
    Prescription.findById(normalizedRecordId)
      .populate("Employee", "Name ABS_NO DOB Gender Blood_Group")
      .populate("FamilyMember", "Name Relationship DOB Gender Blood_Group")
      .populate("Institute", "Institute_Name")
      .lean();

  const loadAction = async () =>
    MedicalAction.findById(normalizedRecordId)
      .lean();

  const loadPrescriptionByVisit = async () =>
    Prescription.findOne({ visit_id: normalizedRecordId })
      .populate("Employee", "Name ABS_NO DOB Gender Blood_Group")
      .populate("FamilyMember", "Name Relationship DOB Gender Blood_Group")
      .populate("Institute", "Institute_Name")
      .lean();

  const loadActionByVisit = async () =>
    MedicalAction.findOne({
      visit_id: normalizedRecordId,
      action_type: "DOCTOR_PRESCRIPTION"
    })
      .sort({ created_at: -1 })
      .lean();

  const lookupOrder = sourceHint === "DOCTOR_PRESCRIPTION"
    ? ["action", "prescription", "actionByVisit", "prescriptionByVisit"]
    : sourceHint === "PHARMACY_ISSUE"
      ? ["prescription", "action", "prescriptionByVisit", "actionByVisit"]
      : ["prescription", "action", "prescriptionByVisit", "actionByVisit"];

  for (const step of lookupOrder) {
    if (step === "prescription") {
      const prescription = await loadPrescription();
      if (prescription) {
        return {
          record: await hydratePrescriptionInvestigations({
            ...prescription,
            Source: prescription.Source || "PRESCRIPTION"
          }),
          source: "prescription"
        };
      }
    }

    if (step === "action") {
      const action = await loadAction();
      if (action && action.action_type === "DOCTOR_PRESCRIPTION") {
        const resolved = await populatePrescriptionActionRecord(action);
        if (resolved) return resolved;
      }
    }

    if (step === "prescriptionByVisit") {
      const prescription = await loadPrescriptionByVisit();
      if (prescription) {
        return {
          record: await hydratePrescriptionInvestigations({
            ...prescription,
            Source: prescription.Source || "PRESCRIPTION"
          }),
          source: "prescription_by_visit"
        };
      }
    }

    if (step === "actionByVisit") {
      const action = await loadActionByVisit();
      if (action) {
        const resolved = await populatePrescriptionActionRecord(action);
        if (resolved) return resolved;
      }
    }
  }

  return null;
};

const fetchCombinedPrescriptionHistory = async ({ employeeId, personId, fromDate, toDate }) => {
  const familyMembers = await FamilyMember.find({ Employee: employeeId }).select("_id Name Relationship Height Weight BMI").lean();
  const familyIds = familyMembers.map((member) => member._id);

  const { start, end } = buildDateRange(fromDate, toDate);

  const baseFilter = {
    $or: [
      { Employee: employeeId },
      { FamilyMember: { $in: familyIds } }
    ]
  };

  let personFilter = {};
  if (personId === "self") {
    personFilter = { IsFamilyMember: false };
  } else if (personId && personId !== "all") {
    personFilter = { IsFamilyMember: true, FamilyMember: personId };
  }

  const prescriptionQuery = { ...baseFilter, ...personFilter };
  if (start || end) {
    const dateFilter = {};
    if (start) dateFilter.$gte = start;
    if (end) dateFilter.$lte = end;
    prescriptionQuery.Timestamp = dateFilter;
  }

  const prescriptions = await Prescription.find(prescriptionQuery)
    .populate("Institute", "Institute_Name")
    .populate("Employee", "Name ABS_NO Height Weight BMI")
    .populate("FamilyMember", "Name Relationship Height Weight BMI")
    .populate("Medicines.Medicine_ID", "Medicine_Code Expiry_Date Strength")
    .sort({ Timestamp: -1 })
    .lean();

  const doctorActions = await MedicalAction.find({
    employee_id: employeeId,
    action_type: "DOCTOR_PRESCRIPTION"
  })
    .sort({ created_at: -1 })
    .lean();

  const relevantActions = doctorActions.filter((action) => {
    const actionData = action?.data || {};
    const actionFamilyId = actionData.FamilyMember_ID || actionData.family_member_id || null;
    const actionIsFamily = actionData.IsFamilyMember ?? actionData.is_family_member ?? false;

    if (personId === "self") return !actionIsFamily;
    if (personId && personId !== "all") return String(actionFamilyId || "") === String(personId);

    return !actionIsFamily || familyIds.some((id) => String(id) === String(actionFamilyId || ""));
  }).filter((action) => isWithinDateRange(action.created_at || action.createdAt, start, end));

  const visitIds = relevantActions
    .map((action) => action.visit_id)
    .concat(
      prescriptions.map((row) => row.visit_id)
    )
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const [visits, employees] = await Promise.all([
    visitIds.length
      ? DailyVisit.find({ _id: { $in: visitIds } }).populate("Institute_ID", "Institute_Name").lean()
      : Promise.resolve([]),
    Employee.find({ _id: employeeId }).select("_id Name ABS_NO Height Weight BMI").lean()
  ]);

  const visitMap = new Map(visits.map((visit) => [String(visit._id), visit]));
  const employeeMap = new Map(employees.map((employee) => [String(employee._id), employee]));
  const familyMap = new Map(familyMembers.map((member) => [String(member._id), member]));

  const actionRecords = relevantActions
    .map((action) => buildDoctorPrescriptionRecord(action, visitMap, employeeMap, familyMap))
    .filter(Boolean);

  const issuedVisitIds = new Set(
    prescriptions
      .filter((row) => row.visit_id)
      .map((row) => String(row.visit_id))
  );

  const dedupedActionRecords = actionRecords.filter((record) => {
    const sourceVisitId = relevantActions.find((action) => String(action._id) === String(record._id))?.visit_id;
    if (!sourceVisitId) return true;
    return !issuedVisitIds.has(String(sourceVisitId));
  });

  const hydratedPrescriptions = await Promise.all(prescriptions.map(async (record) => {
    const visit = record?.visit_id ? visitMap.get(String(record.visit_id)) || null : null;

    return hydratePrescriptionInvestigations({
      ...record,
      VisitSummary: visit
        ? {
            _id: visit._id,
            symptoms: visit.symptoms || "",
            Vitals: visit.Vitals || {}
          }
        : null,
      PatientMetrics: getDisplayPatientMetrics(
        record.IsFamilyMember ? record.FamilyMember : record.Employee,
        visit?.Vitals || record.PatientMetrics || {}
      )
    });
  }));

  const combined = [...hydratedPrescriptions, ...dedupedActionRecords].filter((record) => matchesPersonFilter(record, personId));

  return groupPrescriptionRows(combined);
};

// =======================================================
// DEBUG ENDPOINT - Check medicine structure
// =======================================================
prescriptionApp.get("/debug-medicines", async (req, res) => {
  try {
    const medicines = await Medicine.find({}).limit(10);

    res.json({
      totalMedicines: await Medicine.countDocuments(),
      sampleMedicines: medicines.map(m => ({
        _id: m._id,
        Medicine_Code: m.Medicine_Code,
        Medicine_Name: m.Medicine_Name,
        Institute_ID: m.Institute_ID,
        Quantity: m.Quantity,
        allFields: Object.keys(m.toObject())
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug: return a sample employee/family IDs if present
prescriptionApp.get('/debug-sample', async (req, res) => {
  try {
    const Institute = require('../models/master_institute');
    const Employee = require('../models/employee');
    const FamilyMember = require('../models/family_member');

    const institute = await Institute.findOne({ Institute_Name: 'Imported Institute' }).lean();
    if (!institute) return res.json({ message: 'no-sample-institute' });

    const employee = await Employee.findOne({}).sort({ createdAt: -1 }).lean();
    const family = await FamilyMember.findOne({ Employee: employee?._id }).lean();

    return res.json({ instituteId: institute._id, employeeId: employee?._id, familyMemberId: family?._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// =======================================================
// ADD PRESCRIPTION (SUBSTORE → PATIENT) - FIXED VERSION
// =======================================================
prescriptionApp.post("/add",verifyToken,
  allowInstituteRoles("pharmacist"), async (req, res) => {
  try {
    console.log("📦 PRESCRIPTION PAYLOAD:", JSON.stringify(req.body, null, 2));

    const {
      Institute_ID,
      Employee_ID,
      Medicines,
      visit_id,
      IsFamilyMember,
      FamilyMember_ID,
      Notes
    } = req.body;

    // ================================
    // BASIC VALIDATION
    // ================================
    if (!Institute_ID || !Employee_ID || !Array.isArray(Medicines) || Medicines.length === 0) {
      return res.status(400).json({ message: "Invalid prescription data" });
    }

    const institute = await Institute.findById(Institute_ID);
    if (!institute) {
      return res.status(400).json({ message: "Institute not found" });
    }

    const ledgerEntries = [];
    const prescriptionMedicines = [];
    const patientMetrics = await getPatientMetrics({
      employeeId: Employee_ID,
      isFamilyMember: IsFamilyMember,
      familyMemberId: FamilyMember_ID
    });

    // ================================
    // PROCESS EACH MEDICINE
    // ================================
    for (const med of Medicines) {

      const Medicine_Code = med.Medicine_Code || med.Medicine_ID;
      const Medicine_Name = (med.Medicine_Name || "").trim();
      const Strength = (med.Strength || "").trim();
      const qty = Number(med.Quantity);

      if (!Medicine_Code || qty <= 0) {
        return res.status(400).json({ message: "Invalid medicine data" });
      }

      // 🔍 Find substore medicine for this institute
      const substoreMed = await Medicine.findOne({
        Medicine_Code: Medicine_Code,
        Institute_ID: Institute_ID
      });

      if (!substoreMed) {
        return res.status(404).json({
          message: `Medicine ${Medicine_Code} not found in Substore`
        });
      }

      console.log("📊 Stock Check:", {
        Code: substoreMed.Medicine_Code,
        Available: substoreMed.Quantity,
        Requested: qty
      });

      // ================================
      // STOCK VALIDATION
      // ================================
      if (substoreMed.Quantity < qty) {
        return res.status(400).json({
          message: "Insufficient stock",
          medicineName: substoreMed.Medicine_Name,
          available: substoreMed.Quantity,
          requested: qty
        });
      }

      // 🔻 Deduct stock
      substoreMed.Quantity -= qty;
      await substoreMed.save();

      // ================================
      // PREPARE PRESCRIPTION ENTRY
      // ================================
      prescriptionMedicines.push({
        Medicine_ID: substoreMed._id,
        Medicine_Name: substoreMed.Medicine_Name,
        Strength: Strength || substoreMed.Strength || undefined,
        Quantity: qty
      });

      // ================================
      // PREPARE LEDGER ENTRY
      // ================================
      ledgerEntries.push({
        Institute_ID,
        Transaction_Type: "PRESCRIPTION_ISSUE",
        Reference_ID: visit_id || null,
        Medicine_ID: substoreMed._id,
        Medicine_Model: "Medicine",   // IMPORTANT
        Medicine_Name: substoreMed.Medicine_Name,
        Expiry_Date: substoreMed.Expiry_Date,
        Direction: "OUT",
        Quantity: qty,
        Balance_After: substoreMed.Quantity
      });
    }

    // ================================
    // SAVE LEDGER
    // ================================
    if (ledgerEntries.length > 0) {
      await InstituteLedger.insertMany(ledgerEntries);
      console.log(`📚 ${ledgerEntries.length} ledger entries created`);
    }

    // ================================
    // CREATE PRESCRIPTION DOCUMENT
    // ================================
    const prescriptionDoc = new Prescription({
      Institute: Institute_ID,
      Employee: Employee_ID,
      visit_id: visit_id || null,
      IsFamilyMember: IsFamilyMember || false,
      FamilyMember: FamilyMember_ID || null,
      PatientMetrics: patientMetrics,
      Medicines: prescriptionMedicines,
      Notes: Notes || "",
      Timestamp: new Date()
    });

    await prescriptionDoc.save();

    const populatedPrescription = await Prescription.findById(prescriptionDoc._id)
      .populate("Employee", "Name ABS_NO DOB Gender Blood_Group")
      .populate("FamilyMember", "Name Relationship DOB Gender Blood_Group")
      .populate("Institute", "Institute_Name")
      .lean();
    const reportRecord = await hydratePrescriptionInvestigations({
      ...populatedPrescription,
      Source: "PRESCRIPTION",
      visit_id: prescriptionDoc.visit_id || null
    });
    await storeReportPdf("prescription", prescriptionDoc._id, reportRecord);

    await MedicalAction.create({
      employee_id: Employee_ID,
      visit_id: visit_id || null,
      action_type: "PHARMACY_ISSUE",
      source: "PHARMACY",
      data: {
        Institute_ID,
        IsFamilyMember: IsFamilyMember || false,
        FamilyMember_ID: FamilyMember_ID || null,
        PatientMetrics: patientMetrics,
        prescriptionId: prescriptionDoc._id,
        medicines: prescriptionMedicines.map((medicine) => ({
          Medicine_ID: medicine.Medicine_ID,
          Medicine_Name: medicine.Medicine_Name,
          Strength: medicine.Strength || "",
          Quantity: medicine.Quantity
        })),
        notes: Notes || ""
      }
    });

    console.log("✅ Prescription saved:", prescriptionDoc._id);

    return res.status(200).json({
      success: true,
      message: "Prescription saved successfully",
      prescriptionId: prescriptionDoc._id
    });

  } catch (err) {
    console.error("❌ PRESCRIPTION ERROR:", err);
    return res.status(500).json({
      message: "Failed to process prescription",
      error: err.message
    });
  }
});


// =======================================================
// GET PRESCRIPTIONS FOR EMPLOYEE + FAMILY
// =======================================================
prescriptionApp.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { personId, isFamily, familyId, fromDate, toDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: "Invalid Employee ID" });
    }

    const effectivePersonId =
      personId ||
      (isFamily === "true" ? familyId : isFamily === "false" ? "self" : "all");

    const prescriptions = await fetchCombinedPrescriptionHistory({
      employeeId,
      personId: effectivePersonId,
      fromDate,
      toDate
    });

    return res.status(200).json(prescriptions);

  } catch (err) {
    console.error("Fetch prescription error:", err);
    return res.status(500).json({
      error: "Failed to fetch prescriptions",
      details: err.message
    });
  }
});

// =======================================================
// GET ALL PRESCRIPTIONS FOR AN INSTITUTE (ISSUE REGISTER)
// =======================================================
prescriptionApp.get("/institute/:instituteId", async (req, res) => {
  try {
    const { instituteId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({
        message: "Invalid Institute ID"
      });
    }

    const prescriptions = await Prescription.find({
      Institute: instituteId
    })
      .populate("Employee", "Name ABS_NO")
      .populate("FamilyMember", "Name Relationship")
      .populate({
        path: "Medicines.Medicine_ID",
        select: `
          Medicine_Name
          Strength
          Type
          Category
          Expiry_Date
          Medicine_Code
        `
      })
      .sort({ createdAt: -1 });

    return res.status(200).json(prescriptions);
  } catch (err) {
    console.error("Issue register error:", err);

    return res.status(500).json({
      message: "Failed to fetch issued medicines",
      error: err.message
    });
  }
});

// Add a debug endpoint to check specific medicine
prescriptionApp.get("/debug-medicine/:code/:instituteId", async (req, res) => {
  try {
    const { code, instituteId } = req.params;

    const medicine = await Medicine.findOne({
      Medicine_Code: code,
      Institute_ID: instituteId
    });

    if (!medicine) {
      // Check if it exists without institute filter
      const anyMedicine = await Medicine.findOne({
        Medicine_Code: code
      });

      return res.json({
        found: false,
        message: "Medicine not found for this institute",
        medicineCode: code,
        instituteId: instituteId,
        existsWithoutInstitute: !!anyMedicine,
        anyMedicine: anyMedicine
      });
    }

    res.json({
      found: true,
      medicine: {
        _id: medicine._id,
        Medicine_Code: medicine.Medicine_Code,
        Medicine_Name: medicine.Medicine_Name,
        Strength: medicine.Strength,
        Institute_ID: medicine.Institute_ID,
        Quantity: medicine.Quantity
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const fetchInventory = async (id) => {
  try {
    const res = await axios.get(
      `http://localhost:${BACKEND_PORT}/institute-api/inventory/${id}`
    );
    console.log("📦 INVENTORY API RESPONSE:", res.data[0]); // Check first item
    console.log("Has _id field?", res.data[0]?._id ? "YES" : "NO");
    setInventory(res.data || []);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    setInventory([]);
  }
};

prescriptionApp.get('/download-pdf', async (req, res) => {
  try {
    const { employeeId, personId, fromDate, toDate, recordId, source } = req.query;
    if (!employeeId && !recordId) return res.status(400).json({ message: 'employeeId required' });

    console.debug('Prescription /download-pdf request', {
      recordId: String(recordId || ""),
      sourceHint: source || "",
      employeeId: employeeId || "",
      personId: personId || "",
      fromDate: fromDate || "",
      toDate: toDate || ""
    });

    if (recordId) {
      const resolved = await resolveSinglePrescriptionDownloadRecord({
        recordId,
        sourceHint: source
      });
      const record = resolved?.record || null;

      if (!record) {
        console.warn('Prescription record not available for download', {
          recordId: String(recordId || ""),
          sourceHint: source || ""
        });
        return res.status(404).json({ message: 'Prescription record not found' });
      }

      console.debug('Prescription /download-pdf resolved record', {
        recordId: String(recordId || ""),
        resolvedSource: resolved?.source || "unknown",
        sourceField: record?.Source || ""
      });

      const filename = `Prescription_${recordId}.pdf`;
      const filePath = await ensureStoredReportPdf('prescription', recordId, record);
      return sendStoredReportPdf(res, filePath, filename, "attachment");
    }

    const prescriptions = await fetchCombinedPrescriptionHistory({
      employeeId,
      personId: personId || "all",
      fromDate,
      toDate
    });

    const combinedBuffer = await generateCombinedReportPdf('prescription', prescriptions);

    const filename = `Prescriptions_${employeeId}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    return res.send(combinedBuffer);
  } catch (err) {
    console.error('Prescription PDF error:', err);
    res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
  }
});

prescriptionApp.get('/preview-html', async (req, res) => {
  try {
    const { recordId, source } = req.query;
    if (!recordId) return res.status(400).json({ message: 'recordId required' });

    const resolved = await resolveSinglePrescriptionDownloadRecord({
      recordId,
      sourceHint: source
    });
    const record = resolved?.record || null;

    if (!record) {
      return res.status(404).json({ message: 'Prescription record not found' });
    }

    res.setHeader('Content-type', 'text/html; charset=utf-8');
    return res.send(buildReportHtml('prescription', record));
  } catch (err) {
    console.error('Prescription preview HTML error:', err);
    res.status(500).json({ message: 'Failed to generate preview HTML', error: err.message });
  }
});

prescriptionApp.get('/preview-pdf', async (req, res) => {
  try {
    const { recordId, source } = req.query;
    if (!recordId) return res.status(400).json({ message: 'recordId required' });

    const resolved = await resolveSinglePrescriptionDownloadRecord({
      recordId,
      sourceHint: source
    });
    const record = resolved?.record || null;

    if (!record) {
      return res.status(404).json({ message: 'Prescription record not found' });
    }

    const filePath = await ensureStoredReportPdf('prescription', recordId, record);
    return sendStoredReportPdf(res, filePath, `Prescription_${recordId}.pdf`, "inline");
  } catch (err) {
    console.error('Prescription preview PDF error:', err);
    res.status(500).json({ message: 'Failed to load preview PDF', error: err.message });
  }
});

prescriptionApp.get("/queue/:instituteId", async (req, res) => {

  try {

    const { instituteId } = req.params;

    const start = new Date();
    start.setHours(0,0,0,0);

    const end = new Date();
    end.setHours(23,59,59,999);

    const visits = await DailyVisit.find({
      Institute_ID: instituteId,
      visit_date: { $gte: start, $lte: end }   // ONLY TODAY
    })
    .populate("employee_id")
    .populate("FamilyMember");

    const actions = await MedicalAction.find({
      action_type: "DOCTOR_PRESCRIPTION"
    });

    const visitIds = actions.map(a => String(a.visit_id));

    const pharmacyVisits = visits.filter(v =>
      visitIds.includes(String(v._id))
    );

    res.json(pharmacyVisits);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Queue error" });
  }

});

module.exports = prescriptionApp;
