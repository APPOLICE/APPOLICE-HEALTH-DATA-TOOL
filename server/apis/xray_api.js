const express = require("express");
const mongoose = require("mongoose");
const xrayApp = express.Router();
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const XrayRecord = require("../models/XrayRecordSchema");

const Institute = require("../models/master_institute");
const Employee = require("../models/employee");
const FamilyMember = require("../models/family_member");
const MedicalAction = require("../models/medical_action");
const DailyVisit = require("../models/daily_visit");
const multer = require('multer');
const MasterValue = require("../models/master_value");
const { uploadBufferToCloudinary } = require("../utils/cloudinary");
const {
  trimString,
  normalize,
  resolveInstituteIdFromRequest,
  ensureCategoryDoc,
  ensureValueRecord,
  ensureXrayMasterValues,
  listMasterXrays,
  listMasterXrayBodyParts,
  findMasterXrays,
  listMasterTests
} = require("../utils/instituteMasterData");
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
const { invalidatePrescriptionPdfsForEncounter } = require("../utils/prescriptionInvestigations");

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

const filterXraysByDate = (record, start, end) => {
  const xrays = Array.isArray(record?.Xrays) ? record.Xrays : [];
  if (!start && !end) return xrays;
  return xrays.filter((xray) => isWithinDateRange(xray?.Timestamp, start, end));
};

const filterXrayRecordsByDate = (records, start, end) => {
  return (Array.isArray(records) ? records : [])
    .map((record) => {
      const filteredXrays = filterXraysByDate(record, start, end);
      if (filteredXrays.length === 0) return null;
      return { ...record, Xrays: filteredXrays };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.Xrays[0]?.Timestamp || b.createdAt || 0) - new Date(a.Xrays[0]?.Timestamp || a.createdAt || 0));
};

const splitXrayRecordsByDate = (records) => {
  const rows = [];

  (records || []).forEach((record) => {
    const grouped = new Map();

    (record.Xrays || []).forEach((xray) => {
      const ts = xray?.Timestamp ? new Date(xray.Timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime())) return;

      const key = [
        ts.getFullYear(),
        String(ts.getMonth() + 1).padStart(2, "0"),
        String(ts.getDate()).padStart(2, "0")
      ].join("-");

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(xray);
    });

    grouped.forEach((xrays) => {
      rows.push({ ...record, Xrays: xrays });
    });
  });

  return rows.sort((a, b) => new Date(b.Xrays[0]?.Timestamp || b.createdAt || 0) - new Date(a.Xrays[0]?.Timestamp || a.createdAt || 0));
};

const formatPdfDateTime = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date);
};

