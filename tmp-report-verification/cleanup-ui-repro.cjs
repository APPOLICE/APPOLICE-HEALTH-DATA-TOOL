const path = require("path");
require("../server/node_modules/dotenv").config({ path: path.join(__dirname, "..", "server", ".env") });
const mongoose = require("../server/node_modules/mongoose");
const DailyVisit = require("../server/models/daily_visit");
const MedicalAction = require("../server/models/medical_action");
const DiagnosisRecord = require("../server/models/diagnostics_record");
const XrayRecord = require("../server/models/XrayRecordSchema");
const Employee = require("../server/models/employee");

(async () => {
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  const visitId = "6ab63aa66313ae55eb47111f";
  const [diagnosis, xray, actions, visit] = await Promise.all([
    DiagnosisRecord.deleteMany({ Visit: visitId }),
    XrayRecord.deleteMany({ Visit: visitId }),
    MedicalAction.deleteMany({
      visit_id: visitId,
      action_type: { $in: ["DOCTOR_DIAGNOSIS", "DOCTOR_XRAY"] },
    }),
    DailyVisit.deleteOne({ _id: visitId }),
  ]);
  const history = await Employee.updateOne(
    { _id: "69d4931434daf9900a22d88a" },
    { $pull: { Medical_History: { Date: { $gte: new Date("2026-09-25T09:18:00.000Z") }, Notes: /Added 14 new test/ } } }
  );
  console.log(JSON.stringify({
    diagnosis: diagnosis.deletedCount,
    xray: xray.deletedCount,
    actions: actions.deletedCount,
    visit: visit.deletedCount,
    historyModified: history.modifiedCount,
  }));
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
