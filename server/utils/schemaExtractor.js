// backend/utils/schemaExtractor.js

const schemaDefinitions = {
  Employee: {
    description: "Government employees who are patients",
    fields: {
      _id: "ObjectId",
      ABS_NO: "String (unique employee number)",
      Name: "String",
      Email: "String",
      Designation: "String",
      DOB: "Date",
      Blood_Group: "String (A+, A-, B+, B-, O+, O-, AB+, AB-, empty)",
      Height: "String",
      Weight: "String",
      Phone_No: "String",
      Address: {
        Street: "String",
        District: "String",
        State: "String",
        Pincode: "String"
      },
      FamilyMembers: "Array of ObjectId (ref: FamilyMember)",
      createdAt: "Date",
      updatedAt: "Date"
    }
  },

  FamilyMember: {
    description: "Family members of employees",
    fields: {
      _id: "ObjectId",
      Employee: "ObjectId (ref: Employee)",
      Name: "String",
      Relationship: "String (Father, Mother, Wife, Husband, Son, Daughter, Child)",
      DOB: "Date",
      Gender: "String (Male, Female)",
      Blood_Group: "String (A+, A-, B+, B-, O+, O-, AB+, AB-, empty)",
      Height: "String",
      Weight: "String",
      Phone_No: "String",
      Address: {
        Street: "String",
        District: "String",
        State: "String",
        Pincode: "String"
      }
    }
  },

  Disease: {
    description: "Disease records for employees and family members",
    fields: {
      _id: "ObjectId",
      Institute_ID: "ObjectId (ref: Institute)",
      Employee_ID: "ObjectId (ref: Employee)",
      IsFamilyMember: "Boolean",
      FamilyMember_ID: "ObjectId (ref: FamilyMember, nullable)",
      Disease_Name: "String",
      Category: "String (Communicable, Non-Communicable)",
      Description: "String",
      Symptoms: "Array of Strings",
      Common_Medicines: "Array of Strings",
      Severity_Level: "String (Mild, Moderate, Severe, Chronic)",
      Diagnosis: "String",
      Notes: "String",
      createdAt: "Date",
      updatedAt: "Date"
    }
  },

  Prescription: {
    description: "Pharmacy prescriptions issued to patients",
    fields: {
      _id: "ObjectId",
      Institute: "ObjectId (ref: Institute)",
      Employee: "ObjectId (ref: Employee)",
      IsFamilyMember: "Boolean",
      FamilyMember: "ObjectId (ref: FamilyMember, nullable)",
      Medicines: [
        {
          Medicine_ID: "ObjectId (ref: Medicine)",
          Medicine_Name: "String",
          Quantity: "Number"
        }
      ],
      Notes: "String",
      Timestamp: "Date"
    }
  },

  DiagnosisRecord: {
    description: "Diagnostic test records",
    fields: {
      _id: "ObjectId",
      Institute: "ObjectId (ref: Institute)",
      Employee: "ObjectId (ref: Employee)",
      IsFamilyMember: "Boolean",
      FamilyMember: "ObjectId (ref: FamilyMember, nullable)",
      Tests: [
        {
          Test_Name: "String",
          Group: "String",
          Result_Value: "String",
          Reference_Range: "String",
          Units: "String",
          Remarks: "String",
          Timestamp: "Date"
        }
      ],
      Diagnosis_Notes: "String",
      createdAt: "Date",
      updatedAt: "Date"
    }
  },

  DailyVisit: {
    description: "Daily patient visits/registrations",
    fields: {
      _id: "ObjectId",
      employee_id: "ObjectId (ref: Employee)",
      abs_no: "String",
      patient: {
        type: "String (EMPLOYEE or FAMILY)",
        name: "String",
        relation: "String",
        age: "Number",
        symptoms: "String"
      },
      token_no: "Number",
      visit_date: "Date",
      status: "String (REGISTERED, DOCTOR_DONE, DIAGNOSIS_DONE, PHARMACY_DONE, COMPLETED)",
      created_at: "Date"
    }
  },

  Medicine: {
    description: "Sub-store medicine inventory",
    fields: {
      _id: "ObjectId",
      Institute_ID: "ObjectId (ref: Institute)",
      Medicine_Code: "String",
      Medicine_Name: "String",
      Type: "String",
      Category: "String",
      Quantity: "Number (current stock)",
      Threshold_Qty: "Number",
      Expiry_Date: "Date",
      Source: "String (MAIN_STORE)",
      createdAt: "Date",
      updatedAt: "Date"
    }
  },Institute: {
    _id: "ObjectId",
    Institute_ID: "Number",
    Institute_Name: "String",
    Address: "Object",
    Medicine_Inventory: [
      {
        Medicine_ID: "ObjectId -> Medicine",
        Quantity: "Number"
      }
    ],
    Employees: ["ObjectId -> Employee"],
    Orders: ["ObjectId -> Order"]
  }
};

module.exports = { schemaDefinitions };