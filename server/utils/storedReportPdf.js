const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");

const { generateSingleReportPdf } = require("./reportLayout");

const REPORT_ROOT = path.join(__dirname, "..", "generated-reports");
const REPORT_LAYOUT_VERSION = "times-v9-xray-upload-append";
const generationLocks = new Map();

const getReportPdfPath = (reportType, recordId) =>
  path.join(REPORT_ROOT, reportType, `${String(recordId)}.pdf`);

const getReportMetaPath = (reportType, recordId) =>
  path.join(REPORT_ROOT, reportType, `${String(recordId)}.json`);

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const getReportDataHash = (record) => crypto
  .createHash("sha256")
  .update(JSON.stringify(record || {}))
  .digest("hex");

const getUploadedXrayReports = (record = {}) => (Array.isArray(record?.Xrays) ? record.Xrays : [])
  .flatMap((xray) => Array.isArray(xray?.Reports) ? xray.Reports : [])
  .filter((report) => report?.url);

const appendUploadedXrayReports = async (pdfBuffer, record) => {
  const reports = getUploadedXrayReports(record);
  if (!reports.length) return pdfBuffer;

  const merged = await PDFDocument.load(pdfBuffer);
  for (const report of reports) {
    try {
      const response = await fetch(report.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const bytes = Buffer.from(await response.arrayBuffer());
      const filename = String(report.originalname || report.filename || "").toLowerCase();

      if (contentType.includes("pdf") || filename.endsWith(".pdf")) {
        const uploadedPdf = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(uploadedPdf, uploadedPdf.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
        continue;
      }

      if (contentType.includes("png") || filename.endsWith(".png")) {
        const image = await merged.embedPng(bytes);
        appendImagePage(merged, image);
        continue;
      }

      if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.(jpe?g)$/.test(filename)) {
        const image = await merged.embedJpg(bytes);
        appendImagePage(merged, image);
        continue;
      }

      console.warn(`[storedReportPdf] Skipping unsupported x-ray upload: ${report.originalname || report.filename || report.url}`);
    } catch (error) {
      console.warn(`[storedReportPdf] Could not append x-ray upload ${report.originalname || report.filename || report.url}: ${error.message}`);
    }
  }

  return Buffer.from(await merged.save());
};

const appendImagePage = (document, image) => {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const scale = Math.min(
    (pageWidth - margin * 2) / image.width,
    (pageHeight - margin * 2) / image.height
  );
  const width = image.width * scale;
  const height = image.height * scale;
  const page = document.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
};

const storeReportPdf = async (reportType, recordId, record) => {
  if (!recordId) {
    throw new Error("recordId is required to store a report PDF");
  }

  const filePath = getReportPdfPath(reportType, recordId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let pdfBuffer = await generateSingleReportPdf(reportType, record);
  if (reportType === "xray") {
    pdfBuffer = await appendUploadedXrayReports(pdfBuffer, record);
  }
  await fs.writeFile(filePath, pdfBuffer);
  await fs.writeFile(
    getReportMetaPath(reportType, recordId),
    JSON.stringify({
      layoutVersion: REPORT_LAYOUT_VERSION,
      stale: false,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: record?.updatedAt || record?.createdAt || record?.Timestamp || null,
      sourceDataHash: getReportDataHash(record),
    }, null, 2)
  );
  return filePath;
};

const invalidateStoredReportPdf = async (reportType, recordId) => {
  if (!recordId) return false;
  const metaPath = getReportMetaPath(reportType, recordId);
  if (!(await fileExists(metaPath))) return false;

  let meta = {};
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch {
    meta = {};
  }

  await fs.writeFile(metaPath, JSON.stringify({
    ...meta,
    stale: true,
    invalidatedAt: new Date().toISOString(),
  }, null, 2));
  return true;
};

const ensureStoredReportPdf = async (reportType, recordId, record) => {
  const filePath = getReportPdfPath(reportType, recordId);
  const metaPath = getReportMetaPath(reportType, recordId);

  const lockKey = `${reportType}:${String(recordId)}`;
  const pendingGeneration = generationLocks.get(lockKey);
  if (pendingGeneration) {
    await pendingGeneration;
    return ensureStoredReportPdf(reportType, recordId, record);
  }

  if (await fileExists(filePath) && await fileExists(metaPath)) {
    try {
      const [stat, metaText] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(metaPath, "utf8"),
      ]);
      const meta = JSON.parse(metaText);
      const sourceUpdatedAt = record?.updatedAt || record?.createdAt || record?.Timestamp || null;
      const sourceTime = sourceUpdatedAt ? new Date(sourceUpdatedAt).getTime() : 0;
      const fileTime = stat.mtime.getTime();
      if (
        !meta.stale &&
        meta.layoutVersion === REPORT_LAYOUT_VERSION &&
        meta.sourceDataHash === getReportDataHash(record) &&
        (!sourceTime || sourceTime <= fileTime)
      ) {
        return filePath;
      }
    } catch {
      // Fall through and regenerate corrupt/stale cached artifacts.
    }
  }

  const generation = storeReportPdf(reportType, recordId, record);
  generationLocks.set(lockKey, generation);
  try {
    return await generation;
  } finally {
    if (generationLocks.get(lockKey) === generation) generationLocks.delete(lockKey);
  }
};

const sendStoredReportPdf = async (res, filePath, filename, disposition = "inline") => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  return res.sendFile(filePath);
};

module.exports = {
  ensureStoredReportPdf,
  invalidateStoredReportPdf,
  getReportPdfPath,
  sendStoredReportPdf,
  storeReportPdf,
};
