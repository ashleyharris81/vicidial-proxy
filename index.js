const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const VICIDIAL_BASE_URL = "http://migroup.jibbadialler.com/vicidial";

function parseLeadId(responseText) {
  const match = responseText.match(/newlead\s+(\d+)/i);
  return match ? match[1] : null;
}

app.post("/push-leads", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { leads, list_id, campaign_id } = req.body;
  if (!leads || !Array.isArray(leads) || !list_id) return res.status(400).json({ error: "Missing required fields: leads, list_id" });

  const results = [];
  for (const lead of leads) {
    try {
      const params = new URLSearchParams({
        source: "test", user: apiUser, pass: apiPass, function: "add_lead",
        phone_number: lead.phone_number, phone_code: lead.phone_code || "1",
        first_name: lead.first_name, last_name: lead.last_name,
        email: lead.email || "", country_code: lead.country || "",
        list_id: list_id, vendor_lead_code: lead.lead_ref,
      });
      if (campaign_id) params.set("campaign_id", campaign_id);

      const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
      const response = await fetch(url);
      const text = await response.text();
      const vicidialLeadId = parseLeadId(text);
      results.push({ lead_ref: lead.lead_ref, success: text.includes("SUCCESS"), vicidial_lead_id: vicidialLeadId, response: text });
    } catch (err) {
      results.push({ lead_ref: lead.lead_ref, success: false, error: err.message || "Unknown error" });
    }
  }
  return res.json({ results });
});

