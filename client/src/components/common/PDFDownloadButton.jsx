import React, { useState } from 'react';

const PDFDownloadButton = ({ modulePath, params = {}, filenamePrefix = 'report', label = 'Download PDF' }) => {
  const [loading, setLoading] = useState(false);
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://localhost:${import.meta.env.VITE_BACKEND_PORT || 5200}`;

  const handleDownload = async () => {
    try {
      setLoading(true);
      const url = new URL(`${BACKEND_URL}/${modulePath}/download-pdf`);
      Object.keys(params || {}).forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') url.searchParams.append(k, params[k]);
      });
      const a = document.createElement('a');
      a.href = url.toString();
      a.download = `${filenamePrefix}.pdf`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('PDF download error:', err);
      alert('Failed to download PDF');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className="btn btn-sm"
      onClick={handleDownload}
      disabled={loading}
      style={{
        height: 44,
        whiteSpace: 'nowrap',
        borderRadius: 14,
        padding: "0 18px",
        background: loading
          ? "rgba(255,255,255,0.78)"
          : "rgba(255,255,255,0.86)",
        border: "1px solid rgba(191,219,254,0.8)",
        color: "#2563EB",
        fontWeight: 600,
        boxShadow: "0 12px 22px rgba(191,219,254,0.16)",
      }}
    >
      {label}
    </button>
  );
};

export default PDFDownloadButton;
