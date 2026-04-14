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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Vicidial proxy running on port ${PORT}`);
});