// Admin helper: move a record-level report into a specific Xray subdocument.
xrayApp.post('/migrate-report', async (req, res) => {
  try {
    const { Record_ID, filename, xrayIndex } = req.body;
    if (!Record_ID || !filename) return res.status(400).json({ message: 'Record_ID and filename required' });

    const record = await XrayRecord.findById(Record_ID);
    if (!record) return res.status(404).json({ message: 'Record not found' });

    const report = (record.Reports || []).find(r => r.filename === filename || r.originalname === filename || String(r._id) === String(filename));
    if (!report) return res.status(404).json({ message: 'Report not found on record-level', availableReports: (record.Reports || []).map(r => r.filename) });

    let target = null;
    if (typeof xrayIndex !== 'undefined') {
      const idx = parseInt(xrayIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= (record.Xrays || []).length) return res.status(400).json({ message: 'Invalid xrayIndex' });
      target = idx;
    } else {
      const uploadedAt = report.uploadedAt ? new Date(report.uploadedAt) : null;
      if (!uploadedAt) return res.status(400).json({ message: 'Report has no uploadedAt; provide xrayIndex' });
      let best = { idx: -1, diff: Number.POSITIVE_INFINITY };
      (record.Xrays || []).forEach((x, idx) => {
        const t = x.Timestamp ? new Date(x.Timestamp) : null;
        if (!t) return;
        const diff = Math.abs(t - uploadedAt);
        if (diff < best.diff) best = { idx, diff };
      });
      if (best.idx === -1) return res.status(400).json({ message: 'No xray timestamps found; provide xrayIndex' });
      target = best.idx;
    }

    // remove from record-level
    record.Reports = (record.Reports || []).filter(r => !(r.filename === report.filename && String(r._id) === String(report._id)));

    if (!record.Xrays[target].Reports) record.Xrays[target].Reports = [];
    record.Xrays[target].Reports.push(report);

    await record.save();
    return res.json({ message: 'Report moved', recordId: record._id, targetIndex: target });
  } catch (err) {
    console.error('migrate-report error', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET master test list
xrayApp.get("/tests", async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Valid instituteId is required" });
    }

    const tests = await listMasterTests(instituteId);
    res.status(200).json(tests);
  } catch (err) {
    console.error("Error fetching tests:", err);
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

const xrayUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const requireInstituteAdmin = (req, res, next) => {
  if (req.user?.role !== "institute") {
    return res.status(403).json({ message: "Only institute admin can modify x-ray master data" });
  }
  next();
};

// ---------- DEBUG: Unauthenticated upload (for troubleshooting only) ----------
// Note: temporary endpoint to verify multer/storage behavior without auth.
xrayApp.post('/upload-debug', xrayUpload.single('report'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });
    const uploaded = await uploadBufferToCloudinary(file.buffer, {
      folder: "xray_reports"
    });

    const fileMeta = {
      filename: file.originalname,
      originalname: file.originalname,
      url: uploaded.secure_url,
      uploadedAt: new Date()
    };

    return res.status(201).json({ message: 'Debug upload saved', url: uploaded.secure_url, file: fileMeta });
  } catch (err) {
    console.error('X-ray debug upload error:', err);
    return res.status(500).json({ message: 'Debug upload failed', error: err.message });
  }
});
// GET all X-ray types
xrayApp.get("/types", async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Valid instituteId is required" });
    }

    const includeInactive = String(req.query?.includeInactive || "").toLowerCase() === "true";
    const xrays = await listMasterXrays(instituteId, { includeInactive });
    res.json(xrays);
  } catch (err) {
    console.error("Error fetching X-ray types:", err);
    res.status(500).json({ message: "Server error" });
  }
});

xrayApp.get("/visit/:visitId/doctor", async (req, res) => {
  try {
    const { visitId } = req.params;

    const actions = await MedicalAction.find({
      visit_id: visitId,
      action_type: "DOCTOR_XRAY"
    }).sort({ createdAt: -1 });

    if (!actions.length) {
      return res.json({ xrays: [] });
    }

    const xrays = actions.flatMap(a => a.data?.xrays || []);

    res.json({
      visit_id: visitId,
      xrays
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch doctor xrays" });
  }
});


xrayApp.get("/queue/:instituteId", async (req, res) => {
  try {

    const { instituteId } = req.params;

    const start = new Date();
    start.setHours(0,0,0,0);

    const end = new Date();
    end.setHours(23,59,59,999);

    const visits = await DailyVisit.find({
      Institute_ID: instituteId,
      visit_date: { $gte: start, $lte: end }   // only today tokens
    })
    .populate("employee_id")
    .populate("FamilyMember");

    const actions = await MedicalAction.find({
      action_type: "DOCTOR_XRAY"
    });

    const visitIds = actions.map(a => String(a.visit_id));

    const xrayVisits = visits.filter(v =>
      visitIds.includes(String(v._id))
    );

    res.json(xrayVisits);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch x-ray queue" });
  }
});

xrayApp.post("/xrays/add", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const {
      Xray_Type,
      Body_Part,
      Side,
      View,
      Film_Size
    } = req.body;

    if (!Xray_Type || !Body_Part) {
      return res.status(400).json({
        message: "Xray_Type and Body_Part are required"
      });
    }
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Valid instituteId is required" });
    }

    const category = await ensureCategoryDoc(instituteId, "Xray Types");
    await ensureXrayMasterValues(instituteId);
    await ensureValueRecord({
      instituteId,
      categoryId: category._id,
      valueName: Body_Part,
      meta: { kind: "xray_body_part", bodyPart: trimString(Body_Part) }
    });

    const exists = await MasterValue.findOne({
      Institute_ID: instituteId,
      category_id: category._id,
      normalized_value: normalize(Xray_Type),
      "meta.kind": "xray"
    });
    if (exists) {
      return res.status(400).json({
        message: "X-ray type already exists"
      });
    }

    const newXray = await ensureValueRecord({
      instituteId,
      categoryId: category._id,
      valueName: Xray_Type,
      meta: {
        kind: "xray",
        bodyPart: trimString(Body_Part),
        side: trimString(Side) || "NA",
        view: trimString(View),
        filmSize: trimString(Film_Size)
      }
    });

    res.status(201).json({
      message: "X-ray created",
      xray: {
        _id: newXray._id,
        Xray_Type: trimString(newXray.value_name),
        Body_Part: trimString(newXray?.meta?.bodyPart),
        Side: trimString(newXray?.meta?.side) || "NA",
        View: trimString(newXray?.meta?.view),
        Film_Size: trimString(newXray?.meta?.filmSize),
        status: newXray.status || "Active"
      }
    });

  } catch (err) {
    console.error("Error adding xray:", err);
    res.status(500).json({
      error: "Failed to add xray"
    });
  }
});

