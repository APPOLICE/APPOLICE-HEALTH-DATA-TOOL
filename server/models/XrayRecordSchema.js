const mongoose = require("mongoose");
const { Schema } = mongoose;

const XrayRecordSchema = new Schema(
{
  Institute: {
    type: Schema.Types.ObjectId,
    ref: "Institute",
    required: true
  },

  Employee: {
    type: Schema.Types.ObjectId,
    ref: "Employee",
    required: true
  },

  Visit: {
    type: Schema.Types.ObjectId,
    ref: "DailyVisit",
    default: null
  },

  IsFamilyMember: {
    type: Boolean,
    default: false
  },

  FamilyMember: {
    type: Schema.Types.ObjectId,
    ref: "FamilyMember",
    default: null
  },

  Xrays: [
    {
      Xray_ID: {
        type: Schema.Types.ObjectId,
        ref: "MasterValue"
      },

      Xray_Type: {
        type: String,
        required: true
      },

      Body_Part: {
        type: String,
        required: true
      },

      Side: {
        type: String,
        enum: ["Left","Right","Both","NA"],
        default: "NA"
      },

      View: String,

      Film_Size: String,

      Findings: String,

      Impression: String,

      Remarks: String,

      Timestamp: {
        type: Date,
        default: Date.now
      },

      // REPORT FILES FOR THIS XRAY
      Reports: [
        {
          filename: String,
          originalname: String,
          url: String,
          uploadedBy: String,
          uploadedAt: {
            type: Date,
            default: Date.now
          }
        }
      ]
    }
  ],

  Xray_Notes: String

},
{
  timestamps: true
}
);

// For fast history queries
XrayRecordSchema.index({
  Employee: 1,
  FamilyMember: 1,
  createdAt: -1
});

module.exports = mongoose.model("XrayRecord", XrayRecordSchema);