app.get("/campaigns", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  try {
    const params = new URLSearchParams({ source: "test", user: apiUser, pass: apiPass, function: "campaigns_list", header: "YES" });
    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();

    const campaigns = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && trimmed.includes(" - ")) {
        const dashIndex = trimmed.indexOf(" - ");
        const id = trimmed.substring(0, dashIndex).trim();
        const name = trimmed.substring(dashIndex + 3).trim();
        if (id && name && !id.includes("ERROR") && !id.includes("SUCCESS") && !id.includes("NOTICE")) {
          campaigns.push({ campaign_id: id, campaign_name: name });
        }
      }
    }
    campaigns.sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));
    return res.json({ campaigns, raw: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.get("/agents", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  const { campaign_id } = req.query;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  try {
    const params = new URLSearchParams({
      source: "test", user: apiUser, pass: apiPass,
      function: "agent_stats_export", header: "YES", time_format: "H", group: "ALL",
    });
    if (campaign_id) params.set("campaign_id", campaign_id);

    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();

    const agents = [];
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length > 1) {
      const headers = lines[0].split("|").map((h) => h.trim().toLowerCase());
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split("|").map((v) => v.trim());
        if (values.length >= headers.length) {
          const agent = {};
          headers.forEach((h, idx) => { agent[h] = values[idx]; });
          agents.push(agent);
        }
      }
    }
    return res.json({ agents, raw: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/purge-hopper", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { campaign_id } = req.body;
  if (!campaign_id) return res.status(400).json({ error: "Missing required field: campaign_id" });

  try {
    const params = new URLSearchParams({
      source: "test", user: apiUser, pass: apiPass,
      function: "reset_hopper", campaign_id,
    });
    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    const success = text.includes("SUCCESS") || text.includes("hopper");
    return res.status(success ? 200 : 502).json({ success, campaign_id, response: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.get("/users", async (req, res) => {
  const adminUser = process.env.VICIDIAL_ADMIN_USER || process.env.VICIDIAL_API_USER;
  const adminPass = process.env.VICIDIAL_ADMIN_PASS || process.env.VICIDIAL_API_PASS;
  if (!adminUser || !adminPass) return res.status(500).json({ error: "Admin credentials not configured" });

  try {
    const loginUrl = `http://migroup.jibbadialler.com/vicidial/admin.php`;
    const loginRes = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `PHP_AUTH_USER=${encodeURIComponent(adminUser)}&PHP_AUTH_PW=${encodeURIComponent(adminPass)}`,
      redirect: "manual",
    });
    const cookies = loginRes.headers.raw()["set-cookie"] || [];
    const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

    const listUrl = `http://migroup.jibbadialler.com/vicidial/admin.php?ADD=100`;
    const listRes = await fetch(listUrl, { headers: { Cookie: cookieString } });
    const html = await listRes.text();

    const users = [];
    const regex = /admin\.php\?ADD=3&user=([^"&]+)[^>]*>([^<]*)/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      users.push({ user: m[1], full_name: m[2].trim() });
    }
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// --- admin UI helpers (campaign copy is not available in non_agent_api) ---
function adminCreds() {
  const adminUser = process.env.VICIDIAL_ADMIN_USER || process.env.VICIDIAL_API_USER;
  const adminPass = process.env.VICIDIAL_ADMIN_PASS || process.env.VICIDIAL_API_PASS;
  if (!adminUser || !adminPass) throw new Error("Admin credentials not configured");
  return { adminUser, adminPass };
}

function badLogin(html) {
  return /Login incorrect|LOGIN INCORRECT|BAD\|/i.test(html || "");
}

// Tries several auth strategies against the admin UI and returns a working fetcher
async function adminSession() {
  const { adminUser, adminPass } = adminCreds();
  const basic = "Basic " + Buffer.from(`${adminUser}:${adminPass}`).toString("base64");
  const attempts = [];

  // 1) HTTP Basic auth
  {
    const r = await fetch(`${VICIDIAL_BASE_URL}/admin.php`, { headers: { Authorization: basic } });
    const html = await r.text();
    attempts.push({ mode: "basic", status: r.status, bad: badLogin(html) });
    if (r.ok && !badLogin(html)) {
      return {
        mode: "basic",
        attempts,
        fetch: (url, opts = {}) =>
          fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: basic } }),
      };
    }
  }

  // 2) POST login form -> session cookie
  {
    const r = await fetch(`${VICIDIAL_BASE_URL}/admin.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `PHP_AUTH_USER=${encodeURIComponent(adminUser)}&PHP_AUTH_PW=${encodeURIComponent(adminPass)}`,
      redirect: "manual",
    });
    const html = await r.text();
    const cookies = r.headers.raw()["set-cookie"] || [];
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    attempts.push({ mode: "cookie", status: r.status, bad: badLogin(html), cookie: !!cookie });
    if (cookie && !badLogin(html)) {
      return {
        mode: "cookie",
        attempts,
        fetch: (url, opts = {}) =>
          fetch(url, { ...opts, headers: { ...(opts.headers || {}), Cookie: cookie } }),
      };
    }
  }

  // 3) credentials appended to every request (query string / form body)
  {
    const authQs = `PHP_AUTH_USER=${encodeURIComponent(adminUser)}&PHP_AUTH_PW=${encodeURIComponent(adminPass)}`;
    const r = await fetch(`${VICIDIAL_BASE_URL}/admin.php?${authQs}`);
    const html = await r.text();
    attempts.push({ mode: "query", status: r.status, bad: badLogin(html) });
    if (r.ok && !badLogin(html)) {
      return {
        mode: "query",
        attempts,
        fetch: (url, opts = {}) => {
          if ((opts.method || "GET").toUpperCase() === "POST") {
            return fetch(url, { ...opts, body: `${opts.body}&${authQs}` });
          }
          return fetch(url + (url.includes("?") ? "&" : "?") + authQs, opts);
        },
      };
    }
  }

  const err = new Error("Admin login failed");
  err.attempts = attempts;
  throw err;
}

// Diagnostic: which admin auth mode works
app.get("/admin-check", async (req, res) => {
  try {
    const s = await adminSession();
    return res.json({ ok: true, mode: s.mode, attempts: s.attempts });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err.message,
      attempts: err.attempts || null,
      has_admin_user: !!process.env.VICIDIAL_ADMIN_USER,
      has_admin_pass: !!process.env.VICIDIAL_ADMIN_PASS,
      has_api_user: !!process.env.VICIDIAL_API_USER,
    });
  }
});


function parseFormFields(html) {
  const fields = {};
  const inputRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[0];
    const type = (tag.match(/type\s*=\s*["']?([\w-]+)/i) || [, "text"])[1].toLowerCase();
    const name = (tag.match(/name\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!name || type === "submit" || type === "button" || type === "reset") continue;
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [, ""])[1];
    if ((type === "checkbox" || type === "radio") && !/checked/i.test(tag)) continue;
    fields[name] = value;
  }
  const selectRe = /<select\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
  while ((m = selectRe.exec(html)) !== null) {
    const name = m[1];
    const body = m[2];
    const sel = body.match(/<option[^>]*selected[^>]*value\s*=\s*["']?([^"'>\s]*)/i)
      || body.match(/<option[^>]*value\s*=\s*["']?([^"'>\s]*)/i);
    fields[name] = sel ? sel[1] : "";
  }
  return fields;
}

// POST /copy-campaign { source_campaign_id, new_campaign_id, new_campaign_name }
app.post("/copy-campaign", async (req, res) => {
  const { source_campaign_id, new_campaign_id, new_campaign_name } = req.body || {};
  if (!source_campaign_id || !new_campaign_id || !new_campaign_name) {
    return res.status(400).json({ error: "source_campaign_id, new_campaign_id and new_campaign_name are required" });
  }
  if (String(new_campaign_id).length > 8) {
    return res.status(400).json({ error: "new_campaign_id must be 8 characters or fewer" });
  }

  try {
    const session = await adminSession();

    // Load the Vicidial "copy campaign" form for the source campaign
    const formUrl = `${VICIDIAL_BASE_URL}/admin.php?ADD=311&campaign_id=${encodeURIComponent(source_campaign_id)}`;
    const formRes = await session.fetch(formUrl);
    const formHtml = await formRes.text();

    const fields = parseFormFields(formHtml);
    // Override the identifying fields with the new campaign
    fields.ADD = fields.ADD && /^31\d$/.test(fields.ADD) ? fields.ADD : "312";
    fields.campaign_id = new_campaign_id;
    fields.campaign_name = new_campaign_name;
    if ("new_campaign_id" in fields) fields.new_campaign_id = new_campaign_id;
    if ("new_campaign_name" in fields) fields.new_campaign_name = new_campaign_name;
    if ("copy_campaign_id" in fields) fields.copy_campaign_id = source_campaign_id;
    if ("old_campaign_id" in fields) fields.old_campaign_id = source_campaign_id;
    // never copy the source lists/leads across
    for (const k of Object.keys(fields)) {
      if (/copy_lists|copy_leads|copy_hopper/i.test(k)) fields[k] = "0";
    }

    const body = new URLSearchParams(fields).toString();
    const postRes = await session.fetch(`${VICIDIAL_BASE_URL}/admin.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const postHtml = await postRes.text();



    // Verify via the API campaign list
    const apiUser = process.env.VICIDIAL_API_USER;
    const apiPass = process.env.VICIDIAL_API_PASS;
    const verifyParams = new URLSearchParams({
      source: "crm", user: apiUser, pass: apiPass, function: "campaigns_list", header: "YES",
    });
    const verifyRes = await fetch(`${VICIDIAL_BASE_URL}/non_agent_api.php?${verifyParams.toString()}`);
    const verifyText = await verifyRes.text();
    const exists = new RegExp(`(^|\\n)\\s*${new_campaign_id}\\s+-`, "i").test(verifyText)
      || verifyText.includes(`${new_campaign_id} - `);

    return res.status(exists ? 200 : 502).json({
      success: exists,
      campaign_id: new_campaign_id,
      form_fields: Object.keys(fields),
      snippet: postHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 800),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// GET /copy-campaign-debug?source_campaign_id=Spainn
// Returns Vicidial's copy-campaign form HTML + parsed fields so we can inspect exact field names.
app.get("/copy-campaign-debug", async (req, res) => {
  const { source_campaign_id } = req.query;
  if (!source_campaign_id) return res.status(400).json({ error: "source_campaign_id query param is required" });
  try {
    const session = await adminSession();
    const formUrl = `${VICIDIAL_BASE_URL}/admin.php?ADD=311&campaign_id=${encodeURIComponent(source_campaign_id)}`;
    const formRes = await session.fetch(formUrl);
    const formHtml = await formRes.text();
    return res.json({
      source_campaign_id,
      formUrl,
      parsed_fields: parseFormFields(formHtml),
      raw_html: formHtml,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/create-list", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { list_id, list_name, campaign_id } = req.body;
  if (!list_id || !list_name || !campaign_id) return res.status(400).json({ error: "Missing required fields: list_id, list_name, campaign_id" });

  try {
    const params = new URLSearchParams({
      source: "test", user: apiUser, pass: apiPass, function: "add_list",
      list_id, list_name, campaign_id, active: "Y",
    });
    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    return res.json({ success: text.includes("SUCCESS"), response: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/update-lead", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { vendor_lead_code, phone_number, first_name = "", last_name = "", email = "", lead_id } = req.body || {};
  if (!lead_id && !vendor_lead_code) return res.status(400).json({ error: "vendor_lead_code or lead_id is required" });

  try {
    const params = new URLSearchParams({
      source: "test", user: apiUser, pass: apiPass, function: "update_lead",
      first_name: String(first_name), last_name: String(last_name), email: String(email),
      search_method: lead_id ? "LEAD_ID" : "VENDOR_LEAD_CODE",
    });
    if (lead_id) {
      params.set("lead_id", String(lead_id));
    } else {
      params.set("vendor_lead_code", String(vendor_lead_code));
      if (phone_number) params.set("phone_number", String(phone_number).replace(/[^0-9]/g, ""));
    }

    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    const success = text.includes("SUCCESS");
    return res.status(success ? 200 : 502).json({ success, response: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/delete-lead", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { lead_id, vendor_lead_code } = req.body || {};
  if (!lead_id && !vendor_lead_code) {
    return res.status(400).json({ error: "lead_id or vendor_lead_code is required" });
  }

  try {
    const params = new URLSearchParams({
      source: "crm", user: apiUser, pass: apiPass, function: "update_lead",
      search_method: lead_id ? "LEAD_ID" : "VENDOR_LEAD_CODE",
      delete_lead: "Y", custom_fields: "Y", records: "1",
    });
    if (lead_id) params.set("lead_id", String(lead_id));
    if (vendor_lead_code) params.set("vendor_lead_code", String(vendor_lead_code));

    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    const success = text.includes("SUCCESS");
    const notFound = /NO MATCH|NOT FOUND/i.test(text);
    return res.status(success || notFound ? 200 : 502).json({ success, not_found: notFound, response: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/add-dnc", async (req, res) => {
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  if (!apiUser || !apiPass) return res.status(500).json({ error: "Vicidial credentials not configured" });

  const { phone_number, campaign_id } = req.body || {};
  if (!phone_number) return res.status(400).json({ error: "phone_number is required" });

  try {
    const params = new URLSearchParams({
      source: "crm", user: apiUser, pass: apiPass,
      function: "add_lead_to_dnc",
      phone_number: String(phone_number).replace(/[^0-9]/g, ""),
      dnc_type: campaign_id ? "CAMPAIGN" : "SYSTEM",
    });
    if (campaign_id) params.set("campaign_id", campaign_id);

    const url = `${VICIDIAL_BASE_URL}/non_agent_api.php?${params.toString()}`;
    const response = await fetch(url);
    const text = await response.text();
    const success = text.includes("SUCCESS") || /ALREADY/i.test(text);
    return res.status(success ? 200 : 502).json({ success, response: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Vicidial proxy running on port ${PORT}`);
});