xrayApp.put("/xrays/:id", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const { id } = req.params;
    const category = await ensureCategoryDoc(instituteId, "Xray Types");
    const xray = await MasterValue.findOne({
      _id: id,
      Institute_ID: instituteId,
      category_id: category?._id,
      "meta.kind": "xray"
    });
    if (!xray) {
      return res.status(404).json({ message: "X-ray not found" });
    }

    const Xray_Type = String(req.body.Xray_Type || "").trim();
    const Body_Part = String(req.body.Body_Part || "").trim();
    const Side = String(req.body.Side || "NA").trim() || "NA";
    const View = String(req.body.View || "").trim();
    const Film_Size = String(req.body.Film_Size || "").trim();
    const status = String(req.body.status || "").trim();

    if (Body_Part) {
      await ensureValueRecord({
        instituteId,
        categoryId: category._id,
        valueName: Body_Part,
        meta: { kind: "xray_body_part", bodyPart: Body_Part }
      });
    }

    if (Xray_Type) xray.value_name = Xray_Type;
    xray.normalized_value = normalize(xray.value_name);
    xray.meta = {
      ...(xray.meta || {}),
      kind: "xray",
      bodyPart: Body_Part || trimString(xray?.meta?.bodyPart),
      side: Side,
      view: View,
      filmSize: Film_Size
    };
    if (status === "Active" || status === "Inactive") {
      xray.status = status;
    }

    await xray.save();
    res.json({
      message: "X-ray updated",
      xray: {
        _id: xray._id,
        Xray_Type: trimString(xray.value_name),
        Body_Part: trimString(xray?.meta?.bodyPart),
        Side: trimString(xray?.meta?.side) || "NA",
        View: trimString(xray?.meta?.view),
        Film_Size: trimString(xray?.meta?.filmSize),
        status: xray.status || "Active"
      }
    });
  } catch (err) {
    console.error("Error updating xray:", err);
    res.status(500).json({ message: "Failed to update xray", error: err.message });
  }
});

xrayApp.delete("/xrays/:id", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const { id } = req.params;
    const category = await ensureCategoryDoc(instituteId, "Xray Types");
    const deleted = await MasterValue.findOneAndDelete({
      _id: id,
      Institute_ID: instituteId,
      category_id: category?._id,
      "meta.kind": "xray"
    });
    if (!deleted) {
      return res.status(404).json({ message: "X-ray not found" });
    }
    res.json({ message: "X-ray deleted" });
  } catch (err) {
    console.error("Error deleting xray:", err);
    res.status(500).json({ message: "Failed to delete xray", error: err.message });
  }
});



