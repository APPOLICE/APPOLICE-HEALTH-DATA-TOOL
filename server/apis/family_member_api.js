const express = require("express");
const expressAsyncHandler = require("express-async-handler");
const multer = require("multer");
const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const FamilyMember = require("../models/family_member");
const Employee = require("../models/employee");
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../utils/cloudinary");
const {
  normalizePatientMetrics,
  validateRequiredPatientMetrics
} = require("../utils/healthMetrics");
const FamilyApp = express.Router();
const familyPhotoDirectory = path.join(__dirname, "..", "uploads", "family-pics");
const photoExtensionsByMimeType = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    if (photoExtensionsByMimeType[file.mimetype] && allowedExtensions.includes(extension)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed"));
    }
  },
});

const storeFamilyPhoto = async (buffer, mimetype, memberId) => {
  if (isCloudinaryConfigured()) {
    const uploaded = await uploadBufferToCloudinary(buffer, {
      folder: "family-pics"
    });
    return uploaded.secure_url;
  }

  const filename = `${memberId}-${crypto.randomUUID()}${photoExtensionsByMimeType[mimetype] || ".jpg"}`;
  await fs.mkdir(familyPhotoDirectory, { recursive: true });
  await fs.writeFile(path.join(familyPhotoDirectory, filename), buffer);
  return `uploads/family-pics/${filename}`;
};

const profilePhotoUploadSingle = (req, res, next) => {
  upload.single("Photo")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

const normalizeAbhaNumber = (value) => String(value || "").trim();
const isValidAbhaNumber = (value) => !value || /^\d{14}$/.test(value);

const findExistingAbhaOwner = async (abhaNumber, { excludeEmployeeId, excludeFamilyId } = {}) => {
  const normalized = normalizeAbhaNumber(abhaNumber);
  if (!normalized) return null;

  const employeeQuery = { ABHA_Number: normalized };
  if (excludeEmployeeId) {
    employeeQuery._id = { $ne: excludeEmployeeId };
  }

  const existingEmployee = await Employee.findOne(employeeQuery).select("_id Name");
  if (existingEmployee) {
    return `employee ${existingEmployee.Name || ""}`.trim();
  }

  const familyQuery = { ABHA_Number: normalized };
  if (excludeFamilyId) {
    familyQuery._id = { $ne: excludeFamilyId };
  }

  const existingFamily = await FamilyMember.findOne(familyQuery).select("_id Name Relationship");
  if (existingFamily) {
    return `family member ${existingFamily.Name || ""}`.trim();
  }

  return null;
};

// Register Family Member
FamilyApp.post(
  "/register",
  upload.single("Photo"),
  expressAsyncHandler(async (req, res) => {
    const {
      Name,
      Gender,
      Relationship,
      DOB,
      Blood_Group,
      ABHA_Number,
      Height,
      Weight,
      Phone_No,
      Address,
      Medical_History,
      EmployeeId
    } = req.body;

    if (!Name || !Gender || !Relationship || !EmployeeId) {
      return res.status(400).json({
        message: "Name, Gender, Relationship, and EmployeeId are required",
      });
    }

    const metricError = validateRequiredPatientMetrics({ Height, Weight });
    if (metricError) {
      return res.status(400).json({ message: metricError });
    }

    // Check Employee Exists
    const employee = await Employee.findById(EmployeeId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const normalizedAbhaNumber = normalizeAbhaNumber(ABHA_Number);
    if (!isValidAbhaNumber(normalizedAbhaNumber)) {
      return res.status(400).json({
        message: "ABHA number must be exactly 14 digits"
      });
    }

    const existingAbhaOwner = await findExistingAbhaOwner(normalizedAbhaNumber);
    if (existingAbhaOwner) {
      return res.status(409).json({
        message: `ABHA number already exists for ${existingAbhaOwner}`
      });
    }

    // Parse Address if sent as JSON string (FormData)
    let parsedAddress = Address;
    if (typeof Address === "string") {
      try { parsedAddress = JSON.parse(Address); } catch { parsedAddress = {}; }
    }

    const patientMetrics = normalizePatientMetrics({ Height, Weight });

    const memberData = {
      Employee: EmployeeId,
      Name,
      Gender,
      Relationship,
      DOB,
      Blood_Group,
      ABHA_Number: normalizedAbhaNumber,
      Height: patientMetrics.Height,
      Weight: patientMetrics.Weight,
      BMI: patientMetrics.BMI,
      Phone_No,
      Address: parsedAddress,
      Medical_History,
    };

    const member = new FamilyMember(memberData);
    const saved = await member.save();

    // Push to Employee
    employee.FamilyMembers.push(saved._id);
    await employee.save();

    let message = "Family member registered";
    if (req.file?.buffer) {
      try {
        saved.Photo = await storeFamilyPhoto(req.file.buffer, req.file.mimetype, saved._id);
        await saved.save();
      } catch (error) {
        console.error("Family member registered but photo upload failed:", error);
        message += ". The photo could not be uploaded; you can add it later from the family member profile.";
      }
    }

    res.status(201).json({ message, payload: saved });
  })
);

// Fetch Family Members by Employee
// GET FAMILY MEMBERS FOR AN EMPLOYEE
FamilyApp.get("/family/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const employee = await Employee.findById(employeeId).select("_id");

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Query by Employee reference to avoid misses when Employee.FamilyMembers is stale.
    const members = await FamilyMember.find({ Employee: employeeId }).sort({ createdAt: -1, _id: -1 });
    res.json(members);
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message
    });
  }
});

