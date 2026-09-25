import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import PersonFilterDropdown from "../common/PersonFilterDropdown";
import { usePersonFilter } from "../../context/PersonFilterContext";
import DateRangeFilter from "../common/DateRangeFilter";
import PDFDownloadButton from "../common/PDFDownloadButton";
import { buildReportDownloadUrl, downloadPdfBlob } from "../../utils/pdfDownload";
import ReportHtmlPreview from "../common/ReportHtmlPreview";
import "bootstrap/dist/css/bootstrap.min.css";

const XrayReport = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 5200}`;

  const resolveUrl = (u) => {
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    const base = (BACKEND_URL || '').replace(/\/$/, '');
    return `${base}/${String(u).replace(/^\/+/, '')}`;
  };
  const employeeObjectId = localStorage.getItem("employeeObjectId");
  const employeeId = localStorage.getItem("employeeId") || employeeObjectId;
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const { selectedPersonId, setSelectedPersonId, options, loadingFamily } = usePersonFilter(employeeObjectId || employeeId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filterByPerson = (rows, personId) => {
    const list = Array.isArray(rows) ? rows : [];
    if (personId === "all") return list;
    if (personId === "self") return list.filter((r) => !r.IsFamilyMember);
    return list.filter((r) => r.IsFamilyMember && String(r.FamilyMember?._id || "") === String(personId));
  };

  useEffect(() => {
    if (!employeeObjectId) return;
    setLoading(true);

    axios
      .get(`${BACKEND_URL}/xray-api/records/${employeeObjectId}`, {
        params: {
          employeeId,
          personId: selectedPersonId,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        },
      })
      .then((res) => {
        console.log("X-ray records fetched", res.data);
        setReports(filterByPerson(res.data || [], selectedPersonId));
      })
      .catch((err) => {
        if (err.response?.status === 404) {
          setReports([]);
        } else {
          console.error(err);
        }
      })
      .finally(() => setLoading(false));
  }, [employeeObjectId, employeeId, selectedPersonId, refreshKey, fromDate, toDate]);

  const formatDate = (record) => {
    if (record?.Xrays?.length > 0 && record.Xrays[0].Timestamp) {
      const d = new Date(record.Xrays[0].Timestamp);
      return isNaN(d.getTime()) ? "N/A" : d.toLocaleString("en-IN");
    }
    if (record.Timestamp) {
      const d = new Date(record.Timestamp);
      return isNaN(d.getTime()) ? "N/A" : d.toLocaleString("en-IN");
    }
    if (record.createdAt) {
      const d = new Date(record.createdAt);
      return isNaN(d.getTime()) ? "N/A" : d.toLocaleString("en-IN");
    }
    return "N/A";
  };

  const splitReportsByDate = (records) => {
    const rows = [];

    records.forEach((record) => {
      if (!record.Xrays || record.Xrays.length === 0) return;

      const grouped = {};

      record.Xrays.forEach((x) => {
        if (!x.Timestamp) return;
        const dateKey = new Date(x.Timestamp).toISOString().split("T")[0];
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(x);
      });

      Object.values(grouped).forEach((xraysForDate) => {
        rows.push({
          ...record,
          Xrays: xraysForDate // override only the xrays for that date
        });
      });
    });

    return rows.sort((a, b) => new Date(b.Xrays[0].Timestamp) - new Date(a.Xrays[0].Timestamp));
  };

  const isXrayImageFile = (file = {}) => {
    const mime = String(file?.mimetype || file?.mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const url = String(file?.url || file?.path || "");
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url);
  };

  const getXrayImageUrl = (report = {}) => {
    const xrays = Array.isArray(report?.Xrays) ? report.Xrays : [];
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

  const openXrayImageView = (report) => {
    const url = getXrayImageUrl(report);
    if (!url) {
      alert("No x-ray image available");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const getXrayDownloadId = (report = {}) =>
    String(report?._id || report?.Visit?._id || report?.createdAt || "download");

  const downloadXrayReport = async (report) => {
    const downloadId = getXrayDownloadId(report);

    try {
      setDownloadingId(downloadId);
      const downloadUrl = buildReportDownloadUrl(BACKEND_URL, "xray-api", {
        recordId: report?._id || report?.record?._id || report?.record?.id || "",
        employeeId: employeeId || employeeObjectId,
        personId: selectedPersonId,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });

      await downloadPdfBlob({
        url: downloadUrl,
        filename: `xray-report-${downloadId}.pdf`,
      });
    } catch (error) {
      console.error("X-ray report download failed:", error);
      alert("Unable to download x-ray report");
    } finally {
      setDownloadingId("");
    }
  };

  // derive filtered list
  const filteredReports = reports || [];

  return (
    <div
      className="employee-xray-page"
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
          .employee-xray-page .report-card,
          .employee-xray-page .modal-content {
            background: rgba(255,255,255,0.78);
            border: 1px solid rgba(255,255,255,0.88);
            border-radius: 24px;
            box-shadow: 0 24px 44px rgba(148,184,255,0.18);
            backdrop-filter: blur(18px);
          }

          .employee-xray-page .table {
            --bs-table-bg: transparent;
          }

          .employee-xray-page .table thead th {
            background: #EFF6FF;
            color: #1E3A8A;
            border-color: rgba(191,219,254,0.78);
            white-space: nowrap;
          }

          .employee-xray-page .table tbody tr:hover {
            background: rgba(239,246,255,0.72);
          }
        `}
      </style>
      <div className="container">
        <button
          className="btn mb-3"
          onClick={() => navigate(-1)}
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

        <div
          className="card border-0 report-card"
          style={{
            borderRadius: "24px",
          }}
        >
          <div className="card-body">
            <div
              style={{
                background: "linear-gradient(135deg, rgba(239,246,255,0.95), rgba(255,255,255,0.82))",
                padding: "16px 24px",
                borderBottom: "1px solid rgba(191,219,254,0.5)",
                borderRadius: "24px 24px 0 0",
              }}
              className="d-flex flex-column gap-2"
            >
              <div className="d-flex justify-content-between align-items-end w-100 flex-wrap gap-3">
                <h4 style={{ fontWeight: 600, color: "#1F2933", margin: 0 }}>
                  X‑ray Reports
                </h4>

                <div className="d-flex gap-3 align-items-end flex-wrap">
                  <div>
                    <PersonFilterDropdown
                      options={options}
                      value={selectedPersonId}
                      onChange={(val) => {
                        setSelectedPersonId(val);
                        setSelectedReport(null);
                      }}
                      loading={loadingFamily}
                    />
                  </div>

                  <div>
                    <DateRangeFilter fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} onApply={() => {
                      if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) return alert('From Date cannot be after To Date');
                      setRefreshKey(k => k + 1);
                    }} />
                  </div>

                  <div>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: "linear-gradient(135deg, #2563EB, #38BDF8)",
                        color: "#FFFFFF",
                        borderRadius: "14px",
                        padding: "6px 16px",
                        fontWeight: 600,
                        border: "none",
                        height: "44px",
                        boxShadow: "0 14px 24px rgba(96,165,250,0.22)"
                      }}
                      onClick={() => setRefreshKey((p) => p + 1)}
                    >
                      Refresh
                    </button>
                  </div>

                  <div>
                    <PDFDownloadButton modulePath="xray-api" params={{ employeeId: employeeObjectId, personId: selectedPersonId, fromDate, toDate }} filenamePrefix={`Xray_${employeeId}`} />
                  </div>
                </div>
              </div>
            </div>

            {/* summary count */}
            <div className="mt-2 mb-3 text-muted small">
              Showing {filteredReports.length} of {reports.length} report{reports.length === 1 ? "" : "s"}
            </div>

            {loading ? (
              <div className="text-center py-4">
                <div className="spinner-border text-secondary" role="status" />
              </div>
            ) : filteredReports.length === 0 ? (
              <p className="text-center text-muted">No records found for selected person.</p>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle" style={{ border: "1px solid #D6E0F0", borderRadius: "12px", overflow: "hidden" }}>
                  <thead style={{ backgroundColor: "#F3F7FF", color: "#1F2933", fontWeight: 600 }}>
                    <tr>
                      <th>#</th>
                      <th>Patient</th>
                      <th>Report For</th>
                      <th>Institute</th>
                      <th>No. of X‑rays</th>
                      <th>Test Date</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splitReportsByDate(filteredReports).map((report, index) => (
                      <tr key={report._id + report.Xrays[0]?.Timestamp}>
                        <td>{index + 1}</td>
                        <td>
                          {report.Employee?.Name}
                          {report.Employee?.ABS_NO && ` (${report.Employee.ABS_NO})`}
                        </td>
                        <td>{report.IsFamilyMember ? `${report.FamilyMember?.Name} (${report.FamilyMember?.Relationship})` : "Self"}</td>
                        <td>{report.Institute?.Institute_Name || "Medical Institute"}</td>
                        <td>{report.Xrays.length}</td>
                        <td>{formatDate(report)}</td>
                        <td>
                          <div className="d-flex gap-2">
                            <button className="btn btn-sm" style={{ borderRadius: "999px", border: "1px solid #4A70A9", backgroundColor: "#4A70A9", color: "#FFFFFF", fontWeight: 500 }} onClick={() => { setSelectedReport(report); setShowModal(true); }}>View</button>
                            <button
                              className="btn btn-sm"
                              style={{ borderRadius: "999px", border: "1px solid #4A70A9", backgroundColor: "#FFFFFF", color: "#4A70A9", fontWeight: 500 }}
                              onClick={() => downloadXrayReport(report)}
                              disabled={downloadingId === getXrayDownloadId(report)}
                            >
                              {downloadingId === getXrayDownloadId(report) ? "Preparing..." : "Download"}
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

      {showModal && selectedReport && (
        <div className="modal fade show d-block" style={{ background: "rgba(15,23,42,0.28)" }}>
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div
                className="modal-header text-white"
                style={{ background: "linear-gradient(135deg, #2563EB, #38BDF8)", borderBottom: "none", borderRadius: "24px 24px 0 0" }}
              >
                <h5 className="modal-title">X‑ray Details</h5>
                <button className="btn-close btn-close-white" onClick={() => setShowModal(false)} />
              </div>

              <div className="modal-body p-0">
                <ReportHtmlPreview
                  modulePath="xray-api"
                  report={selectedReport}
                  title="X-ray report preview"
                />
              </div>

              <div className="modal-footer">
                <button
                  className="btn btn-outline-primary"
                  onClick={() => openXrayImageView(selectedReport)}
                  disabled={!getXrayImageUrl(selectedReport)}
                >
                  View Image
                </button>
                <button
                  className="btn"
                  onClick={() => downloadXrayReport(selectedReport)}
                  disabled={downloadingId === getXrayDownloadId(selectedReport)}
                  style={{ borderRadius: "14px", padding: "10px 16px", background: "linear-gradient(135deg, #2563EB, #38BDF8)", border: "none", color: "#fff", fontWeight: 600, boxShadow: "0 14px 24px rgba(96,165,250,0.22)" }}
                >
                  {downloadingId === getXrayDownloadId(selectedReport) ? "Preparing..." : "Download PDF"}
                </button>
                <button className="btn" onClick={() => setShowModal(false)} style={{ borderRadius: "14px", padding: "10px 16px", background: "rgba(255,255,255,0.84)", border: "1px solid rgba(191,219,254,0.82)", color: "#2563EB", fontWeight: 600 }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default XrayReport;
