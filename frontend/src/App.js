import { useState, useEffect, useRef } from "react";
import "./App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STEP_LABELS = [
  "Company analysis",
  "Competitor identification",
  "Positioning comparison",
  "Gap identification",
  "Strategy engine",
  "Target account generation"
];

function App() {
  const [screen, setScreen] = useState("home"); // home | loading | results
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollingRef = useRef(null);

  // Start analysis
  const startAnalysis = async () => {
    if (!url.trim()) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await axios.post(`${API}/analyse`, { url });
      const { job_id } = response.data;
      
      setJobId(job_id);
      setScreen("loading");
      setCurrentStep(0);
      
      // Start polling
      startPolling(job_id);
      
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to start analysis");
      setIsSubmitting(false);
    }
  };

  // Poll for job status
  const startPolling = (jobId) => {
    pollingRef.current = setInterval(async () => {
      try {
        const response = await axios.get(`${API}/analyse/${jobId}`);
        const data = response.data;
        
        if (data.status === "running") {
          setCurrentStep(data.current_step || 0);
        } else if (data.status === "complete") {
          setResult(data.result);
          setScreen("results");
          stopPolling();
        } else if (data.status === "failed") {
          setError(data.error || "Analysis failed");
          setScreen("home");
          stopPolling();
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000); // Poll every 2 seconds
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const resetApp = () => {
    stopPolling();
    setScreen("home");
    setUrl("");
    setJobId(null);
    setCurrentStep(0);
    setResult(null);
    setError(null);
    setActiveTab("overview");
    setIsSubmitting(false);
  };

  return (
    <div className="app">
      <div className="wordmark">
        RivalIQ <span className="wordmark-accent">GTM Engine</span>
      </div>

      {/* HOME SCREEN */}
      {screen === "home" && (
        <div className="screen active">
          <div className="hero">
            <p className="label" style={{ marginBottom: "12px" }}>
              Competitive Intelligence
            </p>
            <h1 className="hero-headline">
              Know exactly where to
              <br />
              compete — and what to do next.
            </h1>
            <p className="hero-sub">
              Paste your company URL. Get a complete competitive GTM strategy:
              positioning gaps, strategic decision, and 5 target accounts with
              execution plans.
            </p>
            <div className="input-group">
              <div className="input-label">Company URL</div>
              <div className="url-row">
                <input
                  className="url-input"
                  type="text"
                  placeholder="https://yourcompany.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && startAnalysis()}
                  disabled={isSubmitting}
                />
                <button 
                  className="btn-primary" 
                  onClick={startAnalysis}
                  disabled={isSubmitting || !url.trim()}
                >
                  {isSubmitting ? "Starting..." : "Analyse →"}
                </button>
              </div>
            </div>
            {error && (
              <div className="error-message">
                Error: {error}
              </div>
            )}
            <div className="stat-row">
              <div className="stat-item">
                <div className="stat-num">06</div>
                <div className="stat-desc">Pipeline steps</div>
              </div>
              <div className="stat-item">
                <div className="stat-num">&lt;2m</div>
                <div className="stat-desc">To full strategy</div>
              </div>
              <div className="stat-item">
                <div className="stat-num">05</div>
                <div className="stat-desc">Target accounts</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOADING SCREEN */}
      {screen === "loading" && (
        <div className="screen active">
          <div className="loading-wrap">
            <div className="label" style={{ marginBottom: "8px" }}>
              Analysing
            </div>
            <div className="loading-url">{url}</div>
            <div className="pipeline">
              {STEP_LABELS.map((label, idx) => {
                const stepNum = idx + 1;
                const isActive = currentStep === stepNum;
                const isDone = currentStep > stepNum;

                return (
                  <div className="pipe-step" key={idx}>
                    <span
                      className={`step-idx ${isActive ? "active" : ""} ${
                        isDone ? "done" : ""
                      }`}
                    >
                      {isDone ? "✓" : `0${stepNum}`}
                    </span>
                    <span
                      className={`step-name ${isActive ? "active" : ""} ${
                        isDone ? "done" : ""
                      }`}
                    >
                      {label}
                    </span>
                    <span
                      className={`step-dot ${isActive ? "active" : ""} ${
                        isDone ? "done" : ""
                      }`}
                    ></span>
                  </div>
                );
              })}
            </div>
            <div className="loading-status">
              {currentStep > 0
                ? `Processing: ${STEP_LABELS[currentStep - 1]}...`
                : "Scanning website content..."}
            </div>
          </div>
        </div>
      )}

      {/* RESULTS SCREEN */}
      {screen === "results" && result && (
        <div className="screen active">
          <div className="results-bar">
            <div>
              <div className="company-name">
                {result.company_profile?.company_name || "Company"}
              </div>
              <div className="company-sub">
                {result.url} · {result.company_profile?.industry || "N/A"} ·{" "}
                {result.company_profile?.target_customer || "N/A"}
              </div>
            </div>
            <button className="btn-ghost" onClick={resetApp}>
              ↩ New analysis
            </button>
          </div>

          <div className="tabs">
            <button
              className={`tab ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab ${activeTab === "competitors" ? "active" : ""}`}
              onClick={() => setActiveTab("competitors")}
            >
              Competitors
            </button>
            <button
              className={`tab ${activeTab === "strategy" ? "active" : ""}`}
              onClick={() => setActiveTab("strategy")}
            >
              Strategy
            </button>
            <button
              className={`tab ${activeTab === "accounts" ? "active" : ""}`}
              onClick={() => setActiveTab("accounts")}
            >
              Accounts
            </button>
          </div>

          {/* TAB: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="tab-panel active">
              <OverviewTab result={result} />
            </div>
          )}

          {/* TAB: COMPETITORS */}
          {activeTab === "competitors" && (
            <div className="tab-panel active">
              <CompetitorsTab result={result} />
            </div>
          )}

          {/* TAB: STRATEGY */}
          {activeTab === "strategy" && (
            <div className="tab-panel active">
              <StrategyTab result={result} />
            </div>
          )}

          {/* TAB: ACCOUNTS */}
          {activeTab === "accounts" && (
            <div className="tab-panel active">
              <AccountsTab result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB COMPONENTS
// ═══════════════════════════════════════════════════════════════

function OverviewTab({ result }) {
  const profile = result.company_profile || {};
  const gaps = result.gaps || {};
  const strategy = result.strategy || {};

  return (
    <>
      <div className="section">
        <div className="label" style={{ marginBottom: "12px" }}>
          Company snapshot
        </div>
        <div className="snap-grid">
          <div className="snap-cell">
            <div className="snap-label">Product</div>
            <div className="snap-value">{profile.product || "—"}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-label">Target customer</div>
            <div className="snap-value">{profile.target_customer || "—"}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-label">Pricing model</div>
            <div className="snap-value">{profile.pricing_model || "—"}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-label">Positioning</div>
            <div className="snap-value">{profile.positioning || "—"}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-label">Industry</div>
            <div className="snap-value">{profile.industry || "—"}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-label">Geography</div>
            <div className="snap-value">Global</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="label" style={{ marginBottom: "12px" }}>
          Strategic gaps
        </div>
        <div className="gap-row">
          <div className="gap-card">
            <div className="gap-type-label gt-weak">Weaknesses</div>
            <ul className="gap-list">
              {gaps.weaknesses?.map((w, i) => (
                <li key={i} className="gt-weak-li">
                  {w.area}
                </li>
              ))}
            </ul>
          </div>
          <div className="gap-card">
            <div className="gap-type-label gt-crowd">Overcrowded</div>
            <ul className="gap-list">
              {gaps.overcrowded_areas?.map((c, i) => (
                <li key={i} className="gt-crowd-li">
                  {c.area}
                </li>
              ))}
            </ul>
          </div>
          <div className="gap-card">
            <div className="gap-type-label gt-opp">Opportunity</div>
            <ul className="gap-list">
              {gaps.underserved_opportunities?.map((o, i) => (
                <li key={i} className="gt-opp-li">
                  {o.opportunity}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="label" style={{ marginBottom: "12px" }}>
          Recommended strategy
        </div>
        <div className="strategy-block">
          <div className="strategy-stamp">Decision · GTM Engine v1</div>
          <div className="strategy-row">
            <div className="strat-key">Where to play</div>
            <div>
              <div className="strat-value">
                {strategy.where_to_play?.segment || "—"},{" "}
                {strategy.where_to_play?.geography || "—"}
              </div>
              <div className="strat-why">
                {strategy.where_to_play?.why || "—"}
              </div>
            </div>
          </div>
          <div className="strategy-row">
            <div className="strat-key">How to win</div>
            <div>
              <div className="strat-value">
                {strategy.how_to_win?.differentiation || "—"}
              </div>
              <div className="strat-why">
                {strategy.how_to_win?.positioning_statement || "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CompetitorsTab({ result }) {
  const profile = result.company_profile || {};
  const competitors = result.competitors || [];
  const comparison = result.comparison || {};

  return (
    <>
      <div className="section">
        <div className="label" style={{ marginBottom: "12px" }}>
          Positioning comparison
        </div>
        <table className="comp-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>ICP</th>
              <th>Price / seat</th>
              <th>Core message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="you-row">
              <td>{(profile.company_name || "YOU").toUpperCase()} ↗</td>
              <td>{comparison.subject?.icp || "—"}</td>
              <td>{comparison.subject?.price_positioning || "—"}</td>
              <td>{comparison.subject?.core_message || "—"}</td>
              <td>
                <span className="comp-badge">You</span>
              </td>
            </tr>
            {competitors.map((c, i) => (
              <tr key={i}>
                <td className="comp-name-mono">{c.name}</td>
                <td>{c.target_segment}</td>
                <td>{c.price_range}</td>
                <td>{c.positioning}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="label" style={{ marginBottom: "12px" }}>
          Competitor profiles
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "2px",
            background: "var(--surface-container)",
          }}
        >
          {competitors.map((c, i) => (
            <div
              key={i}
              style={{
                background: "var(--surface-lowest)",
                padding: "18px 20px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "11px",
                  fontWeight: "500",
                  color: "var(--on-surface)",
                  marginBottom: "6px",
                }}
              >
                {c.name}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--on-surface-variant)",
                  lineHeight: "1.65",
                }}
              >
                {c.strengths}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function StrategyTab({ result }) {
  const strategy = result.strategy || {};

  return (
    <div className="section">
      <div className="label" style={{ marginBottom: "12px" }}>
        Full GTM strategy
      </div>
      <div className="strategy-block">
        <div className="strategy-stamp">
          Decision output · Confidence {strategy.confidence || 0}%
        </div>
        <div className="strategy-row">
          <div className="strat-key">Target segment</div>
          <div>
            <div className="strat-value">
              {strategy.where_to_play?.segment || "—"},{" "}
              {strategy.where_to_play?.geography || "—"}
            </div>
            <div className="strat-why">
              {strategy.where_to_play?.why || "—"}
            </div>
          </div>
        </div>
        <div className="strategy-row">
          <div className="strat-key">Target persona</div>
          <div>
            <div className="strat-value">
              {strategy.where_to_play?.persona || "—"}
            </div>
            <div className="strat-why">
              {strategy.how_to_win?.core_tactic || "—"}
            </div>
          </div>
        </div>
        <div className="strategy-row">
          <div className="strat-key">Differentiation</div>
          <div>
            <div className="strat-value">
              {strategy.how_to_win?.differentiation || "—"}
            </div>
            <div className="strat-why">
              {strategy.how_to_win?.positioning_statement || "—"}
            </div>
          </div>
        </div>
        <div className="strategy-row">
          <div className="strat-key">Pricing</div>
          <div>
            <div className="strat-value">
              {strategy.pricing_recommendation?.price_point || "—"} ·{" "}
              {strategy.pricing_recommendation?.model || "—"}
            </div>
            <div className="strat-why">
              {strategy.pricing_recommendation?.rationale || "—"}
            </div>
          </div>
        </div>
        <div className="strategy-row">
          <div className="strat-key">90-day actions</div>
          <div>
            {strategy.ninety_day_actions?.map((a, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: "10px",
                    color: "var(--primary)",
                    minWidth: "24px",
                  }}
                >
                  0{a.priority}
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--on-surface-variant)",
                  }}
                >
                  {a.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsTab({ result }) {
  const accounts = result.target_accounts || [];

  return (
    <div className="section">
      <div className="label" style={{ marginBottom: "12px" }}>
        Target accounts · {accounts.length} identified
      </div>
      <div className="account-list">
        {accounts.map((a, i) => (
          <div key={i} className="account-card">
            <div className="acc-top">
              <span className="acc-name">{a.company}</span>
              <span className="acc-arr">{a.deal_potential_arr}</span>
            </div>
            <div className="acc-why">{a.why_relevant}</div>
            <div className="acc-grid">
              <div className="acc-meta">
                <div className="acc-meta-key">Risk</div>
                <div className="acc-meta-val">{a.risk}</div>
              </div>
              <div className="acc-meta">
                <div className="acc-meta-key">Approach</div>
                <div className="acc-meta-val">{a.approach}</div>
              </div>
              <div className="acc-signal">
                <div className="acc-signal-key">Signal</div>
                <div className="acc-signal-val">{a.timing_signal}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
