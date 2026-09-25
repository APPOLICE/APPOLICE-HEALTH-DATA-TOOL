const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const DoctorPrescription = require("../models/doctor_prescription");
const MedicalAction = require("../models/medical_action");
const ToBePrescribedMedicine = require("../models/to_be_prescribed_medicine");
const Employee = require("../models/employee");
const FamilyMember = require("../models/family_member");
const DailyVisit = require("../models/daily_visit");
const { normalizePatientMetrics } = require("../utils/healthMetrics");
const { storeReportPdf } = require("../utils/storedReportPdf");
const { hydratePrescriptionInvestigations } = require("../utils/prescriptionInvestigations");

const getPatientMetrics = async ({ employeeId, isFamilyMember, familyMemberId }) => {
  const patient = isFamilyMember && familyMemberId
    ? await FamilyMember.findById(familyMemberId).select("Height Weight BMI").lean()
    : await Employee.findById(employeeId).select("Height Weight BMI").lean();

  return normalizePatientMetrics(patient || {});
};

// =======================================================
// ADD DOCTOR PRESCRIPTION (NO INVENTORY, NO LEDGER)
// =======================================================
router.post("/add", async (req, res) => {
  try {
    const {
      Institute_ID,
      Employee_ID,
      IsFamilyMember = false,
      FamilyMember_ID,
      Medicines,
      Notes,
      visit_id
    } = req.body;

    if (!Institute_ID || !Employee_ID || !Array.isArray(Medicines) || Medicines.length === 0) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    if (!mongoose.Types.ObjectId.isValid(Employee_ID)) {
      return res.status(400).json({ message: "Invalid Employee ID" });
    }

    const normalizedMedicines = Medicines.map((med) => ({
      ...med,
      Strength: (med?.Strength || "").trim() || undefined
    }));
    const patientMetrics = await getPatientMetrics({
      employeeId: Employee_ID,
      isFamilyMember: IsFamilyMember,
      familyMemberId: FamilyMember_ID
    });

    // Split medicines into regular vs to-be-prescribed based on flags
    const regularMedicines = normalizedMedicines.filter(m => !(m.ToBePrescribed || m.toBePrescribed || m.IsToBePrescribed));
    const toBePrescribedMedicines = normalizedMedicines.filter(m => (m.ToBePrescribed || m.toBePrescribed || m.IsToBePrescribed));

    const prescription = await DoctorPrescription.create({
      Institute: Institute_ID,
      Employee: Employee_ID,
      IsFamilyMember,
      FamilyMember: IsFamilyMember ? FamilyMember_ID : null,
      PatientMetrics: patientMetrics,
      Medicines: normalizedMedicines,
      Notes
    });

    // Store regular medicines in MedicalAction
    if (regularMedicines.length > 0) {
      const action = await MedicalAction.create({
        employee_id: Employee_ID,
        visit_id: visit_id || null,
        action_type: "DOCTOR_PRESCRIPTION",
        source: "DOCTOR",
        data: {
          doctor_prescription_id: prescription._id,
          IsFamilyMember,
          FamilyMember_ID: IsFamilyMember ? FamilyMember_ID : null,
          PatientMetrics: patientMetrics,
          medicines: regularMedicines
        },
        remarks: Notes || ""
      });

      try {
        const [employee, familyMember, visit] = await Promise.all([
          Employee.findById(Employee_ID).select("_id Name ABS_NO DOB Gender Blood_Group Height Weight BMI").lean(),
          IsFamilyMember && FamilyMember_ID
            ? FamilyMember.findById(FamilyMember_ID).select("_id Name Relationship DOB Gender Blood_Group Height Weight BMI").lean()
            : Promise.resolve(null),
          visit_id
            ? DailyVisit.findById(visit_id).populate("Institute_ID", "Institute_Name").lean()
            : Promise.resolve(null)
        ]);

        const reportRecord = await hydratePrescriptionInvestigations({
          _id: action._id,
          Timestamp: action.created_at || action.createdAt || new Date(),
          IsFamilyMember: Boolean(IsFamilyMember),
          FamilyMember: familyMember,
          Employee: employee,
          Institute: visit?.Institute_ID || Institute_ID,
          VisitSummary: visit
            ? {
                _id: visit._id,
                symptoms: visit.symptoms || "",
                Vitals: visit.Vitals || {}
              }
            : null,
          PatientMetrics: patientMetrics,
          Medicines: regularMedicines,
          Notes: Notes || "",
          Source: "DOCTOR_PRESCRIPTION",
          visit_id: visit_id || null
        });
        await storeReportPdf("prescription", action._id, reportRecord);
      } catch (pdfErr) {
        console.error("Doctor prescription PDF generation failed:", pdfErr.message);
      }
    }

    // Store to-be-prescribed medicines in separate collection
    if (toBePrescribedMedicines.length > 0) {
      const toBePrescribedRecords = toBePrescribedMedicines.map(med => ({
        Institute: Institute_ID,
        Employee: Employee_ID,
        IsFamilyMember,
        FamilyMember: IsFamilyMember ? FamilyMember_ID : null,
        visit_id: visit_id || null,
        Medicine_Name: med.Medicine_Name,
        Type: med.Type,
        Dosage_Form: med.Dosage_Form,
        FoodTiming: med.FoodTiming,
        Strength: med.Strength,
        Morning: med.Morning,
        Afternoon: med.Afternoon,
        Night: med.Night,
        Duration: med.Duration,
        Remarks: med.Remarks,
        Quantity: med.Quantity,
        Notes: Notes,
        prescription_id: prescription._id
      }));

      await ToBePrescribedMedicine.insertMany(toBePrescribedRecords);
    }

    res.status(201).json({
      message: "Doctor prescription saved",
      doctorPrescriptionId: prescription._id
    });

  } catch (err) {
    console.error("Doctor prescription error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// GET ALL TO-BE-PRESCRIBED MEDICINES FOR INSTITUTE
// =======================================================
router.get("/to-be-prescribed/all", verifyToken, async (req, res) => {
  try {
    const instituteId = req.user.instituteId;

    const toBePrescribedMedicines = await ToBePrescribedMedicine.find({ Institute: instituteId })
      .populate('Institute', 'Institute_Name')
      .populate('Employee', 'Name ABS_NO')
      .populate('FamilyMember', 'Name Relationship')
      .sort({ createdAt: -1 });

    res.status(200).json(toBePrescribedMedicines);

  } catch (err) {
    console.error("Error fetching all to-be-prescribed medicines:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// DOWNLOAD TO-BE-PRESCRIBED REPORT
// =======================================================
// =======================================================
// DOWNLOAD TO-BE-PRESCRIBED REPORT
// =======================================================
router.get("/to-be-prescribed/download", verifyToken, async (req, res) => {
  try {
    const instituteId = req.user.instituteId;
    const { format = 'csv', doctorId, fromDate, toDate } = req.query;

    let query = { Institute: instituteId };

    if (doctorId) query['prescription_id.created_by'] = doctorId;
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    const records = await ToBePrescribedMedicine.find(query)
      .populate('Institute', 'Institute_Name')
      .populate('Employee', 'Name ABS_NO')
      .populate('FamilyMember', 'Name Relationship')
      .populate('prescription_id', 'created_by')
      .sort({ createdAt: -1 });

    if (format === 'csv') {
      const csvData = [
        ['Doctor Name', 'Patient Name', 'Medicine Name', 'Type', 'Dosage Form', 'Strength', 'Morning', 'Afternoon', 'Night', 'Duration', 'Quantity', 'Date'],
        ...records.map(record => [
          record.prescription_id?.created_by || 'Unknown',
          record.IsFamilyMember && record.FamilyMember
            ? `${record.FamilyMember.Name} (${record.FamilyMember.Relationship})`
            : record.Employee?.Name || 'Unknown',
          record.Medicine_Name,
          record.Type || '',
          record.Dosage_Form || '',
          record.Strength || '',
          record.Morning ? 'Yes' : 'No',
          record.Afternoon ? 'Yes' : 'No',
          record.Night ? 'Yes' : 'No',
          record.Duration || '',
          record.Quantity || 0,
          new Date(record.createdAt).toLocaleDateString('en-GB')
        ])
      ];

      const csvContent = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="to-be-prescribed-medicines.csv"');
      res.send(csvContent);
    } else if (format === 'pdf') {
      // For PDF, we'll use a simple HTML to PDF conversion
      const htmlContent = `
        <html>
          <head>
            <style>
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; }
              h1 { color: #333; }
            </style>
          </head>
          <body>
            <h1>To Be Prescribed Medicines Report</h1>
            <p>Institute: ${records[0]?.Institute?.Institute_Name || 'N/A'}</p>
            <p>Generated on: ${new Date().toLocaleDateString()}</p>
            <table>
              <thead>
                <tr>
                  <th>Doctor Name</th>
                  <th>Patient Name</th>
                  <th>Medicine Name</th>
                  <th>Type</th>
                  <th>Dosage</th>
                  <th>Duration</th>
                  <th>Quantity</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${records.map(record => `
                  <tr>
                    <td>${record.prescription_id?.created_by || 'Unknown'}</td>
                    <td>${record.IsFamilyMember && record.FamilyMember
                      ? `${record.FamilyMember.Name} (${record.FamilyMember.Relationship})`
                      : record.Employee?.Name || 'Unknown'}</td>
                    <td>${record.Medicine_Name}</td>
                    <td>${record.Type || ''}</td>
                    <td>${[
                      record.Morning && 'Morning',
                      record.Afternoon && 'Afternoon',
                      record.Night && 'Night'
                    ].filter(Boolean).join(', ') || '-'}</td>
                    <td>${record.Duration || ''}</td>
                    <td>${record.Quantity || 0}</td>
                    <td>${new Date(record.createdAt).toLocaleDateString('en-GB')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'attachment; filename="to-be-prescribed-medicines.html"');
      res.send(htmlContent);
    } else {
      res.status(400).json({ message: 'Invalid format. Use csv or pdf.' });
    }

  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
