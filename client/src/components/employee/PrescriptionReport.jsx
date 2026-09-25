import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import PersonFilterDropdown from "../common/PersonFilterDropdown";
import { usePersonFilter } from "../../context/PersonFilterContext";
import DateRangeFilter from "../common/DateRangeFilter";
import PDFDownloadButton from "../common/PDFDownloadButton";
import { buildReportDownloadUrl, downloadPdfBlob } from "../../utils/pdfDownload";
import ReportHtmlPreview from "../common/ReportHtmlPreview";
import "bootstrap/dist/css/bootstrap.min.css";

const getFamilyMemberId = (row) => {
  if (!row) return "";
  if (typeof row.FamilyMember === "string") return row.FamilyMember;
  if (row.FamilyMember?._id) return row.FamilyMember._id;
  if (row.FamilyMember_ID) return row.FamilyMember_ID;
  return "";
};

const matchesPersonScope = (record, personId = "self") => {
  if (personId === "all" || !personId) return true;
  if (personId === "self") return !record?.IsFamilyMember;
  return record?.IsFamilyMember && String(getFamilyMemberId(record)) === String(personId);
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
  _source: source,
});

const getPrescriptionTimestamp = (record) =>
  record?.Timestamp || record?.created_at || record?.createdAt || null;

const getDiagnosisReportDate = (record) =>
  record?.Tests?.[0]?.Timestamp || record?.Timestamp || record?.updatedAt || record?.createdAt || null;

const getXrayReportDate = (record) =>
  record?.Xrays?.[0]?.Timestamp || record?.Timestamp || record?.updatedAt || record?.createdAt || null;

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

const getPrescriptionMedicines = (record) => {
  const source = record?.Source === "DOCTOR_PRESCRIPTION" ? "Doctor" : "Pharmacy";
  const rows = Array.isArray(record?.mergedMedicines)
    ? record.mergedMedicines
    : Array.isArray(record?.Medicines)
      ? record.Medicines
      : [];

  return rows.map((medicine) => normalizeMedicineRow(medicine, medicine?._source || source));
};

const calculateAgeFromDob = (dob) => {
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

const formatDate = (dateStr) => {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const getEnrichedPrescriptionHistory = (
  actions = [],
  prescriptions = [],
  diagnosisRecords = [],
  xrayRecords = [],
  personId = "self"
) => {
  const safeActions = Array.isArray(actions) ? actions : [];
  const safePrescriptions = (Array.isArray(prescriptions) ? prescriptions : []).filter((record) =>
    matchesPersonScope(record, personId)
  );
  const safeDiagnosis = (Array.isArray(diagnosisRecords) ? diagnosisRecords : []).filter((record) =>
    matchesPersonScope(record, personId)
  );
  const safeXrays = (Array.isArray(xrayRecords) ? xrayRecords : []).filter((record) =>
    matchesPersonScope(record, personId)
  );

  const doctorPrescriptionActions = safeActions.filter(
    (action) => action?.action_type === "DOCTOR_PRESCRIPTION" && matchesPersonScope(action?.data || {}, personId)
  );
  const diagnosisActions = safeActions.filter(
    (action) => action?.action_type === "DOCTOR_DIAGNOSIS" && matchesPersonScope(action?.data || {}, personId)
  );
  const xrayActions = safeActions.filter(
    (action) => action?.action_type === "DOCTOR_XRAY" && matchesPersonScope(action?.data || {}, personId)
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
      record: matchingRecord,
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
      record: matchingRecord,
    };
  };

  return safePrescriptions
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
              _source: pharmacyMatch ? "Pharmacy" : "Doctor",
            };
          })
        : issuedMedicines;

      const relatedTests = (diagnosisAction?.data?.tests || []).map((test) => ({
        ...test,
        matchedResult: matchDiagnosisResult(test, record),
      }));

      const relatedXrays = (xrayAction?.data?.xrays || []).map((xray) => ({
        ...xray,
        matchedResult: matchXrayResult(xray, record),
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
        instituteDisplayName: record?.Institute?.Institute_Name || "",
      };
    })
    .sort((left, right) => new Date(getPrescriptionTimestamp(right) || 0) - new Date(getPrescriptionTimestamp(left) || 0));
};

