const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require("path");
require('dotenv').config({ path: path.join(__dirname, '.env') });
const dns = require("dns");


const app = express();

// Configure CORS to allow Vercel frontend
const corsOptions = {
  origin: [
    'https://ap-police66.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  "/uploads/family-pics",
  express.static(path.join(__dirname, "uploads", "family-pics"))
);
// import your router here (adjust the path as needed)
const instituteApp = require('./apis/institute_api');
const medicineApp = require("./apis/medicines_api");
const employeeApp=require('./apis/employee_api')
const FamilyApp=require('./apis/family_member_api')
const prescriptionApp = require("./apis/prescription-api");
const diagnosisApp=require("./apis/diagnosis_api")
const diseaseApp=require("./apis/institute_enter_disease");
const ledgerApp = require("./apis/instituteLedgerApi");
const indentApp = require("./apis/institute_indent_api");
const dailyVisitRoutes = require("./apis/daily_visit_api");
const medicalActionRoutes = require("./apis/medical_action_api");
const doctorPrescriptionApi = require("./apis/doctor_prescription_api");
const mainStoreApp = require("./apis/mainstore_api");
const adminApp = require("./apis/admin_api");
const aiQueryApp = require('./apis/ai_query_api');
const aiQuerySuggestionsApp = require('./apis/ai_query_suggestions_api');
const xrayApp = require("./apis/xray_api");
const healthSummaryRoutes = require("./apis/healthSummary");
const instituteAuth = require("./apis/instituteAuth");
const passwordResetApp = require("./apis/passwordReset");
const analyticsRoutes = require("./apis/analyticsRoutes");
const diseaseMasterRoutes = require("./apis/disease-fetch");
const predictRoute = require("./apis/predict");
const forecastRoutes = require("./apis/forecast");
const masterDataRoutes = require("./apis/master_data_api");
app.use("/institute-auth", instituteAuth.router);
app.use("/auth", passwordResetApp);
app.use("/institute-api", healthSummaryRoutes);
app.use("/ai-api", aiQueryApp);
app.use("/api/ai-queries", aiQuerySuggestionsApp);
app.use("/doctor-prescription-api", doctorPrescriptionApi);
app.use("/api/visits", dailyVisitRoutes);
app.use("/api/medical-actions", medicalActionRoutes);
app.use("/medicine-api", medicineApp);
app.use("/institute-api", instituteApp);
app.use("/employee-api",employeeApp);
app.use("/family-api",FamilyApp);
app.use("/prescription-api", prescriptionApp);
app.use("/diagnosis-api",diagnosisApp);
app.use("/disease-api", require("./apis/disease-api"));
app.use("/disease-api",diseaseApp)
app.use("/ledger-api", ledgerApp);
app.use("/indent-api", indentApp);
app.use("/medicine-limit-api", require("./apis/medicine_limit_api"));
app.use("/mainstore", mainStoreApp);
app.use("/admin-api", adminApp);
app.use("/xray-api", xrayApp);
app.use("/api/analytics", analyticsRoutes);
app.use("/disease-master-api", diseaseMasterRoutes);
app.use("/api", predictRoute);
app.use("/api/forecast", forecastRoutes);
app.use("/master-data-api", masterDataRoutes);
app.get("/", (req, res) => res.send("Manufacturer Server Running!"));

// Global error handler - ensures CORS headers are sent even on errors
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  
  // Ensure CORS headers are present
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

const getResolver = () => {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  return resolver;
};

const buildFallbackMongoUri = async (mongoSrvUri) => {
  const uri = new URL(mongoSrvUri);
  const host = uri.hostname;
  const dbName = uri.pathname && uri.pathname !== "/" ? uri.pathname.slice(1) : "test";
  const username = decodeURIComponent(uri.username || "");
  const password = decodeURIComponent(uri.password || "");

  const resolver = getResolver();

  const srvRecords = await resolver.resolveSrv(`_mongodb._tcp.${host}`);
  if (!srvRecords || srvRecords.length === 0) {
    throw new Error("No SRV records found for MongoDB host");
  }

  const hosts = srvRecords
    .sort((a, b) => a.priority - b.priority)
    .map((record) => `${record.name.replace(/\.$/, "")}:${record.port}`)
    .join(",");

  let txtParams = "";
  try {
    const txtRecords = await resolver.resolveTxt(host);
    txtParams = txtRecords.flat().join("");
  } catch (err) {
    txtParams = "";
  }

  const params = new URLSearchParams(uri.search || "");
  if (txtParams) {
    const txtSearchParams = new URLSearchParams(txtParams);
    for (const [key, value] of txtSearchParams.entries()) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }

  if (!params.has("tls")) params.set("tls", "true");
  if (!params.has("retryWrites")) params.set("retryWrites", "true");
  if (!params.has("w")) params.set("w", "majority");

  const authPart = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";

  return `mongodb://${authPart}${hosts}/${dbName}?${params.toString()}`;
};

const connectToMongo = async () => {
  const mongoUri = process.env.MONGO_URL;

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected");
  } catch (err) {
    const isSrvDnsIssue =
      mongoUri?.startsWith("mongodb+srv://") &&
      (err?.message?.includes("querySrv ECONNREFUSED") ||
        err?.code === "ECONNREFUSED");

    if (!isSrvDnsIssue) {
      throw err;
    }

    console.warn("Mongo SRV DNS lookup failed. Retrying with DNS fallback...");
    const fallbackUri = await buildFallbackMongoUri(mongoUri);
    await mongoose.connect(fallbackUri);
    console.log("MongoDB connected (DNS fallback)");
  }
};

connectToMongo().catch((err) => {
  console.error("Mongo connection failed:", err);
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
