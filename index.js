const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const VICIDIAL_BASE = "http://migroup.jibbadialler.com/vicidial/non_agent_api.php";
const API_USER = process.env.VICIDIAL_API_USER;
const API_PASS = process.env.VICIDIAL_API_PASS;

// Helper: build base params
function baseParams(extra = {}) {
  return new URLSearchParams({
    source: "test",
    user: API_USER,
    pass: API_PASS,
    ...extra,
  });
}

// Helper: parse "id - name" or pipe-delimited lines
function parseLines(text) {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => !l.startsWith("SUCCESS") && !l.startsWith("ERROR") && !l.startsWith("NOTICE"))
    .map((line) => {
      const dash = line.match(/^([^\s-]+)\s*-\s*(.+)$/);
      if (dash) return { id: dash[1].trim(), name: dash[2].trim() };
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return { id: parts[0], name: parts[1] };
      if (line.trim()) return { id: line.trim(), name: line.trim() };
      return null;
    })
    .filter(Boolean);
}

// ─── Health check ───────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "vicidial-proxy" });
});

// ─── GET /campaigns — fetch campaigns + lists ──────────────
app.get("/campaigns", async (req, res) => {
  try {
    const [campRes, listRes] = await Promise.all([
      fetch(`${VICIDIAL_BASE}?${baseParams({ function: "campaigns_list" })}`),
      fetch(`${VICIDIAL_BASE}?${baseParams({ function: "lists_list" })}`),
    ]);

    const [campText, listText] = await Promise.all([campRes.text(), listRes.text()]);

    res.json({
      campaigns: parseLines(campText),
      lists: parseLines(listText),
      raw: { campaigns: campText, lists: listText },
    });
  } catch (err) {
    console.error("GET /campaigns error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /create-list — create a new list in Vicidial ─────
app.post("/create-list", async (req, res) => {
  try {
    const { list_id, list_name, campaign_id, active } = req.body;

    if (!list_id || !list_name || !campaign_id) {
      return res.status(400).json({ error: "Missing list_id, list_name, or campaign_id" });
    }

    const params = baseParams({
      function: "add_list",
      list_id,
      list_name,
      campaign_id,
      active: active || "Y",
    });

    const response = await fetch(`${VICIDIAL_BASE}?${params}`);
    const text = await response.text();
    console.log("create-list response:", text);

    const success = text.includes("SUCCESS");
    res.json({ success, response: text });
  } catch (err) {
    console.error("POST /create-list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /push-leads — push leads to Vicidial ─────────────
app.post("/push-leads", async (req, res) => {
  try {
    const { leads, list_id, campaign_id } = req.body;

    if (!leads || !Array.isArray(leads) || !list_id) {
      return res.status(400).json({ error: "Missing leads array or list_id" });
    }

    const results = [];

    for (const lead of leads) {
      try {
        const params = baseParams({
          function: "add_lead",
          phone_number: lead.phone_number,
          phone_code: lead.phone_code || "1",
          first_name: lead.first_name,
          last_name: lead.last_name,
          email: lead.email || "",
          country_code: lead.country || "",
          list_id,
          vendor_lead_code: lead.lead_ref,
        });

        if (campaign_id) params.set("campaign_id", campaign_id);

        const response = await fetch(`${VICIDIAL_BASE}?${params}`);
        const text = await response.text();
        console.log(`Lead ${lead.lead_ref}: ${text}`);

        results.push({
          lead_ref: lead.lead_ref,
          success: response.ok && text.includes("SUCCESS"),
          response: text,
        });
      } catch (err) {
        console.error(`Lead ${lead.lead_ref} failed:`, err);
        results.push({
          lead_ref: lead.lead_ref,
          success: false,
          error: err.message,
        });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("POST /push-leads error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /list-info — get info about a specific list ────────
app.get("/list-info", async (req, res) => {
  try {
    const { list_id } = req.query;
    if (!list_id) return res.status(400).json({ error: "Missing list_id" });

    const params = baseParams({ function: "list_info", list_id });
    const response = await fetch(`${VICIDIAL_BASE}?${params}`);
    const text = await response.text();

    res.json({ list_id, response: text });
  } catch (err) {
    console.error("GET /list-info error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vicidial proxy running on port ${PORT}`));
