const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(express.json());

const VICIDIAL_BASE = "http://migroup.jibbadialler.com/vicidial";

// Health check
app.get("/", (req, res) => res.json({ status: "ok" }));

// Generic proxy — forwards query params to Vicidial non_agent_api
app.get("/api", async (req, res) => {
  try {
    const url = `${VICIDIAL_BASE}/non_agent_api.php?${new URLSearchParams(req.query)}`;
    console.log("Proxying GET:", url.replace(/pass=[^&]+/, "pass=***"));
    const r = await fetch(url);
    const text = await r.text();
    res.set("Content-Type", "text/plain").status(r.status).send(text);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST variant — accepts JSON body with params
app.post("/api", async (req, res) => {
  try {
    const params = new URLSearchParams(req.body);
    const url = `${VICIDIAL_BASE}/non_agent_api.php?${params}`;
    console.log("Proxying POST:", url.replace(/pass=[^&]+/, "pass=***"));
    const r = await fetch(url);
    const text = await r.text();
    res.set("Content-Type", "text/plain").status(r.status).send(text);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vicidial proxy running on port ${PORT}`));
