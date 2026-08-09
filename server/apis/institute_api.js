const express = require('express');
const expressAsyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const instituteApp = express.Router();
const Institute = require('../models/master_institute');
const Medicine = require("../models/master_medicine");
const Employee = require("../models/employee");
const InstituteLedger = require("../models/InstituteLedger");
const MainStoreMedicine = require("../models/main_store");
const DiagnosisRecord = require("../models/diagnostics_record");
const FamilyMember = require("../models/family_member");
const Disease = require("../models/disease");


// GET all institutes
instituteApp.get("/institutions",verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const institutions = await Institute.find();
    res.json(institutions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all institutes except one
instituteApp.get("/except/:id", verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"),async (req, res) => {
  try {
    const { id } = req.params;
    console.log(id)

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid institute ID" });
    }

    const institutes = await Institute.find({
      _id: { $ne: id }
    })
    .select("Institute_Name Address District Institute_ID")
    .sort({ Institute_Name: 1 });

    res.json(institutes);

  } catch (err) {
    console.error("Get institutes except one error:", err);
    res.status(500).json({
      message: "Failed to fetch institutes",
      error: err.message
    });
  }
});

// POST - Register new institute (with password hashing)
instituteApp.post(
  "/register/institute",

  expressAsyncHandler(async (req, res) => {
    try {
      const instituteData = req.body;

      const {
        Institute_Name,
        Email_ID,
        password,
        confirm_password,
        Address,
        Contact_No
      } = instituteData;

      // 🔒 Required field check
      if (
        !Institute_Name ||
        !Email_ID ||
        !password ||
        !Address ||
        !Address.Street ||
        !Address.District ||
        !Address.State ||
        !Address.Pincode
      ) {
        return res.status(400).send({ message: "All required fields must be provided" });
      }

      // Check if passwords match
      if (confirm_password && password !== confirm_password) {
        return res.status(400).send({ message: "Passwords do not match" });
      }

      // Check if institute already exists
      const existingInstitute = await Institute.findOne({
        $or: [
          { Institute_Name },
          { Email_ID }
        ]
      });

      if (existingInstitute) {
        return res.status(409).send({
          message: existingInstitute.Institute_Name === Institute_Name
            ? "Institute name already exists"
            : "Email already registered"
        });
      }

      // Hash password before saving
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const newInstitute = new Institute({
        Institute_Name,
        Email_ID,
        password: hashedPassword, // Store hashed password
        Contact_No,
        Address,
        Medicine_Inventory: []
      });

      const savedInstitute = await newInstitute.save();

      // Remove password from response
      const instituteResponse = savedInstitute.toObject();
      delete instituteResponse.password;

      res.status(201).send({
        message: "Institute registered successfully",
        payload: instituteResponse
      });
    } catch (err) {
      console.error("Institute registration error:", err);

      if (err.code === 11000) {
        return res.status(409).json({
          message: "Duplicate entry. Institute name or email already exists."
        });
      }

      if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({
          message: "Validation failed",
          errors
        });
      }

      res.status(500).json({
        message: "Registration failed",
        error: err.message
      });
    }
  })
);


