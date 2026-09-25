const puppeteer = require("../server/node_modules/puppeteer");

const FRONTEND = "http://localhost:5173";
const EMAIL = "bhavana@gmail.com";
const PASSWORD = "Bhavana@123";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clickButtonContaining = async (page, text) => page.evaluate((needle) => {
  const button = Array.from(document.querySelectorAll("button"))
    .find((node) => (node.innerText || "").includes(needle));
  if (!button) return false;
  button.click();
  return true;
}, text);
const selectAt = async (page, index, value) => page.$$eval("select", (items, selectedIndex, selectedValue) => {
  const item = items[selectedIndex];
  if (!item) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(item, selectedValue);
  item.dispatchEvent(new Event("input", { bubbles: true }));
  item.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}, index, value);

const dumpControls = async (page, label) => {
  const controls = await page.$$eval("select, input, textarea, button", (items) => items.map((item, index) => ({
    index,
    tag: item.tagName,
    type: item.type || "",
    name: item.name || "",
    placeholder: item.placeholder || "",
    value: item.value || "",
    text: (item.innerText || item.getAttribute("aria-label") || "").trim().slice(0, 100),
    options: item.tagName === "SELECT" ? Array.from(item.options).slice(0, 8).map((option) => option.text) : undefined,
  })));
  console.log(label, JSON.stringify(controls, null, 2));
};

const choosePatient = async (page) => {
  const selector = 'input[placeholder*="Search or select"]';
  await page.click(selector);
  await sleep(300);
  const option = await page.$("div.border.bg-white > div");
  if (!option) throw new Error("Patient queue had no selectable employee");
  const optionText = await option.evaluate((node) => node.innerText);
  await option.click();
  console.log("Selected patient:", optionText.trim());
};

const submitDiagnosis = async (page) => {
  await page.goto(`${FRONTEND}/institutions/diagnosis-entry`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[placeholder*="Search or select"]');
  await choosePatient(page);
  await sleep(500);
  if (!await clickButtonContaining(page, "Add Test")) throw new Error("Add Test button not found");
  await sleep(300);
  await dumpControls(page, "diagnosis controls");

  const selectIndexes = await page.$$eval("select", (items) => items.map((item, index) => ({
    index,
    value: item.value,
    options: Array.from(item.options).map((option) => ({ value: option.value, text: option.text })).filter((option) => option.value),
  })));
  const category = selectIndexes.find((item) => item.options.some((option) => /select category/i.test(option.text))) || selectIndexes[1];
  if (!category) throw new Error("Diagnosis category selector not found");
  await selectAt(page, category.index, category.options[0].value);
  await sleep(300);

  const afterCategory = await page.$$eval("select", (items) => items.map((item, index) => ({
    index,
    value: item.value,
    options: Array.from(item.options).map((option) => ({ value: option.value, text: option.text })).filter((option) => option.value),
  })));
  const testSelect = afterCategory.find((item) => item.index !== category.index && item.options.length > 0);
  if (!testSelect) throw new Error("Diagnosis test selector not found");
  await selectAt(page, testSelect.index, testSelect.options[0].value);
  await sleep(300);

  const resultInputs = await page.$$('input[placeholder="Result (e.g., 14.2)"]');
  if (!resultInputs.length) throw new Error("Diagnosis result input not found");
  for (let index = 0; index < resultInputs.length; index += 1) {
    await resultInputs[index].type(index === 0 ? "UI-HISTORY-DIAGNOSIS" : `UI-HISTORY-${index}`);
  }

  if (!await clickButtonContaining(page, "Save Diagnosis Record")) throw new Error("Diagnosis submit button not found");
  await sleep(3000);
  const body = await page.$eval("body", (node) => node.innerText);
  console.log("Diagnosis history state:", JSON.stringify({ heading: body.includes("Test History"), test: body.includes("MCH"), result: body.includes("UI-HISTORY-DIAGNOSIS") }));
  await page.screenshot({ path: "tmp-report-verification/ui-diagnosis-history.png", fullPage: true });
  return body.includes("Test History") && body.includes("MCH");
};

const submitXray = async (page) => {
  await page.goto(`${FRONTEND}/institutions/xray-entry`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[placeholder*="Search or select"]');
  await choosePatient(page);
  await sleep(500);
  await dumpControls(page, "xray controls");

  const selects = await page.$$("select");
  if (selects.length < 2) throw new Error("X-ray selectors not found");
  await selects[0].selectOption ? null : null;
  const optionData = await page.$$eval("select", (items) => items.map((item) => Array.from(item.options).map((option) => ({ value: option.value, text: option.text })).filter((option) => option.value)));
  const bodyPart = optionData.findIndex((options) => options.some((option) => /head|chest|upper|lower|body/i.test(option.text)));
  await selectAt(page, bodyPart, optionData[bodyPart][0].value);
  await sleep(300);
  const updated = await page.$$eval("select", (items) => items.map((item) => Array.from(item.options).map((option) => ({ value: option.value, text: option.text })).filter((option) => option.value)));
  const xrayIndex = updated.findIndex((options, index) => index !== bodyPart && options.length > 0);
  await selectAt(page, xrayIndex, updated[xrayIndex][0].value);
  const inputs = await page.$$("input");
  const textareas = await page.$$("textarea");
  const filmIndex = await page.$$eval("input", (items) => items.findIndex((item) => item.placeholder === "10X8"));
  if (filmIndex >= 0) await inputs[filmIndex].type("10X8");
  if (textareas.length) await textareas[0].type("UI-HISTORY-XRAY");
  if (!await clickButtonContaining(page, "Save X-ray Record") && !await clickButtonContaining(page, "Save X-ray")) throw new Error("X-ray submit button not found");
  await sleep(3000);
  const body = await page.$eval("body", (node) => node.innerText);
  console.log("X-ray history state:", JSON.stringify({ heading: body.includes("X-ray History"), report: body.includes("Abdomen X-ray") }));
  await page.screenshot({ path: "tmp-report-verification/ui-xray-history.png", fullPage: true });
  return body.includes("X-ray History") && body.includes("Abdomen X-ray");
};

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (message) => console.log("browser console:", message.text()));
  page.on("requestfailed", (request) => console.log("browser request failed:", request.url(), request.failure()?.errorText));
  page.on("dialog", async (dialog) => { console.log("browser dialog:", dialog.message()); await dialog.accept(); });
  await page.goto(`${FRONTEND}/institutes/login`, { waitUntil: "networkidle0" });
  await dumpControls(page, "login controls");
  await page.type('input[name="Email_ID"]', EMAIL);
  await page.type('input[name="password"]', PASSWORD);
  await page.select('select[name="role"]', "institute");
  await page.click('button[type="submit"]');
  await sleep(1400);
  console.log("After login:", page.url());
  console.log("Login body:", (await page.$eval("body", (node) => node.innerText)).slice(0, 1000));
  const diagnosis = await submitDiagnosis(page);
  const xray = await submitXray(page);
  console.log(JSON.stringify({ diagnosis, xray }));
  await browser.close();
  if (!diagnosis || !xray) process.exitCode = 2;
})().catch(async (error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
