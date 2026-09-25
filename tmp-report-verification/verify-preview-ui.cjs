const puppeteer = require("../server/node_modules/puppeteer");

const APP_URL = "http://localhost:5174";

const checks = [
  {
    name: "diagnosis",
    path: "/employee/diagnosis-report",
    employeeId: "69d4931434daf9900a22d88a",
  },
  {
    name: "xray",
    path: "/employee/xray-report",
    employeeId: "69ad18e59ddb4c19fee910c5",
  },
];

const runCheck = async (browser, check) => {
  const page = await browser.newPage();

  await page.evaluateOnNewDocument((employeeId) => {
    localStorage.setItem("employeeObjectId", employeeId);
    localStorage.setItem("employeeId", employeeId);
    localStorage.setItem("employeeName", "Verification Employee");
    localStorage.setItem(`personFilter:${employeeId}`, "self");
  }, check.employeeId);

  await page.goto(`${APP_URL}${check.path}`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  await page.waitForSelector("button", { timeout: 30000 });
  const buttons = await page.$$("button");
  let clicked = false;

  for (const button of buttons) {
    const text = await page.evaluate((element) => element.textContent, button);
    if ((text || "").trim() === "View") {
      await button.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    await page.screenshot({
      path: `tmp-report-verification/${check.name}-no-view-button.png`,
      fullPage: true,
    });
    const bodyText = await page.evaluate(() => document.body.innerText);
    throw new Error(`${check.name} View button not found. Page text: ${bodyText.slice(0, 500)}`);
  }

  await page.waitForSelector("iframe", { timeout: 30000 });
  const iframe = await page.$("iframe");
  const srcDoc = await page.evaluate((element) => element.getAttribute("srcdoc") || "", iframe);
  const bad = /Cannot GET|recordId required|Unable to load/i.test(srcDoc);

  await page.screenshot({
    path: `tmp-report-verification/${check.name}-modal-preview.png`,
    fullPage: true,
  });

  await page.close();

  return {
    name: check.name,
    clicked,
    bad,
    htmlStart: srcDoc.slice(0, 100),
  };
};

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    const results = [];
    for (const check of checks) {
      results.push(await runCheck(browser, check));
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