// GET institute profile (protected route)
// GET institute profile (protected route)
instituteApp.get('/profile/:id', verifyToken, async (req, res) => {
  try {

    if (req.user.instituteId !== req.params.id && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access denied. Not authorized to view this profile."
      });
    }

    const institute = await Institute.findById(req.params.id)
      .populate('Medicine_Inventory.Medicine_ID', 'Medicine_Name Threshold_Qty')
      .select('-password');

    if (!institute) {
      return res.status(404).json({
        message: 'Institute not found'
      });
    }

    const totalDistinct = institute.Medicine_Inventory.length;
    const totalQuantity = institute.Medicine_Inventory.reduce(
      (sum, item) => sum + (item.Quantity || 0), 0
    );

    const lowStock = institute.Medicine_Inventory
      .filter(item => item.Medicine_ID && typeof item.Medicine_ID.Threshold_Qty === 'number')
      .filter(item => item.Quantity < item.Medicine_ID.Threshold_Qty)
      .map(item => ({
        medicineId: item.Medicine_ID._id,
        medicineName: item.Medicine_ID.Medicine_Name,
        quantity: item.Quantity,
        threshold: item.Medicine_ID.Threshold_Qty
      }));

    const recentOrders = (institute.Orders || [])
      .slice()
      .sort((a, b) => new Date(b.Order_Date) - new Date(a.Order_Date))
      .slice(0, 10);

    return res.json({
      profile: institute,
      inventorySummary: {
        totalDistinct,
        totalQuantity,
        lowStockCount: lowStock.length,
        lowStock
      },
      recentOrders
    });

  } catch (err) {
    console.error('Error in GET /profile/:id', err);
    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
});
// PUT /institute-api/profile/:id (protected route)
instituteApp.put('/profile/:id', verifyToken,allowInstituteRoles(), async (req, res) => {
  try {
    // Authorization check
    if (req.user.id !== req.params.id) {
      return res.status(403).json({
        message: "Access denied. Can only update own profile."
      });
    }

    const allowed = ['Institute_Name', 'Address', 'Email_ID', 'Contact_No'];
    const update = {};

    allowed.forEach(field => {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    });

    // Handle password update separately
    if (req.body.password && req.body.confirm_password) {
      if (req.body.password !== req.body.confirm_password) {
        return res.status(400).json({
          message: 'Passwords do not match'
        });
      }

      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(req.body.password, salt);
    } else if (req.body.password && !req.body.confirm_password) {
      return res.status(400).json({
        message: 'Confirm password is required when changing password'
      });
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        message: 'No valid fields to update'
      });
    }

    const institute = await Institute.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    )
    .populate('Medicine_Inventory.Medicine_ID', 'Medicine_Name Threshold_Qty')
    .select('-password');

    if (!institute) {
      return res.status(404).json({
        message: 'Institute not found'
      });
    }

    return res.json({
      message: 'Profile updated successfully',
      profile: institute
    });
  } catch (err) {
    console.error('Error in PUT /profile/:id', err);

    if (err.code === 11000) {
      return res.status(409).json({
        message: 'Email or Institute Name already exists'
      });
    }

    return res.status(500).json({
      message: 'Server error',
      error: err.message
    });
  }
});