const PrescriptionReport = () => {
  const FALLBACK_PROFILE_IMAGE = "/profile-fallback.png";
  const [prescriptions, setPrescriptions] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [downloadingId, setDownloadingId] = useState("");
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:6100";
  const employeeObjectId = localStorage.getItem("employeeObjectId");
  const employeeId = localStorage.getItem("employeeId") || employeeObjectId;
  const { selectedPersonId, setSelectedPersonId, options, loadingFamily } = usePersonFilter(employeeObjectId || employeeId);

  const resolveProfileImageUrl = (photoPath) => {
    if (!photoPath) return FALLBACK_PROFILE_IMAGE;
    if (/^https?:\/\//i.test(photoPath)) return photoPath;
    const base = String(BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(photoPath).replace(/^\/+/, "")}`;
  };


  useEffect(() => {
    if (!employeeObjectId) return;
    fetchPrescriptions();
  }, [employeeObjectId, selectedPersonId, fromDate, toDate]);

  useEffect(() => {
    if (!employeeObjectId) return;

    const loadProfiles = async () => {
      try {
        const [profileRes, familyRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/employee-api/profile/${employeeObjectId}`).catch(() => ({ data: null })),
          axios.get(`${BACKEND_URL}/family-api/family/${employeeObjectId}`).catch(() => ({ data: [] })),
        ]);

        setEmployeeProfile(profileRes?.data || null);
        setFamilyMembers(Array.isArray(familyRes?.data) ? familyRes.data : []);
      } catch {
        setEmployeeProfile(null);
        setFamilyMembers([]);
      }
    };

    loadProfiles();
  }, [BACKEND_URL, employeeObjectId]);

  const activeFamilyProfile = useMemo(() => {
    if (!selectedPersonId || selectedPersonId === "self" || selectedPersonId === "all") return null;
    return familyMembers.find((member) => String(member?._id) === String(selectedPersonId)) || null;
  }, [familyMembers, selectedPersonId]);

  const activePersonProfile = activeFamilyProfile || employeeProfile || null;
  const activePersonLabel = activeFamilyProfile
    ? `${activeFamilyProfile?.Name || "Family Member"}${activeFamilyProfile?.Relationship ? ` (${activeFamilyProfile.Relationship})` : ""}`
    : employeeProfile?.Name || "Employee";
  const activePersonAbsNo = employeeProfile?.ABS_NO || "—";
  const activePersonBloodGroup = activePersonProfile?.Blood_Group || employeeProfile?.Blood_Group || "—";
  const activePersonGender = activePersonProfile?.Gender || "—";
  const activePersonAge = activePersonProfile?.Age || calculateAgeFromDob(activePersonProfile?.DOB) || "—";
  const activePersonLastVisit = prescriptions.length > 0
    ? formatDate(getPrescriptionTimestamp(prescriptions[0]))
    : "—";

  const fetchPrescriptions = async () => {
    setLoading(true);
    try {
      const [prescriptionRes, actionsRes, diagnosisRes, xrayRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/prescription-api/employee/${employeeObjectId}`, {
          params: {
            employeeId: employeeObjectId,
            personId: selectedPersonId,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
          },
        }),
        axios.get(`${BACKEND_URL}/api/medical-actions/employee/${employeeObjectId}`).catch(() => ({ data: [] })),
        axios.get(`${BACKEND_URL}/diagnosis-api/records/${employeeObjectId}`, {
          params: {
            personId: selectedPersonId,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
          },
        }).catch(() => ({ data: [] })),
        axios.get(`${BACKEND_URL}/xray-api/records/${employeeObjectId}`, {
          params: {
            personId: selectedPersonId,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
          },
        }).catch(() => ({ data: [] })),
      ]);

      const payload = prescriptionRes.data && prescriptionRes.data.value ? prescriptionRes.data.value : prescriptionRes.data;
      const list = Array.isArray(payload) ? payload : [];
      const enriched = getEnrichedPrescriptionHistory(
        actionsRes?.data || [],
        list,
        diagnosisRes?.data || [],
        xrayRes?.data || [],
        selectedPersonId
      );

      setPrescriptions(enriched);
    } catch (err) {
      console.error("Error fetching prescriptions:", err);
      setPrescriptions([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      alert("From Date cannot be after To Date");
      return;
    }
    fetchPrescriptions();
  };

  const downloadPrescriptionReport = async (prescription) => {
    try {
      const recordId = String(prescription?._id || prescription?.visit_id || "");
      console.debug("Prescription download clicked", {
        recordId,
        source: prescription?.Source || "",
        visitId: prescription?.visit_id || "",
      });
      setDownloadingId(recordId || "download");
      const downloadUrl = buildReportDownloadUrl(BACKEND_URL, "prescription-api", {
        recordId,
        source: prescription?.Source || "",
        employeeId: employeeObjectId,
        personId: selectedPersonId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });

      await downloadPdfBlob({
        url: downloadUrl,
        filename: `Doctor_Prescription_${String(prescription?.visit_id || prescription?._id || "report").slice(-6)}.pdf`,
      });
    } catch (err) {
      console.error("Prescription report download failed:", err);
      alert("Unable to download prescription report");
    } finally {
      setDownloadingId("");
    }
  };

  return (
    <div
      className="employee-prescription-page"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(191,219,254,0.62), transparent 24%), radial-gradient(circle at right center, rgba(224,242,254,0.74), transparent 28%), linear-gradient(180deg, #F5FAFF, #EEF6FF)",
        minHeight: "100vh",
        padding: "40px 0",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style>
        {`
          .employee-prescription-page .health-card,
          .employee-prescription-page .modal-content {
            background: rgba(255,255,255,0.78);
            border: 1px solid rgba(255,255,255,0.88);
            border-radius: 24px;
            box-shadow: 0 24px 44px rgba(148,184,255,0.18);
            backdrop-filter: blur(18px);
          }

          .employee-prescription-page .table {
            --bs-table-bg: transparent;
          }

          .employee-prescription-page .table thead th {
            background: #EFF6FF;
            color: #1E3A8A;
            border-color: rgba(191,219,254,0.78);
            white-space: nowrap;
          }

          .employee-prescription-page .table tbody tr:hover {
            background: rgba(239,246,255,0.72);
          }
        `}
      </style>
      <div className="container">
        <button
          className="btn mb-4"
          onClick={() => window.history.back()}
          style={{
            backgroundColor: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(191,219,254,0.82)",
            borderRadius: "14px",
            padding: "6px 14px",
            fontSize: "14px",
            color: "#1F2933",
            boxShadow: "0 12px 20px rgba(191,219,254,0.14)",
          }}
        >
          ← Back
        </button>

        <div className="mb-4">
          <h3 style={{ fontWeight: 600, color: "#1F2933" }}>
            Prescription Records
          </h3>
          <p style={{ color: "#6B7280", marginBottom: 0 }}>
            All medicines issued to you and your family members
          </p>
          <div className="mt-3" style={{ maxWidth: "100%" }}>
            <div className="d-flex align-items-end gap-3 flex-wrap">
              <PersonFilterDropdown
                options={options}
                value={selectedPersonId}
                onChange={(val) => {
                  setSelectedPersonId(val);
                  setSelectedPrescription(null);
                }}
                loading={loadingFamily}
              />

              <DateRangeFilter
                fromDate={fromDate}
                toDate={toDate}
                setFromDate={setFromDate}
                setToDate={setToDate}
                onApply={applyFilter}
              />

              <div className="d-flex gap-2">
                <button
                  className="btn btn-sm"
                  style={{
                    backgroundColor: "#4A70A9",
                    color: "#FFFFFF",
                    borderRadius: "999px",
                    padding: "6px 16px",
                    fontWeight: 500,
                    border: "none",
                    height: "38px",
                  }}
                  onClick={() => fetchPrescriptions()}
                >
                  Refresh
                </button>

                <PDFDownloadButton
                  modulePath="prescription-api"
                  params={{ employeeId: employeeObjectId, personId: selectedPersonId, fromDate, toDate }}
                  filenamePrefix={`Prescriptions_${employeeId}`}
                />
              </div>
            </div>
          </div>
        </div>

        {activePersonProfile && (
          <div
            className="card border-0 health-card mb-4"
            style={{ borderRadius: "20px" }}
          >
            <div className="card-body py-3 px-3">
              <div className="d-flex gap-3 align-items-start">
                <img
                  src={resolveProfileImageUrl(activePersonProfile?.Photo)}
                  alt={activePersonLabel}
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
                    marginRight: "12px",
                  }}
                />
                <div className="small" style={{ color: "#1F2933", minWidth: 0 }}>
                  <div className="fw-semibold mb-2" style={{ fontSize: "14px", wordBreak: "break-word" }}>
                    {activePersonLabel}
                  </div>
                  <div className="mb-1"><strong>ABS No:</strong> {activePersonAbsNo}</div>
                  <div className="mb-1"><strong>Blood Group:</strong> {activePersonBloodGroup}</div>
                  <div className="mb-1"><strong>Gender:</strong> {activePersonGender}</div>
                  <div className="mb-1"><strong>Age:</strong> {activePersonAge}</div>
                  <div><strong>Last Visit:</strong> {activePersonLastVisit}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="d-flex gap-3 mb-4 flex-wrap">
          <div
            style={{
              backgroundColor: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(255,255,255,0.88)",
              borderRadius: "18px",
              padding: "14px 20px",
              fontWeight: 600,
              color: "#1F2933",
              boxShadow: "0 18px 30px rgba(191,219,254,0.14)",
            }}
          >
            Total Prescriptions:{" "}
            <span style={{ color: "#4A70A9" }}>
              {prescriptions.length}
            </span>
          </div>

          <div
            style={{
              backgroundColor: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(255,255,255,0.88)",
              borderRadius: "18px",
              padding: "14px 20px",
              fontWeight: 600,
              color: "#1F2933",
              boxShadow: "0 18px 30px rgba(191,219,254,0.14)",
            }}
          >
            Total Medicines:{" "}
            <span style={{ color: "#4A70A9" }}>
              {prescriptions.reduce((acc, prescription) => acc + getPrescriptionMedicines(prescription).length, 0)}
            </span>
          </div>
        </div>

        <div
          className="card border-0 health-card"
          style={{
            borderRadius: "24px",
          }}
        >
          <div className="card-body">
            {loading ? (
              <div className="text-center py-4">
                <div className="spinner-border text-secondary" role="status" />
              </div>
            ) : prescriptions.length === 0 ? (
              <p className="text-center text-muted">
                No records found for selected person.
              </p>
            ) : (
              <div className="table-responsive">
                <table
                  className="table align-middle"
                  style={{
                    border: "1px solid #D6E0F0",
                    borderRadius: "12px",
                    overflow: "hidden",
                  }}
                >
                  <thead
                    style={{
                      backgroundColor: "#F3F7FF",
                      color: "#1F2933",
                      fontWeight: 600,
                    }}
                  >
                    <tr>
                      <th>#</th>
                      <th>Institute</th>
                      <th>Person</th>
                      <th>Medicine</th>
                      <th>Qty</th>
                      <th>Date</th>
                      <th>Report</th>
                    </tr>
                  </thead>

                  <tbody>
                    {prescriptions.map((prescription, idx) => (
                      <tr key={`${prescription._id || prescription.visit_id || "prescription"}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>{prescription.Institute?.Institute_Name || prescription.instituteDisplayName || "—"}</td>
                        <td>
                          <span
                            style={{
                              padding: "4px 12px",
                              borderRadius: "999px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: prescription.IsFamilyMember ? "#FFF4E5" : "#EAF2FF",
                              color: prescription.IsFamilyMember ? "#92400E" : "#1D4ED8",
                            }}
                          >
                            {prescription.IsFamilyMember
                              ? getPrescriptionReportForLabel(prescription)
                              : "Self"}
                          </span>
                        </td>
                        <td>
                          {getPrescriptionMedicines(prescription).map((medicine) => medicine.Medicine_Name).join(", ")}
                        </td>
                        <td>
                          {getPrescriptionMedicines(prescription).reduce((acc, medicine) => acc + Number(medicine.Quantity || 0), 0)}
                        </td>
                        <td>{formatDate(getPrescriptionTimestamp(prescription))}</td>
                        <td>
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                setSelectedPrescription(prescription);
                                setShowModal(true);
                              }}
                            >
                              View
                            </button>

                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => downloadPrescriptionReport(prescription)}
                              disabled={downloadingId === String(prescription?._id || prescription?.visit_id || "download")}
                            >
                              {downloadingId === String(prescription?._id || prescription?.visit_id || "download")
                                ? "Preparing..."
                                : "Download"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && selectedPrescription && (
        <div className="modal fade show d-block" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" style={{ maxWidth: "90%" }}>
            <div className="modal-content border-0">
              <div className="modal-header text-white" style={{ background: "linear-gradient(135deg, #2563EB, #38BDF8)", borderBottom: "none", borderRadius: "24px 24px 0 0" }}>
                <h5 className="modal-title">Prescription Report</h5>
                <button
                  className="btn-close btn-close-white"
                  onClick={() => setShowModal(false)}
                />
              </div>

              <div className="modal-body p-0">
                <ReportHtmlPreview
                  modulePath="prescription-api"
                  report={selectedPrescription}
                  params={{
                    source: selectedPrescription?.Source || "",
                  }}
                  title="Prescription report preview"
                />
              </div>

              <div className="modal-footer">
                <button
                  className="btn"
                  onClick={() => setShowModal(false)}
                  style={{ borderRadius: "14px", padding: "10px 16px", background: "rgba(255,255,255,0.84)", border: "1px solid rgba(191,219,254,0.82)", color: "#2563EB", fontWeight: 600 }}
                >
                  Close
                </button>

                <button
                  className="btn"
                  onClick={() => downloadPrescriptionReport(selectedPrescription)}
                  disabled={downloadingId === String(selectedPrescription?._id || selectedPrescription?.visit_id || "download")}
                  style={{ borderRadius: "14px", padding: "10px 16px", background: "linear-gradient(135deg, #2563EB, #38BDF8)", border: "none", color: "#fff", fontWeight: 600, boxShadow: "0 14px 24px rgba(96,165,250,0.22)" }}
                >
                  {downloadingId === String(selectedPrescription?._id || selectedPrescription?.visit_id || "download")
                    ? "Preparing..."
                    : "Download Report"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default PrescriptionReport;
