const express = require("express");
const fetch = require("node-fetch");
const app = express();

const VICIDIAL_BASE_URL = "http://migroup.jibbadialler.com/vicidial";
const API_USER = process.env.VICIDIAL_API_USER;
const API_PASS = process.env.VICIDIAL_API_PASS;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Push leads
app.post("/push-leads", async (req, res) => {
  const { leads, list_id, campaign_id } = req.body;
  if (!leads || !list_id) return res.status(400).json({ error: "Missing leads or list_id" });

  const results = [];
  for (const lead of leads) {
    try {
      const params = new URLSearchParams({
        source: "test", user: API_USER, pass: API_PASS,
        function: "add_lead",
        phone_number: lead.phone_number,
        phone_code: lead.phone_code || "1",
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email || "",
        country_code: lead.country || "",
        list_id, vendor_lead_code: lead.lead_ref,
      });
      if (campaign_id) params.set("campaign_id", campaign_id);

      const r = await fetch(`${VICIDIAL_BASE_URL}/non_agent_api.php?${params}`);
      const text = await r.text();
      results.push({ lead_ref: lead.lead_ref, success: r.ok, response: text });
    } catch (err) {
      results.push({ lead_ref: lead.lead_ref, success: false, error: err.message });
    }
  }
  res.json({ results });
});

// Get campaigns & lists
app.get("/campaigns", async (req, res) => {
  try {
    const cParams = new URLSearchParams({ source: "test", user: API_USER, pass: API_PASS, function: "campaigns_list" });
    const cRes = await fetch(`${VICIDIAL_BASE_URL}/non_agent_api.php?${cParams}`);
    const cText = await cRes.text();

    const lParams = new URLSearchParams({ source: "test", user: API_USER, pass: API_PASS, function: "lists_list" });
    const lRes = await fetch(`${VICIDIAL_BASE_URL}/non_agent_api.php?${lParams}`);
    const lText = await lRes.text();

    res.json({ campaigns: parseLines(cText), lists: parseLines(lText), raw: { campaigns: cText, lists: lText } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get agents
app.get("/agents", async (req, res) => {
  try {
    const params = new URLSearchParams({
      source: "test",
      user: API_USER,
      pass: API_PASS,
      function: "agent_stats_export",
      datetime_start: "2025-01-01+00:00:00",
      datetime_end: new Date().toISOString().slice(0, 10) + "+23:59:59",
      header: "YES",
    });
    const r = await fetch(`${VICIDIAL_BASE_URL}/non_agent_api.php?${params}`);
    const text = await r.text();
    res.json({ agents: parseAgents(text), raw: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseLines(text) {
  return text.split("\n").filter(l => l.trim() && !l.startsWith("SUCCESS") && !l.startsWith("ERROR") && !l.startsWith("NOTICE"))
    .map(line => {
      const m = line.match(/^([^\s-]+)\s*-\s*(.+)$/);
      if (m) return { id: m[1].trim(), name: m[2].trim() };
      const p = line.split("|").map(s => s.trim()).filter(Boolean);
      if (p.length >= 2) return { id: p[0], name: p[1] };
      return { id: line.trim(), name: line.trim() };
    });
}

function parseAgents(text) {
  const agents = [];
  const seen = new Set();
  const lines = text.split("\n").filter(l => l.trim());
  for (const line of lines) {
    if (line.startsWith("SUCCESS") || line.startsWith("ERROR") || line.startsWith("NOTICE") || line.startsWith("user")) continue;
    const parts = line.split("|").map(s => s.trim());
    if (parts.length >= 2 && !seen.has(parts[0])) {
      seen.add(parts[0]);
      agents.push({ user: parts[0], name: parts[1] });
    }
  }
  return agents;
}

app.listen(process.env.PORT || 3000, () => console.log("Proxy running"));
