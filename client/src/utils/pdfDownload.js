export const downloadPdfBlob = async ({ url, filename }) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "report.pdf";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const buildReportDownloadUrl = (backendUrl, modulePath, params = {}) => {
  const url = new URL(`${backendUrl}/${modulePath}/download-pdf`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.append(key, value);
    }
  });
  return url.toString();
};

export const buildReportPreviewPdfUrl = (backendUrl, modulePath, params = {}) =>
  buildReportDownloadUrl(backendUrl, modulePath, params).replace("/download-pdf", "/preview-pdf");