instituteApp.get("/inventory/:instituteId",verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const { instituteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Invalid institute ID" });
    }

    const instituteObjectId = new mongoose.Types.ObjectId(instituteId);

    const [mainStoreMeds, subStoreMeds] = await Promise.all([
      MainStoreMedicine.find({ Institute_ID: instituteObjectId }).lean(),
      Medicine.find({ Institute_ID: instituteObjectId }).lean()
    ]);

    const inventoryMap = {};

    // MAIN STORE
    for (const m of mainStoreMeds) {
      inventoryMap[m.Medicine_Code] = {
        _id: null,
        Medicine_Code: m.Medicine_Code,
        Medicine_Name: m.Medicine_Name,
        Type: m.Type || "",
        Dosage_Form: m.Dosage_Form || "",
        Strength: m.Strength || "",
        mainQty: m.Quantity,
        subQty: 0,
        mainExpiry: m.Expiry_Date,
        subExpiry: null
      };
    }

    // SUB STORE
    for (const m of subStoreMeds) {
      if (!inventoryMap[m.Medicine_Code]) {
        inventoryMap[m.Medicine_Code] = {
          _id: m._id,
          Medicine_Code: m.Medicine_Code,
          Medicine_Name: m.Medicine_Name,
          Type: m.Type || "",
          Dosage_Form: m.Dosage_Form || "",
          Strength: m.Strength || "",
          mainQty: 0,
          subQty: m.Quantity,
          mainExpiry: null,
          subExpiry: m.Expiry_Date
        };
      } else {
        inventoryMap[m.Medicine_Code]._id = m._id;
        inventoryMap[m.Medicine_Code].subQty = m.Quantity;
        inventoryMap[m.Medicine_Code].subExpiry = m.Expiry_Date;
        inventoryMap[m.Medicine_Code].Type =
          m.Type || inventoryMap[m.Medicine_Code].Type || "";
        inventoryMap[m.Medicine_Code].Dosage_Form =
          m.Dosage_Form || inventoryMap[m.Medicine_Code].Dosage_Form || "";
        inventoryMap[m.Medicine_Code].Strength =
          m.Strength || inventoryMap[m.Medicine_Code].Strength || "";
      }
    }

    // FINAL RESPONSE
    const inventory = Object.values(inventoryMap).map((item) => {
      let status = "";
      let quantity = 0;
      let expiry = null;

      if (item.subQty > 0) {
        quantity = item.subQty;
        status = "Available in substore";
        expiry = item.subExpiry;
      } else if (item.mainQty > 0) {
        quantity = 0;
        status = "Not available in substore";
        expiry = item.mainExpiry;
      } else {
        quantity = 0;
        status = "Not available in both";
      }

      return {
        _id: item._id,
        Medicine_Code: item.Medicine_Code,
        Medicine_Name: item.Medicine_Name,
        Medicine_Type: item.Type || "",
        Dosage_Form: item.Dosage_Form || "",
        Type: item.Type || "",
        Strength: item.Strength || "",
        Quantity: quantity,
        Status: status,
        Expiry_Date: expiry
      };
    });

    res.status(200).json(inventory);

  } catch (err) {
    console.error("Institute inventory error:", err);
    res.status(500).json({ message: err.message });
  }
});


// GET single institute by ID
instituteApp.get("/institution/:id", verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const institute = await Institute.findById(req.params.id).select('-password');
    if (!institute) {
      return res.status(404).json({
        message: "Institute not found"
      });
    }
    res.json(institute);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// GET dashboard stats (protected route)
instituteApp.get("/dashboard-stats/:instituteId",verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"),async (req, res) => {
  try {
    const { instituteId } = req.params;

    // Authorization check
    if (req.user.id !== instituteId && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access denied. Not authorized to view dashboard."
      });
    }

    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({
        message: "Invalid institute ID"
      });
    }

    // 1⃣ Total Employees
    const totalEmployees = await Employee.countDocuments();

    // 2⃣ Registered Employees (same as total employees for now)
    const registeredEmployees = totalEmployees;

    // 3⃣ Fetch institute
    const institute = await Institute.findById(instituteId).lean();
    if (!institute) {
      return res.status(404).json({
        message: "Institute not found"
      });
    }

    // 4⃣ Total medicines in inventory
    const totalMedicinesInInventory = institute.Medicine_Inventory?.reduce((sum, item) =>
      sum + (item.Quantity || 0), 0) || 0;

    // 5⃣ Low stock medicines
    const lowStockMedicines = institute.Medicine_Inventory?.filter(item => {
      const threshold = item.Medicine_ID?.Threshold_Qty || 0;
      return (item.Quantity || 0) < threshold;
    }).length || 0;

    return res.json({
      totalEmployees,
      registeredEmployees,
      totalMedicinesInInventory,
      lowStockMedicines,
      inventoryItemCount: institute.Medicine_Inventory?.length || 0
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    return res.status(500).json({
      message: "Server error",
      error: err.message
    });
  }
});

