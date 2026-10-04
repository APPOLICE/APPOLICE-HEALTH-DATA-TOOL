import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import PatientSelector from "../institutes/PatientSelector";
import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";
import "./InstitutesTheme.css";
import { mergeXrayTypes } from "../../data/xrayTypes";
import ReportHtmlPreview from "../common/ReportHtmlPreview";

const normalizeFilmSize = (value) => {
  const cleaned = String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9X]/g, "")
    .replace(/X+/g, "X");

  const parts = cleaned.split("X").filter(Boolean);
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}X${parts.slice(1).join("")}`;
};

const isValidFilmSize = (value) => /^\d+X\d+$/.test(String(value || "").trim());

const XrayEntryForm = () => {
  const FALLBACK_PROFILE_IMAGE = "/profile-fallback.png";
  const [instituteName, setInstituteName] = useState("");
  const [visitId, setVisitId] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedFamilyMember, setSelectedFamilyMember] = useState(null);
  const [pastRecords, setPastRecords] = useState([]);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tokenNumber, setTokenNumber] = useState(null);
  const [xrayTypes, setXrayTypes] = useState([]);
  const [xrayMaster, setXrayMaster] = useState([]);
  const [xrayBodyParts, setXrayBodyParts] = useState([]);
  const [doctorXrays, setDoctorXrays] = useState([]);
  const [doctorXrayOrders, setDoctorXrayOrders] = useState([]);
  const [showDoctorNotes, setShowDoctorNotes] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [invalidXrayIndexes, setInvalidXrayIndexes] = useState([]);
  const navigate = useNavigate();

  const xraySource = useMemo(() => mergeXrayTypes(xrayMaster), [xrayMaster]);

  const bodyPartOptions = useMemo(() => {
    const parts = new Set();
    [...xraySource, ...xrayBodyParts].forEach((item) => {
      const part = String(item?.Body_Part || "").trim();
      if (part) parts.add(part);
    });
    return Array.from(parts).sort((a, b) => a.localeCompare(b));
  }, [xraySource, xrayBodyParts]);



  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const resolveReportUrl = (url) => {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    const base = String(BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(url).replace(/^\/+/, "")}`;
  };
  const resolveProfileImageUrl = (photoPath) => {
    if (!photoPath) return FALLBACK_PROFILE_IMAGE;
    if (/^https?:\/\//i.test(photoPath)) return photoPath;
    const base = String(BACKEND_URL || "").replace(/\/$/, "");
    return `${base}/${String(photoPath).replace(/^\/+/, "")}`;
  };

  const [formData, setFormData] = useState({
    Institute_ID: "",
    Employee_ID: "",
    IsFamilyMember: false,
    FamilyMember_ID: "",
    Xrays: [
      {
        Xray_Type: "",
        Body_Part: "",
        Side: "NA",
        View: "",
        Film_Size: "",
        Findings: "",
        Impression: "",
        Remarks: "",
      },
    ],
    Xray_Notes: "",
  });

  useEffect(() => {
    const localInstituteId =
      localStorage.getItem("instituteId");
    if (localInstituteId) {
      setFormData((s) => ({
        ...s,
        Institute_ID: localInstituteId,
      }));
      fetchInstituteName(localInstituteId);
        // ADD THIS
  fetchXrayTypes();
    }
  }, []);

  useEffect(() => {
    const refreshXrayMasters = () => {
      fetchXrayTypes();
    };

    const onStorageUpdated = (event) => {
      if (event.key === "master-data-updated-at") {
        fetchXrayTypes();
      }
    };

    window.addEventListener("master-data-updated", refreshXrayMasters);
    window.addEventListener("storage", onStorageUpdated);

    return () => {
      window.removeEventListener("master-data-updated", refreshXrayMasters);
      window.removeEventListener("storage", onStorageUpdated);
    };
  }, []);

  const fetchDoctorXrays = async (visitId) => {
  try {
    // Fetch from medical-actions API like pharmacy and diagnosis
    const res = await axios.get(
      `${BACKEND_URL}/api/medical-actions/visit/${visitId}`
    );

    console.log("Medical actions API Response:", res.data);
    
    const actions = res.data || [];
    
    // Filter for DOCTOR_XRAY actions
    const doctorXrayActions = actions.filter(a => a.action_type === "DOCTOR_XRAY");
    
    console.log("Doctor X-ray actions:", doctorXrayActions);
    
    // Set the orders (each action is an order with data containing xrays and notes)
    setDoctorXrayOrders(doctorXrayActions);
    
    // Extract xrays from all actions for the form
    const allXrays = doctorXrayActions.flatMap(action => action.data?.xrays || []);
    setDoctorXrays(allXrays);

  } catch (err) {
    console.error("Failed to fetch doctor xrays", err);
    setDoctorXrays([]);
    setDoctorXrayOrders([]);
  }
};

  const fetchInstituteName = async (id) => {
    try {
      const res = await axios.get(
        `${BACKEND_URL}/institute-api/institution/${id}`
      );
      setInstituteName(res.data?.Institute_Name || "");
    } catch (err) {
      console.error("Error fetching institute name:", err);
    }
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


 const handleXrayChange = (index, field, value) => {
  setSubmitError("");
  setInvalidXrayIndexes((previous) => previous.filter((item) => item !== index));
  setFormData(prev => {
    const updated = [...prev.Xrays];

    if (field === "Body_Part") {
      updated[index] = {
        ...updated[index],
        Body_Part: value,
        Xray_ID: "",
        Xray_Type: "",
        Side: "NA",
        View: "",
        Film_Size: ""
      };
    } else if (field === "Xray_ID") {
      const sel = xrayMaster.find(x => x._id === value);

      if (sel) {
        updated[index] = {
          ...updated[index],
          Xray_ID: sel._id,
          Xray_Type: sel.Xray_Type,
          Body_Part: sel.Body_Part,
          Side: sel.Side || "NA",
          View: sel.View || "",
          Film_Size: sel.Film_Size || ""
        };
      } else {
        updated[index] = {
          ...updated[index],
          Xray_ID: value || "",
          Xray_Type: value
            ? updated[index].Xray_Type
            : ""
        };
      }
    } else if (field === "Film_Size") {
      updated[index] = {
        ...updated[index],
        Film_Size: normalizeFilmSize(value)
      };
    } else {
      updated[index] = {
        ...updated[index],
        [field]: value
      };
    }

    return { ...prev, Xrays: updated };
  });
};


  const addXray = () => {
    setFormData((prev) => ({
      ...prev,
      Xrays: [
        ...prev.Xrays,
        {
          Xray_Type: "",
          Body_Part: "",
          Side: "NA",
          View: "",
          Film_Size: "",
          Findings: "",
          Impression: "",
          Remarks: "",
        },
      ],
    }));
  };

  const removeXray = (i) => {
    setFormData((prev) => ({
      ...prev,
      Xrays: prev.Xrays.filter(
        (_, idx) => idx !== i
      ),
    }));
  };

  const fetchPastRecords = async () => {
    if (!formData.Employee_ID) return;

    try {
      const res = await axios.get(
        `${BACKEND_URL}/xray-api/records/${formData.Employee_ID}?isFamily=${formData.IsFamilyMember}&familyId=${formData.FamilyMember_ID}`
      );
      setPastRecords(res.data || []);
      setShowHistory(true);
    } catch (err) {
      console.error(
        "Error fetching past records:",
        err
      );
    }
  };


  const handleSubmit = async (e) => {

e.preventDefault();
setSubmitError("");
setInvalidXrayIndexes([]);

if (!formData.Employee_ID) {
  setSubmitError("Please select a patient before saving the X-ray record.");
  return;
}

if (formData.IsFamilyMember && !formData.FamilyMember_ID) {
  setSubmitError("Please select a family member before saving the X-ray record.");
  return;
}

const incompleteXrays = formData.Xrays
  .map((xray, index) => ({ xray, index }))
  .filter(({ xray }) =>
    !String(xray?.Body_Part || "").trim() ||
    !String(xray?.Xray_Type || "").trim() ||
    !isValidFilmSize(xray?.Film_Size)
  );

if (incompleteXrays.length) {
  setInvalidXrayIndexes(incompleteXrays.map(({ index }) => index));
  const details = incompleteXrays.map(({ xray, index }) => {
    const missing = [];
    if (!String(xray?.Body_Part || "").trim()) missing.push("body part");
    if (!String(xray?.Xray_Type || "").trim()) missing.push("X-ray test");
    if (!isValidFilmSize(xray?.Film_Size)) missing.push("film size (for example 10X8)");
    return `#${index + 1}: ${missing.join(", ")}`;
  });
  setSubmitError(`Complete the required X-ray fields before saving: ${details.join("; ")}.`);
  return;
}

const invalidFilmSizeIndex = formData.Xrays.findIndex(
  (xray) => !isValidFilmSize(xray.Film_Size)
);

if (invalidFilmSizeIndex !== -1) return;

const fd = new FormData();

fd.append("Institute_ID",formData.Institute_ID);
fd.append("Employee_ID",formData.Employee_ID);
fd.append("IsFamilyMember",formData.IsFamilyMember);
fd.append("FamilyMember_ID",formData.FamilyMember_ID);
fd.append("Xray_Notes",formData.Xray_Notes);
fd.append("visit_id", visitId || "");

// send xray data
fd.append("Xrays",JSON.stringify(formData.Xrays));

// send files and preserve which x-ray each upload belongs to
const reportFileIndexes = [];
formData.Xrays.forEach((x,i)=>{

if(x.ReportFile){
fd.append("reports",x.ReportFile);
reportFileIndexes.push(i);
}

});
fd.append("reportFileIndexes", JSON.stringify(reportFileIndexes));

try {
await axios.post(
`${BACKEND_URL}/xray-api/add`,
fd,
{
headers:{
"Content-Type":"multipart/form-data"
}
}
);

await fetchPastRecords();
alert("✅ Xray saved");
} catch (err) {
  console.error(err);
  setSubmitError(err?.response?.data?.error || err?.response?.data?.message || "Failed to save X-ray record.");
}

};

  const handlePrint = () => {
    const section = document.getElementById("xray-print-section");
    if (!section) return;

    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>X-ray Entry</title>
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

  const formatDateDMY = (dateValue) => {
    if (!dateValue) return "—";
    const date = new Date(dateValue);
    if (isNaN(date)) return "—";

    const day = String(date.getDate()).padStart(
      2,
      "0"
    );
    const month = String(
      date.getMonth() + 1
    ).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
  };

  useEffect(() => {

  if (!doctorXrays || doctorXrays.length === 0) return;

  const populated = doctorXrays.map(x => {

    const master = xrayMaster.find(m => m._id === x.Xray_ID);

    return {
      Xray_ID: x.Xray_ID || "",
      Xray_Type: x.Xray_Type || "",
      Body_Part: master?.Body_Part || "",
      Side: master?.Side || "NA",
      View: master?.View || "",
      Film_Size: master?.Film_Size || "",
      Findings: "",
      Impression: "",
      Remarks: ""
    };

  });

  setFormData(prev => ({
    ...prev,
    Xrays: populated
  }));

}, [doctorXrays, xrayMaster]);

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
                <strong>🩻 X-ray History</strong>
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
                  pastRecords.map((record, index) => (
                    <div
                      key={record._id || index}
                      className="d-flex justify-content-between align-items-center border-bottom pb-3 mb-3 gap-2"
                    >
                      <div>
                        <div className="text-muted small">
                          📅 Date: {record?.createdAt ? formatDateDMY(record.createdAt) : "—"}
                        </div>
                        <div className="small text-dark mt-1">
                          {record?.Xrays?.length || 0} X-ray report{record?.Xrays?.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary flex-shrink-0"
                        onClick={() => setSelectedHistoryRecord(record)}
                      >
                        View Report
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {selectedHistoryRecord && (
          <div className="modal fade show d-block" style={{ background: "rgba(15,23,42,0.28)" }}>
            <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header bg-primary text-white">
                  <h5 className="modal-title">X-ray Report</h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => setSelectedHistoryRecord(null)}
                  />
                </div>
                <div className="modal-body p-0">
                  <ReportHtmlPreview
                    modulePath="xray-api"
                    report={selectedHistoryRecord}
                    title="X-ray report preview"
                  />
                </div>
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
              <h5 className="mb-0">🩻 X-ray Entry Form</h5>
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
                    <strong>Cannot save X-ray record.</strong> {submitError}
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
                    onlyXrayQueue={true}
                    onSelect={({ employee, visit }) => {
                      const vId = visit?._id || null;
                      const token =
                        visit?.token_no ||
                        visit?.Token_Number ||
                        null;

                      setVisitId(vId);
                      setTokenNumber(token);
                      setSelectedEmployee(employee);
                      setSelectedFamilyMember(
                        visit?.IsFamilyMember
                          ? visit.FamilyMember
                          : null
                      );
                      if (vId) {
                        fetchDoctorXrays(vId);
                      }
                      setFormData((prev) => ({
                        ...prev,
                        Employee_ID: employee._id,
                        IsFamilyMember: Boolean(
                          visit?.IsFamilyMember
                        ),
                        FamilyMember_ID:
                          visit?.IsFamilyMember
                            ? visit.FamilyMember?._id
                            : "",
                      }));
                    }}
                  />
                </div>

                {/* Selected Patient Info */}
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

                      <div className="flex-grow-1">
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

                        <div className="text-muted small mb-2">
                          <span className="me-3">
                            <strong>ID:</strong> {selectedEmployee.ABS_NO}
                          </span>
                        </div>

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

                {/* Doctor X-ray Orders with Notes */}
                {doctorXrayOrders.length > 0 && (
                  <div className="alert alert-warning mb-4">
                    <h6 className="alert-heading">👨‍⚕️ Doctor X-ray Orders (Reference)</h6>
                    
                    {doctorXrayOrders.map((action, i) => (
                      <div key={i} className="mt-2">
                        <ul className="mb-2">
                          {(action.data?.xrays || []).map((xray, idx) => (
                            <li key={idx}>
                              {xray.Xray_Type} {xray.Body_Part ? `(${xray.Body_Part})` : ''}
                            </li>
                          ))}
                        </ul>

                        {action.data?.notes && (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-info"
                              onClick={() => setShowDoctorNotes(prev => ({ ...prev, [i]: !prev[i] }))}
                            >
                              {showDoctorNotes[i] ? "Hide Doctor Notes" : "Show Doctor Notes"}
                            </button>
                            {showDoctorNotes[i] && (
                              <div className="alert alert-info mt-2 mb-0 p-2">
                                <small><strong>Doctor Notes:</strong> {action.data.notes}</small>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* X-ray Details */}
                <div className="mb-4">
                  <h6 className="fw-bold text-dark mb-3 border-bottom pb-2">
                    🩻 X-ray Details
                  </h6>

                  {formData.Xrays.map((x, i) => (
                    <div
                      key={i}
                      className="border rounded p-3 mb-3 bg-light"
                    >
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <h6 className="mb-0">X-ray #{i + 1}</h6>
                        {formData.Xrays.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => removeXray(i)}
                          >
                            🗑️ Remove
                          </button>
                        )}
                      </div>

                      <div className="row g-3">
                        <div className="col-md-4">
                          <label className="form-label fw-semibold">Body Part</label>
                          <select
                            className={`form-select${invalidXrayIndexes.includes(i) && !String(x.Body_Part || "").trim() ? " is-invalid" : ""}`}
                            value={x.Body_Part || ""}
                            onChange={(e) => handleXrayChange(i, "Body_Part", e.target.value)}
                          >
                            <option value="">Select body part</option>
                            {bodyPartOptions.map((part) => (
                              <option key={part} value={part}>
                                {part}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-md-8">
                          <label className="form-label fw-semibold">X-ray Selection</label>
                          <select
                            className={`form-select${invalidXrayIndexes.includes(i) && !String(x.Xray_Type || "").trim() ? " is-invalid" : ""}`}
                            value={x.Xray_ID || ""}
                            onChange={(e) => handleXrayChange(i, "Xray_ID", e.target.value)}
                            disabled={!x.Body_Part}
                          >
                            <option value="">{x.Body_Part ? "Select X-ray test" : "Select body part first"}</option>
                            {xraySource
                              .filter(
                                (xm) =>
                                  String(xm?.Body_Part || "").trim().toLowerCase() ===
                                  String(x.Body_Part || "").trim().toLowerCase()
                              )
                              .sort((a, b) => String(a?.Xray_Type || "").localeCompare(String(b?.Xray_Type || "")))
                              .map((xm) => (
                                <option key={xm._id} value={xm._id}>
                                  {xm.Xray_Type}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="col-md-4">
                          <label className="form-label fw-semibold">Film Size</label>
                          <input
                            type="text"
                            className={`form-control${invalidXrayIndexes.includes(i) && !isValidFilmSize(x.Film_Size) ? " is-invalid" : ""}`}
                            placeholder="10X8"
                            value={x.Film_Size}
                            onChange={(e) => handleXrayChange(i, "Film_Size", e.target.value)}
                            inputMode="text"
                            autoComplete="off"
                            onBlur={(e) => handleXrayChange(i, "Film_Size", e.target.value)}
                          />
                        </div>

                        <div className="col-md-6">
                          <label className="form-label fw-semibold">Findings</label>
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder="Enter findings..."
                            value={x.Findings}
                            onChange={(e) => handleXrayChange(i, "Findings", e.target.value)}
                          />
                        </div>

                        <div className="col-md-6">
                          <label className="form-label fw-semibold">Impression</label>
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder="Enter impression..."
                            value={x.Impression}
                            onChange={(e) => handleXrayChange(i, "Impression", e.target.value)}
                          />
                        </div>

                        <div className="col-12">
                          <label className="form-label fw-semibold">Remarks</label>
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder="Enter remarks..."
                            value={x.Remarks}
                            onChange={(e) => handleXrayChange(i, "Remarks", e.target.value)}
                          /><br/>
                          <div className="col-12">
                            <label className="form-label fw-semibold">
                            Upload X-ray Report
                            </label>

                            <input
                            type="file"
                            className="form-control"
                            onChange={(e)=>
                            handleXrayChange(
                            i,
                            "ReportFile",
                            e.target.files[0]
                            )
                            }
                            />

                            </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-outline-success me-2"
                    onClick={addXray}
                  >
                    ➕ Add Another X-ray
                  </button>
                </div>

                {/* Notes */}
                <div className="mb-4">
                  <label className="form-label fw-semibold">📝 X-ray Notes</label>
                  <textarea
                    className="form-control"
                    rows={4}
                    placeholder="Enter X-ray notes..."
                    value={formData.Xray_Notes}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        Xray_Notes: e.target.value,
                      }))
                    }
                  />
                </div>

                {/* Submit Button */}
                <div className="text-center">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg px-5"
                  >
                    💾 Save X-ray Record
                  </button>
                </div>
              </form>

              {/* Hidden Print Section */}
              <div id="xray-print-section" style={{ display: "none" }}>
                <h2 style={{ textAlign: "center", marginBottom: "20px" }}>
                  🩻 X-ray Entry Report
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

                {formData.Xrays.length > 0 && (
                  <div style={{ marginBottom: "20px", borderBottom: "1px solid #ddd", paddingBottom: "15px" }}>
                    <h4>X-ray Details</h4>
                    {formData.Xrays.map((x, i) => (
                      <div key={i} style={{ marginBottom: "15px", padding: "10px", backgroundColor: "#f9f9f9", borderRadius: "4px" }}>
                        <h6 style={{ marginBottom: "10px" }}>X-ray #{i + 1}</h6>
                        <table style={{ width: "100%", fontSize: "13px", marginBottom: "10px" }}>
                          <tbody>
                            <tr>
                              <td style={{ width: "30%", fontWeight: "bold", paddingBottom: "5px" }}>Type:</td>
                              <td style={{ paddingBottom: "5px" }}>{x.Xray_Type || "N/A"}</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: "bold", paddingBottom: "5px" }}>Body Part:</td>
                              <td style={{ paddingBottom: "5px" }}>{x.Body_Part || "N/A"}</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: "bold", paddingBottom: "5px" }}>View:</td>
                              <td style={{ paddingBottom: "5px" }}>{x.View || "N/A"}</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: "bold", paddingBottom: "5px" }}>Film Size:</td>
                              <td style={{ paddingBottom: "5px" }}>{x.Film_Size || "N/A"}</td>
                            </tr>
                            {x.Findings && (
                              <tr>
                                <td style={{ fontWeight: "bold", paddingBottom: "5px", verticalAlign: "top" }}>Findings:</td>
                                <td style={{ paddingBottom: "5px", whiteSpace: "pre-wrap" }}>{x.Findings}</td>
                              </tr>
                            )}
                            {x.Impression && (
                              <tr>
                                <td style={{ fontWeight: "bold", paddingBottom: "5px", verticalAlign: "top" }}>Impression:</td>
                                <td style={{ paddingBottom: "5px", whiteSpace: "pre-wrap" }}>{x.Impression}</td>
                              </tr>
                            )}
                            {x.Remarks && (
                              <tr>
                                <td style={{ fontWeight: "bold", paddingBottom: "5px", verticalAlign: "top" }}>Remarks:</td>
                                <td style={{ paddingBottom: "5px", whiteSpace: "pre-wrap" }}>{x.Remarks}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}

                {formData.Xray_Notes && (
                  <div style={{ marginBottom: "20px" }}>
                    <h4>X-ray Notes</h4>
                    <p style={{ whiteSpace: "pre-wrap" }}>{formData.Xray_Notes}</p>
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
export default XrayEntryForm;