FamilyApp.get(
  "/family-report/:id",
  expressAsyncHandler(async (req, res) => {
    const fam = await FamilyMember.findById(req.params.id).populate({
      path: "Medical_History.Disease",
      select: "Disease_Name Category Severity_Level",
    });

    if (!fam)
      return res.status(404).json({ message: "Family member not found" });

    res.json(fam);
  })
);

FamilyApp.put("/update/:id", expressAsyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const normalizedAbhaNumber = normalizeAbhaNumber(updateData.ABHA_Number);
    const metricError = validateRequiredPatientMetrics(updateData);

    if (metricError) {
      return res.status(400).json({ message: metricError });
    }

    if (!isValidAbhaNumber(normalizedAbhaNumber)) {
      return res.status(400).json({
        message: "ABHA number must be exactly 14 digits"
      });
    }

    const existingAbhaOwner = await findExistingAbhaOwner(normalizedAbhaNumber, { excludeFamilyId: id });
    if (existingAbhaOwner) {
      return res.status(409).json({
        message: `ABHA number already exists for ${existingAbhaOwner}`
      });
    }

    const updatedMember = await FamilyMember.findByIdAndUpdate(
      id,
      {
        Name: updateData.Name,
        Gender: updateData.Gender,
        Relationship: updateData.Relationship,
        DOB: updateData.DOB,
        Blood_Group: updateData.Blood_Group,
        ABHA_Number: normalizedAbhaNumber,
        ...normalizePatientMetrics(updateData),
        Phone_No: updateData.Phone_No,
        Address: updateData.Address,
        Medical_History: updateData.Medical_History
      },
      { new: true }
    );

    if (!updatedMember) {
      return res.status(404).json({ message: "Family member not found" });
    }

    res.status(200).json({
      message: "Family member updated successfully",
      member: updatedMember
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to update family member",
      error: err.message
    });
  }
}));

FamilyApp.put(
  "/upload-photo/:id",
  profilePhotoUploadSingle,
  expressAsyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({ message: "Family member photo is required" });
      }

      const member = await FamilyMember.findById(id);
      if (!member) {
        return res.status(404).json({ message: "Family member not found" });
      }

      member.Photo = await storeFamilyPhoto(req.file.buffer, req.file.mimetype, member._id);
      await member.save();

      res.status(200).json({
        message: "Family member photo uploaded successfully",
        member
      });
    } catch (err) {
      res.status(500).json({
        message: "Failed to upload family member photo",
        error: err.message
      });
    }
  })
);

module.exports = FamilyApp;