xrayApp.post(
"/add",
verifyToken,
allowInstituteRoles("xray"),
xrayUpload.array("reports"),
async (req,res)=>{

try{

console.log("BODY:",req.body);
console.log("FILES:",req.files);

const {
  Institute_ID,
  Employee_ID,
  IsFamilyMember,
  FamilyMember_ID,
  Xray_Notes,
  visit_id
} = req.body;


/* ---------------- SAFE XRAY PARSE ---------------- */

let xrays = [];

try{

xrays = JSON.parse(req.body.Xrays || "[]");

}
catch(err){

console.error("Xray JSON parse error:",err);
xrays = [];

}


/* ---------------- REMOVE ReportFile FIELD ---------------- */

xrays.forEach(x=>{
delete x.ReportFile;
});

await ensureXrayMasterValues(Institute_ID);

const xrayIds = [
  ...new Set(
    xrays
      .map((item) => item?.Xray_ID)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )
];
const xrayNames = [
  ...new Set(
    xrays
      .map((item) => trimString(item?.Xray_Type))
      .filter(Boolean)
  )
];

const masterXrays = [
  ...(xrayIds.length ? await findMasterXrays(Institute_ID, { ids: xrayIds }) : []),
  ...(xrayNames.length ? await findMasterXrays(Institute_ID, { names: xrayNames }) : [])
];

const masterById = new Map(masterXrays.map((row) => [String(row._id), row]));
const masterByName = new Map(masterXrays.map((row) => [trimString(row?.value_name).toLowerCase(), row]));

xrays = xrays.map((item) => {
  const master =
    (item?.Xray_ID ? masterById.get(String(item.Xray_ID)) : null) ||
    masterByName.get(trimString(item?.Xray_Type).toLowerCase()) ||
    null;

  return {
    ...item,
    Xray_ID: master?._id || item?.Xray_ID || null,
    Xray_Type: trimString(master?.value_name) || trimString(item?.Xray_Type),
    Body_Part: trimString(master?.meta?.bodyPart) || trimString(item?.Body_Part),
    Side: trimString(master?.meta?.side) || trimString(item?.Side) || "NA",
    View: trimString(master?.meta?.view) || trimString(item?.View),
    Film_Size: trimString(item?.Film_Size || master?.meta?.filmSize)
  };
});


/* ---------------- ATTACH FILES TO XRAYS ---------------- */

const files = req.files || [];
let reportFileIndexes = [];
try {
  reportFileIndexes = JSON.parse(req.body.reportFileIndexes || "[]");
} catch {
  reportFileIndexes = [];
}

for (let index = 0; index < xrays.length; index += 1) {
  const fileIndex = reportFileIndexes.indexOf(index);
  const file = files[fileIndex >= 0 ? fileIndex : index];
  if (!file?.buffer) continue;
  const uploaded = await uploadBufferToCloudinary(file.buffer, {
    folder: "xray_reports"
  });
  xrays[index].Reports = [
    {
      filename: file.originalname,
      originalname: file.originalname,
      url: uploaded.secure_url,
      uploadedBy: req.user?.id || "system",
      uploadedAt: new Date()
    }
  ];
}


/* ---------------- HANDLE FAMILY MEMBER CORRECTLY ---------------- */

const isFamily =
(IsFamilyMember === "true" || IsFamilyMember === true);


/* ---------------- CREATE XRAY RECORD ---------------- */

const record = new XrayRecord({

Institute:Institute_ID,

Employee:Employee_ID,

Visit: mongoose.Types.ObjectId.isValid(visit_id) ? visit_id : null,

IsFamilyMember:isFamily,

FamilyMember:
isFamily && FamilyMember_ID
? new mongoose.Types.ObjectId(FamilyMember_ID)
: null,

Xrays:xrays,

Xray_Notes:Xray_Notes || ""

});


/* ---------------- SAVE ---------------- */

await record.save();

await invalidatePrescriptionPdfsForEncounter({
  employeeId: Employee_ID,
  visitId: visit_id || null,
  familyMemberId: isFamily && FamilyMember_ID ? FamilyMember_ID : null,
  timestamp: new Date(),
});

const populatedRecord = await XrayRecord.findById(record._id)
.populate('Employee', 'Name ABS_NO DOB Gender Blood_Group')
.populate('FamilyMember', 'Name Relationship DOB Gender Blood_Group')
.populate('Institute', 'Institute_Name')
.lean();
await storeReportPdf('xray', record._id, populatedRecord);


return res.status(201).json({

message:"Xray record saved successfully",

record

});


}
catch(err){

console.error("XRAY SAVE ERROR:",err);

return res.status(500).json({

message:"Failed to save Xray record",

error:err.message

});

}

}
);

