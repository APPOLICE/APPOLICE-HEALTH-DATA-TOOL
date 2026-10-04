const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Groq = require('groq-sdk');
const { schemaDefinitions } = require('../utils/schemaExtractor');
const expressAsyncHandler = require("express-async-handler");
const { verifyToken, allowInstituteRoles } = require("./instituteAuth");
const AIQuery = require('../models/AIQuery');
// Lazy-initialize Groq only when API key is available
let groq = null;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('🤖 Groq AI initialized ✅');
} else {
  console.warn('⚠️  GROQ_API_KEY not set — AI query endpoints will be disabled');
}

// Validate query to ensure READ-ONLY operations
function validateQuery(query) {
  const queryStr = JSON.stringify(query).toLowerCase();
  
  // Block any write operations
  const dangerousOps = [
    'insert', 'update', 'delete', 'remove', 'drop',
    'save', 'create', 'replace', '$where', 'eval'
  ];
  
  for (const op of dangerousOps) {
    if (queryStr.includes(op)) {
      throw new Error(`Operation '${op}' is not allowed. Only READ operations permitted.`);
    }
  }
  
  return true;
}

// NEW: Preprocess casual queries into structured questions
async function preprocessQuery(userQuery) {
  console.log('🔄 Preprocessing casual query...');
  
  const preprocessPrompt = `You are a query translator. Convert casual questions into clear, structured database queries.

User's casual question: "${userQuery}"

Convert this into a clear, structured question that specifies:
- What data to retrieve (employees, patients, diseases, prescriptions, etc.)
- What filters to apply (blood group, age, disease name, etc.)
- What grouping or aggregation is needed (count, list, distribution, etc.)

Examples:
Casual: "which age group has high diabetes?"
Structured: "Show the count of diabetes patients grouped by age ranges (0-20, 20-40, 40-60, 60-80, 80+)"

Casual: "show me O+ blood people"
Structured: "List all employees with blood group O+"

Casual: "who has sugar problem"
Structured: "List all patients with diabetes disease"

Casual: "how many got BP medicine"
Structured: "Count prescriptions containing hypertension or blood pressure medicines"

Now convert this casual query into a structured one:
Casual: "${userQuery}"
Structured:`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a query translator. Respond with ONLY the structured query, nothing else."
        },
        {
          role: "user",
          content: preprocessPrompt
        }
      ],
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 200,
    });

    const structuredQuery = chatCompletion.choices[0].message.content.trim();
    console.log('✅ Structured query:', structuredQuery);
    return structuredQuery;
    
  } catch (error) {
    console.warn('⚠️ Query preprocessing failed, using original query');
    return userQuery; // Fallback to original
  }
}
// Main query endpoint
router.post('/query', async (req, res) => {
  try {
if (!groq) {
  return res.status(503).json({
    error: 'AI Insights is not configured on the server. Please set GROQ_API_KEY and restart the server.'
  });
}

const { userQuery, instituteId } = req.body;

if (!userQuery) {
  return res.status(400).json({ error: 'Query is required' });
}

console.log('📝 Received query:', userQuery);
console.log('🏥 Institute ID:', instituteId);

// Step 1: Create prompt
const prompt = `You are a MongoDB query generator...
Available Collections and Schemas:
${JSON.stringify(schemaDefinitions, null, 2)}

User Query: "${userQuery}"

IMPORTANT RULES:
1. Return ONLY valid JSON (no markdown, no explanations, no preamble)
2. Use MongoDB aggregate pipeline when joining collections
3. 3. For Institute-specific data, you MAY filter by Institute_ID: "${instituteId}" only if it makes sense for the query. For counting prescriptions by medicine name, you don't need Institute filtering.
4. Use ObjectId references correctly
5. Return in this exact format:
{
  "collection": "CollectionName",
  "operation": "find" or "aggregate",
  "query": {} or [],
  "projection": {},
  "chartType": "bar|line|pie|none",
  "chartConfig": {
    "xField": "field_for_x_axis",
    "yField": "field_for_y_axis",
    "title": "Chart Title"
  }
}

Examples:

Query: "List all employees with blood group O+"
Response:
{
  "collection": "Employee",
  "operation": "find",
  "query": { "Blood_Group": "O+" },
  "projection": { "Name": 1, "ABS_NO": 1, "Blood_Group": 1, "Designation": 1 },
  "chartType": "none"
}

Query: "Count prescriptions by medicine name"
Response:
{
  "collection": "Prescription",
  "operation": "aggregate",
  "query": [
    { "$unwind": "$Medicines" },
    { "$group": { 
        "_id": "$Medicines.Medicine_Name", 
        "count": { "$sum": 1 }
    }},
    { "$sort": { "count": -1 } },
    { "$limit": 10 }
  ],
  "projection": {},
  "chartType": "pie",
  "chartConfig": {
    "xField": "_id",
    "yField": "count",
    "title": "Prescriptions by Medicine Name"
  }
}

Query: "Show age distribution of diabetes patients"
Response:
{
  "collection": "Disease",
  "operation": "aggregate",
  "query": [
    { "$match": { "Disease_Name": { "$regex": "diabetes", "$options": "i" }, "Institute_ID": ObjectId("${instituteId}") } },
    { "$lookup": { "from": "employees", "localField": "Employee_ID", "foreignField": "_id", "as": "employee" } },
    { "$unwind": "$employee" },
    { "$project": { 
        "age": { "$subtract": [ { "$year": new Date() }, { "$year": "$employee.DOB" } ] },
        "name": "$employee.Name"
    }},
    { "$bucket": {
        "groupBy": "$age",
        "boundaries": [0, 20, 40, 60, 80, 100],
        "default": "Other",
        "output": { "count": { "$sum": 1 } }
    }}
  ],
  "projection": {},
  "chartType": "bar",
  "chartConfig": {
    "xField": "_id",
    "yField": "count",
    "title": "Age Distribution of Diabetes Patients"
  }
}

Now generate the query for: "${userQuery}"

Remember: Return ONLY the JSON object, no other text.`;

    // Step 2: Call Groq AI
    console.log('🤖 Calling Groq AI...');
    
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 2048,
    });

    let aiResponse = chatCompletion.choices[0].message.content;
    console.log('📥 AI Response:', aiResponse);

    // Clean up response (remove markdown if present)
// Clean up response (remove markdown and extra text)
// Clean up response (remove markdown and extra text)
aiResponse = aiResponse
  .replace(/```json\n?/g, '')
  .replace(/```\n?/g, '')
  .replace(/^[^{]*/g, '') // Remove anything before first {
  .replace(/[^}]*$/g, '') // Remove anything after last }
  .trim();

console.log('🧹 Cleaned response:', aiResponse);

// Convert MongoDB shell syntax to valid JSON
aiResponse = aiResponse
  .replace(/ObjectId\("([^"]+)"\)/g, '"$1"') // ObjectId("xxx") -> "xxx"
  .replace(/new Date\(\)/g, '"$$NOW"') // new Date() -> "$$NOW" (MongoDB operator)
  .replace(/ISODate\("([^"]+)"\)/g, '"$1"'); // ISODate("xxx") -> "xxx"

console.log('🔧 Converted MongoDB syntax:', aiResponse);
    // Step 3: Parse the query
    let mongoQueryObject;
    // Step 3: Parse the query
try {
  mongoQueryObject = JSON.parse(aiResponse);
  console.log('✅ Parsed MongoDB Query:', JSON.stringify(mongoQueryObject, null, 2));
}catch (parseError) {
      console.error('❌ Failed to parse AI response:', aiResponse);
      return res.status(500).json({ 
        error: 'AI generated invalid query format',
        details: aiResponse 
      });
    }
    // Step 3.5: Convert string ObjectIds back to proper ObjectId objects
// Step 3.5: Convert string ObjectIds and handle nested structures
function convertObjectIds(obj) {
  // Handle strings - check if it's an ObjectId
  if (typeof obj === 'string') {
    if (/^[0-9a-fA-F]{24}$/.test(obj)) {
      return new mongoose.Types.ObjectId(obj);
    }
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => convertObjectIds(item));
  }
  
  // Handle objects
  if (obj !== null && typeof obj === 'object') {
    // Check if it's already an ObjectId instance
    if (obj instanceof mongoose.Types.ObjectId) {
      return obj;
    }
    
    // Check if it's a {$oid: "..."} structure (from some conversions)
    if (obj.$oid && typeof obj.$oid === 'string') {
      return new mongoose.Types.ObjectId(obj.$oid);
    }
    
    // Check if it has _bsontype (already a proper ObjectId)
    if (obj._bsontype === 'ObjectId') {
      return obj;
    }
    
    // Recursively convert all properties
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      // Special handling for _id fields
      if (key === '_id' || key.endsWith('_ID') || key.endsWith('_id')) {
        if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) {
          converted[key] = new mongoose.Types.ObjectId(value);
        } else {
          converted[key] = convertObjectIds(value);
        }
      } else {
        converted[key] = convertObjectIds(value);
      }
    }
    return converted;
  }
  
  return obj;
}

