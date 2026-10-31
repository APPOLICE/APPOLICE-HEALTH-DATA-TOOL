const mongoose = require("mongoose");
const { Schema } = mongoose;

const FamilyMemberSchema = new Schema({
  Employee: { 
    type: Schema.Types.ObjectId, 
    ref: 'Employee', 
    required: true 
  },

  Name: { 
    type: String, 
    required: true 
  },

  Relationship: { 
    type: String, 
    required: true, 
    enum: ["Father", "Mother", "Wife", "Husband", "Son", "Daughter", "Child"]
  },

  DOB: { 
    type: Date 
  },

  Gender: { 
    type: String, 
    required: true, 
    enum: ["Male", "Female","Other"] 
  },

  // Newly Added Similar To Employee Schema
  Blood_Group: { 
    type: String, 
    enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', '']
  },

  ABHA_Number: {
    type: String,
    trim: true,
    default: "",
    validate: {
      validator: (value) => !value || /^\d{14}$/.test(value),
      message: "ABHA number must be exactly 14 digits"
    }
  },

  Height: { 
    type: String,
    trim: true 
  },

  Weight: { 
    type: String,
    trim: true 
  },

  BMI: {
    type: String,
    trim: true,
    default: ""
  },

  Phone_No: { 
    type: String,
    trim: true 
  },

  Photo: {
    type: String,
    default: null
  },

  Address: {
    Street: { type: String, trim: true },
    District: { type: String, trim: true },
    State: { type: String, trim: true },
    Pincode: { type: String, trim: true }
  },

  Medical_History: [
    {
      Date: { type: Date, default: Date.now },
      Disease: [{ type: Schema.Types.ObjectId, ref: "Disease" }],
      Diagnosis: String,
      Medicines: [
        {
          Medicine_Name: String,
          Quantity: Number
        }
      ],
      Notes: String
    }
  ]
});

module.exports = mongoose.model("FamilyMember", FamilyMemberSchema);