// ✅ Get all body parts
xrayApp.get("/body-parts", verifyToken, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Valid instituteId is required" });
    }

    const includeInactive = String(req.query?.includeInactive || "").toLowerCase() === "true";
    const result = await listMasterXrayBodyParts(instituteId, { includeInactive });
    res.json(result);
  } catch (err) {
    console.error("Error fetching body parts:", err);
    res.status(500).json({ message: "Failed to fetch body parts", error: err.message });
  }
});

// ✅ Add a new body part
xrayApp.post("/body-parts", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const { Body_Part } = req.body;
    
    if (!Body_Part || !String(Body_Part).trim()) {
      return res.status(400).json({ message: "Body_Part is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Valid instituteId is required" });
    }

    const bp = String(Body_Part).trim();

    const category = await ensureCategoryDoc(instituteId, "Xray Types");
    const existing = await MasterValue.findOne({
      Institute_ID: instituteId,
      category_id: category?._id,
      normalized_value: normalize(bp),
      "meta.kind": "xray_body_part"
    });
    if (existing) {
      return res.status(409).json({ message: "This body part already exists" });
    }

    const saved = await ensureValueRecord({
      instituteId,
      categoryId: category._id,
      valueName: bp,
      meta: { kind: "xray_body_part", bodyPart: bp }
    });
    console.log(`Body part added: ${bp}`);
    
    res.status(201).json({
      _id: saved._id,
      Body_Part: saved.value_name,
      status: saved.status || "Active",
      message: "Body part added successfully"
    });
  } catch (err) {
    console.error("Error adding body part:", err);
    res.status(500).json({ message: "Failed to add body part", error: err.message });
  }
});

// ✅ Update a body part (name and/or status)
xrayApp.put("/body-parts/:id", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const { id } = req.params;
    const { Body_Part, status } = req.body;
    const category = await ensureCategoryDoc(instituteId, "Xray Types");

    const bodyPartRecord = await MasterValue.findOne({
      _id: id,
      Institute_ID: instituteId,
      category_id: category?._id,
      "meta.kind": "xray_body_part"
    });
    if (!bodyPartRecord) {
      return res.status(404).json({ message: "Body part not found" });
    }

    const oldBodyPart = bodyPartRecord.value_name;

    if (Body_Part && String(Body_Part).trim()) {
      const newBodyPart = String(Body_Part).trim();
      
      if (newBodyPart !== oldBodyPart) {
        const existing = await MasterValue.findOne({
          _id: { $ne: id },
          Institute_ID: instituteId,
          category_id: category?._id,
          normalized_value: normalize(newBodyPart),
          "meta.kind": "xray_body_part"
        });
        if (existing) {
          return res.status(409).json({ message: "This body part name already exists" });
        }

        await MasterValue.updateMany(
          {
            Institute_ID: instituteId,
            category_id: category?._id,
            "meta.kind": "xray",
            "meta.bodyPart": oldBodyPart
          },
          { $set: { "meta.bodyPart": newBodyPart } }
        );
      }
      bodyPartRecord.value_name = newBodyPart;
      bodyPartRecord.normalized_value = normalize(newBodyPart);
      bodyPartRecord.meta = {
        ...(bodyPartRecord.meta || {}),
        kind: "xray_body_part",
        bodyPart: newBodyPart
      };
    }

    if (status === "Active" || status === "Inactive") {
      bodyPartRecord.status = status;
      await MasterValue.updateMany(
        {
          Institute_ID: instituteId,
          category_id: category?._id,
          "meta.kind": "xray",
          "meta.bodyPart": Body_Part && String(Body_Part).trim() ? String(Body_Part).trim() : oldBodyPart
        },
        { $set: { status } }
      );
    }

    const updated = await bodyPartRecord.save();
    
    console.log(`Body part updated: ${oldBodyPart} -> ${updated.value_name || oldBodyPart}`);

    res.json({
      _id: updated._id,
      Body_Part: updated.value_name,
      status: updated.status,
      message: "Body part updated successfully"
    });
  } catch (err) {
    console.error("Error updating body part:", err);
    res.status(500).json({ message: "Failed to update body part", error: err.message });
  }
});