// Convert ObjectIds in the query
if (mongoQueryObject.query) {
  mongoQueryObject.query = convertObjectIds(mongoQueryObject.query);
}

console.log('✅ Final MongoDB Query:', JSON.stringify(mongoQueryObject, null, 2));

// Convert ObjectIds in the query
if (mongoQueryObject.query) {
  mongoQueryObject.query = convertObjectIds(mongoQueryObject.query);
}

console.log('✅ Final MongoDB Query with ObjectIds:', JSON.stringify(mongoQueryObject, null, 2));

    // Step 4: Validate query
    validateQuery(mongoQueryObject);

    // Step 5: Execute query on MongoDB
    const { collection, operation, query, projection, chartType, chartConfig } = mongoQueryObject;

    console.log('🔍 Executing on collection:', collection);

    const Collection = mongoose.connection.collection(collection.toLowerCase() + 's');

let results;
try {
  if (operation === 'aggregate') {
    console.log('📊 Running aggregation pipeline...');
    results = await Collection.aggregate(query).toArray();
  } else {
    console.log('🔍 Running find query...');
    results = await Collection.find(query, { projection }).toArray();
  }
} catch (dbError) {
  console.error('❌ MongoDB execution error:', dbError);
  return res.status(500).json({
    error: 'Database query execution failed',
    details: dbError.message,
    query: mongoQueryObject
  });
}

    console.log('✅ Query executed successfully. Results count:', results.length);

    // Step 6.5: Track query for suggestions before responding
    const trackedQuery = await AIQuery.trackQuery(userQuery, instituteId);
    if (!trackedQuery) {
      console.warn('Failed to persist tracked query for /query:', userQuery);
    }

    // Step 7: Return results
    res.json({
      success: true,
      results,
      chartType: chartType || 'none',
      chartConfig: chartConfig || null,
      metadata: {
        count: results.length,
        collection,
        operation
      }
    });

  } catch (error) {
    console.error('❌ AI Query Error:', error);
    res.status(error.status >= 400 && error.status < 600 ? 502 : 500).json({
      error: error.message || 'Failed to process query',
      code: error.code || 'AI_QUERY_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
function convertObjectIds(obj) {
  // string ObjectId
  if (typeof obj === "string" && /^[0-9a-fA-F]{24}$/.test(obj)) {
    return new mongoose.Types.ObjectId(obj);
  }

  // array
  if (Array.isArray(obj)) {
    return obj.map(convertObjectIds);
  }

  // object
  if (obj && typeof obj === "object") {
    const converted = {};
    for (const key in obj) {
      converted[key] = convertObjectIds(obj[key]);
    }
    return converted;
  }

  return obj;
}
async function resolveInstituteId(userQuery, instituteId) {
  // If instituteId already provided, use it
  if (instituteId) return instituteId;

  // Try extracting institute name from query
  const words = userQuery.toLowerCase();

  const Institute = mongoose.connection.collection("institutes");

  const institute = await Institute.findOne({
    Institute_Name: { $regex: words, $options: "i" }
  });

  return institute ? institute._id : null;
}

router.post(
  "/institute-query",
  expressAsyncHandler(async (req, res) => {
    const { userQuery, instituteId: bodyInstituteId } = req.body;

    if (!userQuery) {
      return res.status(400).json({ error: "Query is required" });
    }

    console.log("📝 User Query:", userQuery);

    // ✅ Resolve institute ID (BY NAME OR ID)
    const instituteId = await resolveInstituteId(
      userQuery,
      bodyInstituteId
    );

    if (!instituteId) {
      return res.status(404).json({
        error: "Institute not found",
        message: "Could not identify institute from query"
      });
    }

    console.log("🏥 Resolved Institute ID:", instituteId.toString());

    /* ---------------- PROMPT ---------------- */
    const prompt = `
You are a MongoDB query generator.

Schemas:
${JSON.stringify(schemaDefinitions, null, 2)}

IMPORTANT INSTITUTE RULES:

1. Institute PROFILE queries (details, address, contact, info):
   - collection: "Institute"
   - operation: "find"
   - project institute fields only

2. Institute MEDICINE queries:
   - collection: "Institute"
   - operation: "aggregate"
   - ALWAYS unwind Medicine_Inventory
   - ALWAYS $lookup from "medicines"
   - NEVER return Medicine_ID
   - project Medicine_Name and Quantity

User Query:
"${userQuery}"

InstituteId:
"${instituteId}"

Return ONLY JSON in this format:
{
  "collection": "CollectionName",
  "operation": "find" | "aggregate",
  "query": {} | [],
  "projection": {},
  "chartType": "bar|line|pie|none",
  "chartConfig": {
    "xField": "",
    "yField": "",
    "title": ""
  }
}
`;

    /* ---------------- AI CALL ---------------- */
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }]
    });

    let aiResponse = completion.choices[0].message.content;

    /* ---------------- CLEAN RESPONSE ---------------- */
    aiResponse = aiResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .replace(/^[^{]*/g, "")
      .replace(/[^}]*$/g, "")
      .replace(/ObjectId\("([^"]+)"\)/g, '"$1"')
      .replace(/new Date\(\)/g, '"$$NOW"')
      .trim();

    let mongoQuery;
    try {
      mongoQuery = JSON.parse(aiResponse);
    } catch {
      return res.status(500).json({
        error: "AI returned invalid JSON",
        raw: aiResponse
      });
    }

    validateQuery(mongoQuery);

    const { collection, operation, query, projection } = mongoQuery;
    const Collection = mongoose.connection.collection(
      collection.toLowerCase() + "s"
    );

    let results = [];

    /* =====================================================
       ✅ CASE 1: INSTITUTE PROFILE / DETAILS
    ===================================================== */
    if (collection === "Institute" && operation === "find") {
      results = await Collection.find(
        { _id: new mongoose.Types.ObjectId(instituteId) },
        {
          projection: {
            _id: 0,
            Institute_ID: 1,
            Institute_Name: 1,
            Address: 1,
            Email_ID: 1,
            Contact_No: 1
          }
        }
      ).toArray();

      return res.json({
        success: true,
        results,
        chartType: "none",
        chartConfig: null,
        metadata: {
          count: results.length,
          collection: "Institute"
        }
      });
    }

    /* =====================================================
       ✅ CASE 2: INSTITUTE MEDICINE / INVENTORY
    ===================================================== */
   if (collection === "Institute" && operation === "find") {

  const isAllInstitutesQuery =
    /all institutes|list institutes|show institutes/i.test(userQuery);

  const filter = isAllInstitutesQuery
    ? {} // ✅ NO FILTER → returns all institutes
    : { _id: new mongoose.Types.ObjectId(instituteId) };

  results = await Collection.find(filter, {
    projection: {
      _id: 0,
      Institute_ID: 1,
      Institute_Name: 1,
      Address: 1,
      Email_ID: 1,
      Contact_No: 1
    }
  }).toArray();

  return res.json({
    success: true,
    results,
    chartType: "none",
    chartConfig: null,
    metadata: {
      count: results.length,
      collection: "Institute"
    }
  });
}

    /* =====================================================
       ✅ CASE 3: ALL OTHER COLLECTIONS
    ===================================================== */
    else {
      const safeQuery = convertObjectIds(query);
      if (operation === "aggregate") {
        results = await Collection.aggregate(safeQuery).toArray();
      } else {
        results = await Collection.find(safeQuery, { projection }).toArray();
      }
    }

    /* ---------------- FINAL RESPONSE ---------------- */
    
    // Track query for suggestions before responding
    const trackedQuery = await AIQuery.trackQuery(userQuery, instituteId);
    if (!trackedQuery) {
      console.warn('Failed to persist tracked query for /institute-query:', userQuery);
    }
    
    res.json({
      success: true,
      results,
      chartType: mongoQuery.chartType || "none",
      chartConfig: mongoQuery.chartConfig || null,
      metadata: {
        count: results.length,
        collection
      }
    });
  })
);



/* -------------------------------------------------------
   HEALTH CHECK
------------------------------------------------------- */
router.get("/health", (req, res) => {
  res.json({ status: "AI Query API with Institute support running" });
});

module.exports = router;