// GET detailed employees (protected route)
instituteApp.get("/employees-detailed", verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const employees = await Employee.find({})
      .select('ABS_NO Name Email Designation DOB Gender Phone_No Height Weight Address Blood_Group Photo Medical_History')
      .select('-password') // Ensure password is not included
      .sort({ Name: 1 })
      .lean();

    // Format the response
    const formattedEmployees = employees.map(emp => ({
      _id: emp._id,
      ABS_NO: emp.ABS_NO || "-",
      Name: emp.Name || "-",
      Email: emp.Email || "-",
      Designation: emp.Designation || "-",
      DOB: emp.DOB ? new Date(emp.DOB).toISOString().split('T')[0] : "-",
      Phone_No: emp.Phone_No || "-",
      Height: emp.Height || "-",
      Weight: emp.Weight || "-",
      Address: emp.Address ?
        `${emp.Address.Street || ""}, ${emp.Address.District || ""}, ${emp.Address.State || ""} - ${emp.Address.Pincode || ""}`.trim()
        : "-",
      Blood_Group: emp.Blood_Group || "-",
      Photo: emp.Photo || null,
      Medical_History_Count: emp.Medical_History?.length || 0,
      Medical_History: emp.Medical_History || []
    }));

    res.status(200).json({
      count: formattedEmployees.length,
      employees: formattedEmployees
    });
  } catch (err) {
    console.error("Error fetching detailed employees:", err);
    res.status(500).json({
      message: "Failed to fetch employees",
      error: err.message
    });
  }
});

// GET single employee details (protected route)
instituteApp.get("/employee/:id", verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid employee ID"
      });
    }

    const employee = await Employee.findById(id)
      .select('-Password')
      .lean();

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found"
      });
    }

    // Format the response
    const formattedEmployee = {
      ...employee,
      DOB: employee.DOB ? new Date(employee.DOB).toISOString().split('T')[0] : null,
      Address: employee.Address ?
        `${employee.Address.Street || ""}, ${employee.Address.District || ""}, ${employee.Address.State || ""} - ${employee.Address.Pincode || ""}`.trim()
        : null,
      Medical_History_Count: employee.Medical_History?.length || 0
    };

    res.status(200).json(formattedEmployee);
  } catch (err) {
    console.error("Error fetching employee details:", err);
    res.status(500).json({
      message: "Failed to fetch employee details",
      error: err.message
    });
  }
});

