import React, { useMemo } from "react";
import { buildReportPreviewPdfUrl } from "../../utils/pdfDownload";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 5200}`;

const getRecordId = (report) =>
  report?.record?._id ||
  report?.record?.id ||
  report?.recordId ||
  report?.Record_ID ||
  report?.DiagnosisRecord_ID ||
  report?.XrayRecord_ID ||
  report?.diagnosis_record_id ||
  report?.xray_record_id ||
  report?.test?.recordId ||
  report?.test?.Record_ID ||
  report?.test?.diagnosis_record_id ||
  report?.xray?.recordId ||
  report?.xray?.Record_ID ||
  report?._id ||
  report?.id ||
  "";

const ReportHtmlPreview = ({ modulePath, report, params = {}, title = "Report preview" }) => {
  const previewUrl = useMemo(() => {
    const recordId = params.recordId || getRecordId(report);
    if (!recordId) return "";

    return buildReportPreviewPdfUrl(BACKEND_URL, modulePath, {
      ...params,
      recordId,
    });
  }, [modulePath, params, report]);

  if (!previewUrl) {
    return <div className="alert alert-danger m-3">No record selected for preview.</div>;
  }

  return (
    <iframe
      title={title}
      src={previewUrl}
      style={{
        width: "100%",
        height: "78vh",
        border: 0,
        background: "#fff",
      }}
    />
  );
};

export default ReportHtmlPreview;