// ✅ Delete a body part and all its X-rays
xrayApp.delete("/body-parts/:id", verifyToken, requireInstituteAdmin, async (req, res) => {
  try {
    const instituteId = resolveInstituteIdFromRequest(req);
    const { id } = req.params;
    const category = await ensureCategoryDoc(instituteId, "Xray Types");

    const bodyPartRecord = await MasterValue.findOne({
      _id: id,
      Institute_ID: instituteId,
      category_id: category?._id,
      "meta.kind": "xray_body_part"
    });
    if (!bodyPartRecord) {
      return res.status(404).json({ message: "Body part not found" });
    }

    const bodyPartName = bodyPartRecord.value_name;

    const deleteResult = await MasterValue.deleteMany({
      Institute_ID: instituteId,
      category_id: category?._id,
      "meta.kind": "xray",
      "meta.bodyPart": bodyPartName
    });
    await bodyPartRecord.deleteOne();

    console.log(`Deleted body part '${bodyPartName}' and ${deleteResult.deletedCount} X-rays`);

    res.json({ 
      message: "Body part deleted successfully",
      bodyPart: bodyPartName,
      xraysDeleted: deleteResult.deletedCount
    });
  } catch (err) {
    console.error("Error deleting body part:", err);
    res.status(500).json({ message: "Failed to delete body part", error: err.message });
  }
});

// ✅ Get all diagnosis records for a person
xrayApp.get("/records/:personId", async (req, res) => {
  try {
    const { personId } = req.params;
    const { isFamily, familyId, personId: selectedPersonId, fromDate, toDate } = req.query;

    if (!mongoose.Types.ObjectId.isValid(personId))
      return res.status(400).json({ message: "Invalid ID" });

    // default behaviour: return all records belonging to this employee, including
    // family‑member entries. A query may still request a specific family member by
    // setting ?isFamily=true&familyId=<id> (used by institute entry form).
    const filter = { Employee: personId };

    if (selectedPersonId === "self") {
      filter.IsFamilyMember = false;
    } else if (selectedPersonId && selectedPersonId !== "all") {
      filter.IsFamilyMember = true;
      filter.FamilyMember = selectedPersonId;
    } else if (isFamily === "true" && familyId) {
      filter.IsFamilyMember = true;
      filter.FamilyMember = familyId;
    }
    // else leave filter alone so both self and family rows are returned

    const { start, end } = buildDateRange(fromDate, toDate);
    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = end;
      filter["Xrays.Timestamp"] = dateFilter;
    }

    const records = await XrayRecord.find(filter)
      .populate("Employee", "Name")
      .populate("Institute", "Institute_Name")
      .populate("FamilyMember", "Name Relationship")
      .sort({ createdAt: -1 });

    const filteredRecords = filterXrayRecordsByDate(
      records.map((record) => record.toObject()),
      start,
      end
    );

    res.status(200).json(filteredRecords);

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch records" });
  }
});