instituteApp.get("/analytics/:instituteId",verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), async (req, res) => {
  try {
    const { instituteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({ message: "Invalid institute ID" });
    }

    const instituteObjectId = new mongoose.Types.ObjectId(instituteId);

    /* =====================================================
       EMPLOYEE PIPELINE
    ======================================================*/
    const employeePipeline = [
      /* 🔹 Prescriptions */
      {
        $lookup: {
          from: "prescriptions",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$Employee", "$$empId"] },
                    { $eq: ["$Institute", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", false] }
                  ]
                }
              }
            }
          ],
          as: "prescriptions"
        }
      },
      {
        $lookup: {
          from: "medicalactions",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employee_id", "$$empId"] },
                    { $eq: ["$action_type", "DOCTOR_PRESCRIPTION"] },
                    { $eq: [{ $ifNull: ["$data.IsFamilyMember", false] }, false] }
                  ]
                }
              }
            },
            {
              $lookup: {
                from: "dailyvisits",
                localField: "visit_id",
                foreignField: "_id",
                as: "visit"
              }
            },
            {
              $addFields: {
                visit: { $ifNull: [{ $arrayElemAt: ["$visit", 0] }, null] }
              }
            },
            {
              $match: {
                $expr: {
                  $eq: ["$visit.Institute_ID", instituteObjectId]
                }
              }
            }
          ],
          as: "doctorPrescriptions"
        }
      },

      /* 🔹 Diagnosis Records */
      {
        $lookup: {
          from: "diagnosisrecords",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$Employee", "$$empId"] },
                    { $eq: ["$Institute", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", false] }
                  ]
                }
              }
            }
          ],
          as: "diagnosis"
        }
      },

      /* 🔹 Diseases */
      {
        $lookup: {
          from: "diseases",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$Employee_ID", "$$empId"] },
                    { $eq: ["$Institute_ID", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", false] }
                  ]
                }
              }
            }
          ],
          as: "diseases"
        }
      },

      /* 🔹 Include ONLY if any record exists */
      {
        $match: {
          $expr: {
            $or: [
              { $gt: [{ $size: "$prescriptions" }, 0] },
              { $gt: [{ $size: "$doctorPrescriptions" }, 0] },
              { $gt: [{ $size: "$diagnosis" }, 0] },
              { $gt: [{ $size: "$diseases" }, 0] }
            ]
          }
        }
      },

      /* 🔹 Derived Fields */
      {
        $addFields: {
          Age: {
            $cond: [
              { $ifNull: ["$DOB", false] },
              {
                $dateDiff: {
                  startDate: "$DOB",
                  endDate: "$$NOW",
                  unit: "year"
                }
              },
              null
            ]
          }
        }
      },

      /* 🔹 Final Shape */
      {
        $project: {
          Role: { $literal: "Employee" },
          Name: { $ifNull: ["$Name", "N/A"] },
          ABS_NO: { $ifNull: ["$ABS_NO", "N/A"] },
          Linked_Employee_Name: null,

          District: { $ifNull: ["$Address.District", "N/A"] },
          State: { $ifNull: ["$Address.State", "N/A"] },

          Age: 1,
          Gender: { $ifNull: ["$Gender", "N/A"] },
          Blood_Group: { $ifNull: ["$Blood_Group", "N/A"] },
          Phone_No: { $ifNull: ["$Phone_No", "N/A"] },
          Height: { $ifNull: ["$Height", "N/A"] },
          Weight: { $ifNull: ["$Weight", "N/A"] },

          Communicable_Diseases: {
            $map: {
              input: {
                $filter: {
                  input: "$diseases",
                  as: "d",
                  cond: { $eq: ["$$d.Category", "Communicable"] }
                }
              },
              as: "d",
              in: {
                $concat: [
                  "$$d.Disease_Name",
                  " (",
                  "$$d.Severity_Level",
                  ")"
                ]
              }
            }
          },

          NonCommunicable_Diseases: {
            $map: {
              input: {
                $filter: {
                  input: "$diseases",
                  as: "d",
                  cond: { $eq: ["$$d.Category", "Non-Communicable"] }
                }
              },
              as: "d",
              in: {
                $concat: [
                  "$$d.Disease_Name",
                  " (",
                  "$$d.Severity_Level",
                  ")"
                ]
              }
            }
          },

          Tests: {
            $reduce: {
              input: "$diagnosis",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this.Tests"] }
            }
          },

          Medicines: {
            $concatArrays: [
              {
                $reduce: {
                  input: "$prescriptions",
                  initialValue: [],
                  in: { $concatArrays: ["$$value", "$$this.Medicines"] }
                }
              },
              {
                $reduce: {
                  input: "$doctorPrescriptions",
                  initialValue: [],
                  in: {
                    $concatArrays: [
                      "$$value",
                      {
                        $map: {
                          input: { $ifNull: ["$$this.data.medicines", []] },
                          as: "m",
                          in: {
                            Medicine_Name: "$$m.Medicine_Name",
                            Quantity: { $ifNull: ["$$m.Quantity", 0] }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },
          First_Visit_Date: {
            $min: {
              $concatArrays: [
                {
                  $map: {
                    input: "$diagnosis",
                    as: "d",
                    in: "$$d.createdAt"
                  }
                },
                {
                  $map: {
                    input: "$prescriptions",
                    as: "p",
                    in: "$$p.Timestamp"
                  }
                },
                {
                  $map: {
                    input: "$doctorPrescriptions",
                    as: "dp",
                    in: "$$dp.created_at"
                  }
                }
              ]
            }
          },

          Last_Visit_Date: {
            $max: {
              $concatArrays: [
                {
                  $map: {
                    input: "$diagnosis",
                    as: "d",
                    in: "$$d.createdAt"
                  }
                },
                {
                  $map: {
                    input: "$prescriptions",
                    as: "p",
                    in: "$$p.Timestamp"
                  }
                },
                {
                  $map: {
                    input: "$doctorPrescriptions",
                    as: "dp",
                    in: "$$dp.created_at"
                  }
                }
              ]
            }
          }

        }
      }
    ];

    /* =====================================================
       FAMILY MEMBER PIPELINE
    ======================================================*/
    const familyPipeline = [
      /* 🔹 Prescriptions */
      {
        $lookup: {
          from: "prescriptions",
          let: { famId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$FamilyMember", "$$famId"] },
                    { $eq: ["$Institute", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", true] }
                  ]
                }
              }
            }
          ],
          as: "prescriptions"
        }
      },
      {
        $lookup: {
          from: "medicalactions",
          let: { empId: "$Employee", famId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employee_id", "$$empId"] },
                    { $eq: ["$action_type", "DOCTOR_PRESCRIPTION"] },
                    { $eq: [{ $ifNull: ["$data.IsFamilyMember", false] }, true] },
                    {
                      $eq: [
                        {
                          $convert: {
                            input: "$data.FamilyMember_ID",
                            to: "string",
                            onError: "",
                            onNull: ""
                          }
                        },
                        {
                          $convert: {
                            input: "$$famId",
                            to: "string",
                            onError: "",
                            onNull: ""
                          }
                        }
                      ]
                    }
                  ]
                }
              }
            },
            {
              $lookup: {
                from: "dailyvisits",
                localField: "visit_id",
                foreignField: "_id",
                as: "visit"
              }
            },
            {
              $addFields: {
                visit: { $ifNull: [{ $arrayElemAt: ["$visit", 0] }, null] }
              }
            },
            {
              $match: {
                $expr: {
                  $eq: ["$visit.Institute_ID", instituteObjectId]
                }
              }
            }
          ],
          as: "doctorPrescriptions"
        }
      },

      /* 🔹 Diagnosis Records */
      {
        $lookup: {
          from: "diagnosisrecords",
          let: { famId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$FamilyMember", "$$famId"] },
                    { $eq: ["$Institute", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", true] }
                  ]
                }
              }
            }
          ],
          as: "diagnosis"
        }
      },

      /* 🔹 Diseases */
      {
        $lookup: {
          from: "diseases",
          let: { famId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$FamilyMember_ID", "$$famId"] },
                    { $eq: ["$Institute_ID", instituteObjectId] },
                    { $eq: ["$IsFamilyMember", true] }
                  ]
                }
              }
            }
          ],
          as: "diseases"
        }
      },

      /* 🔹 Include ONLY if any record exists */
      {
        $match: {
          $expr: {
            $or: [
              { $gt: [{ $size: "$prescriptions" }, 0] },
              { $gt: [{ $size: "$doctorPrescriptions" }, 0] },
              { $gt: [{ $size: "$diagnosis" }, 0] },
              { $gt: [{ $size: "$diseases" }, 0] }
            ]
          }
        }
      },

      /* 🔹 Join Employee (for name & district) */
      {
        $lookup: {
          from: "employees",
          localField: "Employee",
          foreignField: "_id",
          as: "emp"
        }
      },
      {
        $addFields: {
          emp: { $ifNull: [{ $arrayElemAt: ["$emp", 0] }, {}] }
        }
      },

      /* 🔹 Derived Fields */
      {
        $addFields: {
          Age: {
            $cond: [
              { $ifNull: ["$DOB", false] },
              {
                $dateDiff: {
                  startDate: "$DOB",
                  endDate: "$$NOW",
                  unit: "year"
                }
              },
              null
            ]
          }
        }
      },

      /* 🔹 Final Shape */
      {
        $project: {
          Role: { $literal: "Family" },
          Name: { $ifNull: ["$Name", "N/A"] },
          Linked_Employee_Name: { $ifNull: ["$emp.Name", "N/A"] },
          ABS_NO: { $ifNull: ["$emp.ABS_NO", "N/A"] },
          District: {
            $ifNull: ["$Address.District", { $ifNull: ["$emp.Address.District", "N/A"] }]
          },
          State: {
            $ifNull: ["$Address.State", { $ifNull: ["$emp.Address.State", "N/A"] }]
          },

          Age: 1,
          Gender: { $ifNull: ["$Gender", "N/A"] },
          Blood_Group: { $ifNull: ["$Blood_Group", "N/A"] },
          Phone_No: { $ifNull: ["$Phone_No", "N/A"] },
          Height: { $ifNull: ["$Height", "N/A"] },
          Weight: { $ifNull: ["$Weight", "N/A"] },

          Communicable_Diseases: {
            $map: {
              input: {
                $filter: {
                  input: "$diseases",
                  as: "d",
                  cond: { $eq: ["$$d.Category", "Communicable"] }
                }
              },
              as: "d",
              in: {
                $concat: [
                  "$$d.Disease_Name",
                  " (",
                  "$$d.Severity_Level",
                  ")"
                ]
              }
            }
          },

          NonCommunicable_Diseases: {
            $map: {
              input: {
                $filter: {
                  input: "$diseases",
                  as: "d",
                  cond: { $eq: ["$$d.Category", "Non-Communicable"] }
                }
              },
              as: "d",
              in: {
                $concat: [
                  "$$d.Disease_Name",
                  " (",
                  "$$d.Severity_Level",
                  ")"
                ]
              }
            }
          },

          Tests: {
            $reduce: {
              input: "$diagnosis",
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this.Tests"] }
            }
          },

          Medicines: {
            $concatArrays: [
              {
                $reduce: {
                  input: "$prescriptions",
                  initialValue: [],
                  in: { $concatArrays: ["$$value", "$$this.Medicines"] }
                }
              },
              {
                $reduce: {
                  input: "$doctorPrescriptions",
                  initialValue: [],
                  in: {
                    $concatArrays: [
                      "$$value",
                      {
                        $map: {
                          input: { $ifNull: ["$$this.data.medicines", []] },
                          as: "m",
                          in: {
                            Medicine_Name: "$$m.Medicine_Name",
                            Quantity: { $ifNull: ["$$m.Quantity", 0] }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            ]
          },

          First_Visit_Date: {
            $min: {
              $concatArrays: [
                {
                  $map: {
                    input: "$diagnosis",
                    as: "d",
                    in: "$$d.createdAt"
                  }
                },
                {
                  $map: {
                    input: "$prescriptions",
                    as: "p",
                    in: "$$p.Timestamp"
                  }
                },
                {
                  $map: {
                    input: "$doctorPrescriptions",
                    as: "dp",
                    in: "$$dp.created_at"
                  }
                }
              ]
            }
          },

          Last_Visit_Date: {
            $max: {
              $concatArrays: [
                {
                  $map: {
                    input: "$diagnosis",
                    as: "d",
                    in: "$$d.createdAt"
                  }
                },
                {
                  $map: {
                    input: "$prescriptions",
                    as: "p",
                    in: "$$p.Timestamp"
                  }
                },
                {
                  $map: {
                    input: "$doctorPrescriptions",
                    as: "dp",
                    in: "$$dp.created_at"
                  }
                }
              ]
            }
          }

        }
      }
    ];

    /* =====================================================
       EXECUTE & RETURN
    ======================================================*/
    const employees = await Employee.aggregate(employeePipeline);
    const family = await FamilyMember.aggregate(familyPipeline);

    res.json([...employees, ...family]);
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: err.message });
  }
});


// Optional: Token verification endpoint
instituteApp.get("/verify-token", verifyToken,
  allowInstituteRoles("doctor", "pharmacist", "diagnosis", "xray","front_desk"), (req, res) => {
  res.status(200).json({
    message: "Token is valid",
    user: req.user
  });
});

module.exports = instituteApp;
