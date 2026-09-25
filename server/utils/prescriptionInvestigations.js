const mongoose = require("mongoose");
const DiagnosisRecord = require("../models/diagnostics_record");
const XrayRecord = require("../models/XrayRecordSchema");
const MedicalAction = require("../models/medical_action");
const Prescription = require("../models/Prescription");
const { invalidateStoredReportPdf } = require("./storedReportPdf");

const toId = (value) => {
  if (!value) return null;
  const id = value?._id || value;
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

const dayRange = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { $gte: start, $lt: end };
};

const samePerson = (record, familyMemberId) => {
  if (familyMemberId) {
    return Boolean(record.IsFamilyMember) && String(record.FamilyMember || "") === String(familyMemberId);
  }
  return !record.IsFamilyMember;
};

const buildEncounterFilter = ({ employeeId, visitId, familyMemberId, timestamp, nestedTimestampPath }) => {
  const filter = { Employee: employeeId };
  if (familyMemberId) filter.FamilyMember = familyMemberId;
  else filter.IsFamilyMember = false;

  const alternatives = [];
  if (visitId) alternatives.push({ Visit: visitId });
  const range = dayRange(timestamp);
  if (range) alternatives.push({ [nestedTimestampPath || "createdAt"]: range });
  if (alternatives.length) filter.$or = alternatives;
  return filter;
};

const hydratePrescriptionInvestigations = async (record = {}) => {
  const employeeId = toId(record.Employee);
  if (!employeeId) return record;

  const visitId = toId(record.visit_id || record.VisitSummary?._id);
  const familyMemberId = toId(record.FamilyMember);
  const filter = buildEncounterFilter({
    employeeId,
    visitId,
    familyMemberId,
    timestamp: record.Timestamp || record.createdAt || record.created_at,
    nestedTimestampPath: "Tests.Timestamp",
  });
  const xrayFilter = buildEncounterFilter({
    employeeId,
    visitId,
    familyMemberId,
    timestamp: record.Timestamp || record.createdAt || record.created_at,
    nestedTimestampPath: "Xrays.Timestamp",
  });

  const [diagnosisRecords, xrayRecords] = await Promise.all([
    DiagnosisRecord.find(filter)
      .select("Tests Visit Employee IsFamilyMember FamilyMember createdAt updatedAt")
      .lean(),
    XrayRecord.find(xrayFilter)
      .select("Xrays Visit Employee IsFamilyMember FamilyMember createdAt updatedAt")
      .lean(),
  ]);

  const labTests = diagnosisRecords
    .filter((row) => samePerson(row, familyMemberId))
    .flatMap((row) => row.Tests || [])
    .map((test) => ({
      Test_Name: test.Test_Name,
      Test_ID: test.Test_ID,
      Result_Value: test.Result_Value,
      Units: test.Units,
      Reference_Range: test.Reference_Range,
    }))
    .filter((test) => test.Test_Name);

  const radiology = xrayRecords
    .filter((row) => samePerson(row, familyMemberId))
    .flatMap((row) => row.Xrays || [])
    .map((xray) => ({
      Xray_Type: xray.Xray_Type,
      Xray_ID: xray.Xray_ID,
      Body_Part: xray.Body_Part,
      Impression: xray.Impression,
    }))
    .filter((xray) => xray.Xray_Type);

  return {
    ...record,
    Investigations: { labTests, radiology },
  };
};

const invalidatePrescriptionPdfsForEncounter = async ({ employeeId, visitId, familyMemberId, timestamp = new Date() }) => {
  const employee = toId(employeeId);
  if (!employee) return 0;

  const actionFilter = {
    employee_id: employee,
    action_type: "DOCTOR_PRESCRIPTION",
  };
  const pharmacyFilter = { Employee: employee };
  if (visitId) {
    actionFilter.$or = [{ visit_id: visitId }, { created_at: dayRange(timestamp) }];
    pharmacyFilter.$or = [{ visit_id: visitId }, { Timestamp: dayRange(timestamp) }];
  } else {
    actionFilter.created_at = dayRange(timestamp);
    pharmacyFilter.Timestamp = dayRange(timestamp);
  }
  if (familyMemberId) {
    actionFilter["data.FamilyMember_ID"] = familyMemberId;
    pharmacyFilter.FamilyMember = familyMemberId;
  }

  const [actions, prescriptions] = await Promise.all([
    MedicalAction.find(actionFilter).select("_id").lean(),
    Prescription.find(pharmacyFilter).select("_id").lean(),
  ]);

  await Promise.all([
    ...actions.map((row) => invalidateStoredReportPdf("prescription", row._id)),
    ...prescriptions.map((row) => invalidateStoredReportPdf("prescription", row._id)),
  ]);

  return actions.length + prescriptions.length;
};

module.exports = {
  hydratePrescriptionInvestigations,
  invalidatePrescriptionPdfsForEncounter,
};