xrayApp.get('/download-pdf', async (req, res) => {
  try {
    const { employeeId, personId, fromDate, toDate, recordId } = req.query;
    if (!employeeId && !recordId) return res.status(400).json({ message: 'employeeId required' });

    if (recordId) {
      const record = await XrayRecord.findById(recordId)
        .populate('Employee', 'Name ABS_NO DOB Gender Blood_Group')
        .populate('FamilyMember', 'Name Relationship DOB Gender Blood_Group')
        .populate('Institute', 'Institute_Name')
        .lean();

      if (!record) {
        return res.status(404).json({ message: 'X-ray record not found' });
      }

      const filename = `Xray_Report_${recordId}.pdf`;
      const filePath = await ensureStoredReportPdf('xray', recordId, record);
      return sendStoredReportPdf(res, filePath, filename, "attachment");
    }

    const filter = { Employee: employeeId };
    if (personId === "self") filter.IsFamilyMember = false;
    else if (personId && personId !== "all") {
      filter.IsFamilyMember = true;
      filter.FamilyMember = personId;
    }

    const { start, end } = buildDateRange(fromDate, toDate);
    if (start || end) {
      const dateFilter = {};
      if (start) dateFilter.$gte = start;
      if (end) dateFilter.$lte = end;
      filter["Xrays.Timestamp"] = dateFilter;
    }

    const records = await XrayRecord.find(filter)
      .populate('Employee', 'Name ABS_NO')
      .populate('FamilyMember', 'Name Relationship')
      .populate('Institute', 'Institute_Name')
      .sort({ createdAt: -1 })
      .lean();

    const filteredRecords = filterXrayRecordsByDate(records, start, end);
    const rows = splitXrayRecordsByDate(filteredRecords);

    const combinedBuffer = await generateCombinedReportPdf('xray', rows);

    const filename = `Xray_Reports_${employeeId}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    return res.send(combinedBuffer);
  } catch (err) {
    console.error('Xray PDF error:', err);
    res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
  }
});

const sendXrayPreviewHtml = async (req, res) => {
  try {
    const recordId = req.params.recordId || req.query.recordId || req.query.id;
    if (!recordId) return res.status(400).json({ message: 'recordId required' });

    const record = await XrayRecord.findById(recordId)
      .populate('Employee', 'Name ABS_NO DOB Gender Blood_Group')
      .populate('FamilyMember', 'Name Relationship DOB Gender Blood_Group')
      .populate('Institute', 'Institute_Name')
      .lean();

    if (!record) {
      return res.status(404).json({ message: 'X-ray record not found' });
    }

    res.setHeader('Content-type', 'text/html; charset=utf-8');
    return res.send(buildReportHtml('xray', record));
  } catch (err) {
    console.error('Xray preview HTML error:', err);
    res.status(500).json({ message: 'Failed to generate preview HTML', error: err.message });
  }
};

xrayApp.get('/preview-html', sendXrayPreviewHtml);
xrayApp.get('/preview-html/:recordId', sendXrayPreviewHtml);

const sendXrayPreviewPdf = async (req, res) => {
  try {
    const recordId = req.params.recordId || req.query.recordId || req.query.id;
    if (!recordId) return res.status(400).json({ message: 'recordId required' });

    const record = await XrayRecord.findById(recordId)
      .populate('Employee', 'Name ABS_NO DOB Gender Blood_Group')
      .populate('FamilyMember', 'Name Relationship DOB Gender Blood_Group')
      .populate('Institute', 'Institute_Name')
      .lean();

    if (!record) {
      return res.status(404).json({ message: 'X-ray record not found' });
    }

    const filePath = await ensureStoredReportPdf('xray', recordId, record);
    return sendStoredReportPdf(res, filePath, `Xray_Report_${recordId}.pdf`, "inline");
  } catch (err) {
    console.error('Xray preview PDF error:', err);
    res.status(500).json({ message: 'Failed to load preview PDF', error: err.message });
  }
};

xrayApp.get('/preview-pdf', sendXrayPreviewPdf);
xrayApp.get('/preview-pdf/:recordId', sendXrayPreviewPdf);

module.exports = xrayApp;
