import { useState, useEffect, useRef } from "react";
import "./App.css";
import axios from "axios";
import jsPDF from "jspdf";
import "jspdf-autotable";

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

// Helper function to format ARR values
const formatARR = (value) => {
  if (!value) return "—";
  
  // Extract numbers from string
  const numMatch = value.match(/[\d,]+/);
  if (!numMatch) return value;
  
  const num = parseInt(numMatch[0].replace(/,/g, ''));
  
  if (num >= 1000000) {
    return `$${(num / 1000000).toFixed(1)}M ARR`;
  } else if (num >= 1000) {
    return `$${(num / 1000).toFixed(0)}K ARR`;
  }
  
  return `$${num} ARR`;
};

function App() {
  const [screen, setScreen] = useState("home"); // home | loading | results
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [battlecardData, setBattlecardData] = useState(null);
  const [showBattlecard, setShowBattlecard] = useState(false);
  const [loadingBattlecard, setLoadingBattlecard] = useState(false);
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
      const errorDetail = err.response?.data?.detail || "";
      let userMessage = "Failed to start analysis";
      
      // Show user-friendly message for scraping errors
      if (errorDetail.includes("scrape_failed") || errorDetail.includes("Could not reach")) {
        userMessage = "We couldn't read this URL — it may require a login or block automated access. Try your main public-facing homepage (e.g. yourcompany.com, not app.yourcompany.com).";
      } else if (errorDetail.includes("invalid_url")) {
        userMessage = "Please enter a valid URL starting with http:// or https://";
      } else if (errorDetail) {
        userMessage = errorDetail;
      }
      
      setError(userMessage);
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
          const errorDetail = data.error || "Analysis failed";
          let userMessage = errorDetail;
          
          // Show user-friendly message for scraping errors
          if (errorDetail.includes("scrape_failed") || errorDetail.includes("Could not reach")) {
            userMessage = "We couldn't read this URL — it may require a login or block automated access. Try your main public-facing homepage (e.g. yourcompany.com, not app.yourcompany.com).";
          } else if (errorDetail.includes("openai")) {
            userMessage = "AI processing failed. Please try again.";
          }
          
          setError(userMessage);
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

  const exportToPDF = () => {
    if (!result) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let yPos = 20;

    // Helper to add new page if needed
    const checkPageBreak = (requiredSpace = 20) => {
      if (yPos + requiredSpace > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        yPos = 20;
        return true;
      }
      return false;
    };

    // Title
    doc.setFontSize(24);
    doc.setTextColor(87, 78, 177); // Primary color
    doc.text("RivalIQ Strategy Report", margin, yPos);
    yPos += 10;

    // Company name and date
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(result.company_profile?.company_name || "Company", margin, yPos);
    yPos += 6;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), margin, yPos);
    yPos += 15;

    // Company Snapshot
    checkPageBreak(40);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Company Snapshot", margin, yPos);
    yPos += 8;

    const cp = result.company_profile;
    const snapshotData = [
      ["Product", cp?.product || "—"],
      ["Target Customer", cp?.target_customer || "—"],
      ["Pricing Model", cp?.pricing_model || "—"],
      ["Positioning", cp?.positioning || "—"],
      ["Industry", cp?.industry || "—"]
    ];

    doc.autoTable({
      startY: yPos,
      head: [],
      body: snapshotData,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } }
    });
    yPos = doc.lastAutoTable.finalY + 12;

    // Strategic Gaps
    checkPageBreak(40);
    doc.setFontSize(14);
    doc.text("Strategic Gaps", margin, yPos);
    yPos += 8;

    if (result.gaps?.underserved_opportunities?.length > 0) {
      doc.setFontSize(11);
      doc.setTextColor(0, 110, 32);
      doc.text("Opportunities", margin, yPos);
      yPos += 6;
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      result.gaps.underserved_opportunities.forEach((opp, i) => {
        checkPageBreak(10);
        doc.text(`${i + 1}. ${opp.opportunity}`, margin + 3, yPos);
        yPos += 5;
      });
      yPos += 5;
    }

    // Competitors Table
    checkPageBreak(40);
    doc.setFontSize(14);
    doc.text("Competitors", margin, yPos);
    yPos += 8;

    const compData = result.competitors?.map(c => [
      c.name,
      c.target_segment,
      c.price_range,
      c.positioning
    ]) || [];

    doc.autoTable({
      startY: yPos,
      head: [['Company', 'Target Segment', 'Price Range', 'Positioning']],
      body: compData,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [87, 78, 177], textColor: 255 }
    });
    yPos = doc.lastAutoTable.finalY + 12;

    // Strategy
    doc.addPage();
    yPos = 20;
    doc.setFontSize(16);
    doc.setTextColor(87, 78, 177);
    doc.text("GTM STRATEGY", margin, yPos);
    yPos += 10;

    const strat = result.strategy;
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text("Where to Play", margin, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    const whereText = `${strat?.where_to_play?.segment}, ${strat?.where_to_play?.geography}`;
    doc.text(whereText, margin + 3, yPos, { maxWidth: pageWidth - 2 * margin });
    yPos += 10;

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text("How to Win", margin, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    const howText = strat?.how_to_win?.differentiation || "—";
    doc.text(howText, margin + 3, yPos, { maxWidth: pageWidth - 2 * margin });
    yPos += 10;

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text("Positioning Statement", margin, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    const posText = strat?.how_to_win?.positioning_statement || "—";
    const posLines = doc.splitTextToSize(posText, pageWidth - 2 * margin);
    doc.text(posLines, margin + 3, yPos);
    yPos += posLines.length * 5 + 10;

    // Target Accounts
    checkPageBreak(40);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Target Accounts", margin, yPos);
    yPos += 8;

    result.target_accounts?.forEach((acc, i) => {
      checkPageBreak(30);
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text(`${i + 1}. ${acc.company} (${acc.country})`, margin, yPos);
      yPos += 6;
      doc.setFontSize(9);
      doc.setTextColor(0, 110, 32);
      doc.text(formatARR(acc.deal_potential_arr), margin + 3, yPos);
      yPos += 5;
      doc.setFontSize(8);
      doc.setTextColor(50, 50, 50);
      const whyLines = doc.splitTextToSize(acc.why_relevant, pageWidth - 2 * margin - 3);
      doc.text(whyLines, margin + 3, yPos);
      yPos += whyLines.length * 4 + 8;
    });

    // Save PDF
    const fileName = `RivalIQ_${result.company_profile?.company_name?.replace(/\s+/g, '_') || 'Strategy'}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
  };

  const generateBattlecard = async (competitorName) => {
    setLoadingBattlecard(true);
    try {
      const response = await axios.post(`${API}/battlecard`, {
        competitor_name: competitorName,
        company_profile: result.company_profile,
        competitors: result.competitors,
        strategy: result.strategy
      });
      
      setBattlecardData(response.data);
      setShowBattlecard(true);
    } catch (err) {
      console.error("Battlecard generation failed:", err);
      alert("Failed to generate battlecard. Please try again.");
    } finally {
      setLoadingBattlecard(false);
    }
  };

  const exportBattlecardToPDF = () => {
    if (!battlecardData) return;

    const doc = new jsPDF();
    const margin = 15;
    let yPos = 20;

    // Title
    doc.setFontSize(20);
    doc.setTextColor(87, 78, 177);
    doc.text(`Battlecard: ${battlecardData.competitor_name}`, margin, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(new Date().toLocaleDateString(), margin, yPos);
    yPos += 15;

    // Weaknesses
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Their Weaknesses vs Us", margin, yPos);
    yPos += 8;

    battlecardData.weaknesses?.forEach((w, i) => {
      doc.setFontSize(9);
      doc.text(`${i + 1}. ${w}`, margin + 3, yPos);
      yPos += 6;
    });
    yPos += 8;

    // Objections
    doc.setFontSize(14);
    doc.text("Common Objections & Counters", margin, yPos);
    yPos += 8;

    battlecardData.objections?.forEach((obj, i) => {
      doc.setFontSize(10);
      doc.setTextColor(186, 26, 26);
      doc.text(`Objection: ${obj.objection}`, margin + 3, yPos);
      yPos += 6;
      doc.setFontSize(9);
      doc.setTextColor(0, 110, 32);
      const counterLines = doc.splitTextToSize(`Counter: ${obj.counter}`, doc.internal.pageSize.getWidth() - 2 * margin);
      doc.text(counterLines, margin + 3, yPos);
      yPos += counterLines.length * 5 + 8;
    });

    // Trap Question
    yPos += 5;
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Trap-Setting Question", margin, yPos);
    yPos += 8;
    doc.setFontSize(9);
    const trapLines = doc.splitTextToSize(battlecardData.trap_question || "", doc.internal.pageSize.getWidth() - 2 * margin);
    doc.text(trapLines, margin + 3, yPos);
    yPos += trapLines.length * 5 + 10;

    // Winning Message
    doc.setFontSize(14);
    doc.setTextColor(87, 78, 177);
    doc.text("Our Winning Message", margin, yPos);
    yPos += 8;
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const msgLines = doc.splitTextToSize(battlecardData.winning_message || "", doc.internal.pageSize.getWidth() - 2 * margin);
    doc.text(msgLines, margin + 3, yPos);

    doc.save(`Battlecard_${battlecardData.competitor_name}.pdf`);
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
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn-ghost" onClick={exportToPDF}>
                ↓ Export PDF
              </button>
              <button className="btn-ghost" onClick={resetApp}>
                ↩ New analysis
              </button>
            </div>
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
              <CompetitorsTab result={result} onGenerateBattlecard={generateBattlecard} loadingBattlecard={loadingBattlecard} />
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

      {/* BATTLECARD MODAL */}
      {showBattlecard && (
        <BattlecardModal 
          battlecardData={battlecardData}
          onClose={() => setShowBattlecard(false)}
          onExport={exportBattlecardToPDF}
        />
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
        <div className="strategy-block-hero">
          <div className="strategy-stamp-hero">THE DECISION</div>
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

function CompetitorsTab({ result, onGenerateBattlecard, loadingBattlecard }) {
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
              <th>Actions</th>
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
                <td>
                  <button 
                    onClick={() => onGenerateBattlecard(c.name)}
                    disabled={loadingBattlecard}
                    style={{
                      background: 'var(--primary-container)',
                      color: 'var(--primary)',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '0.25rem',
                      fontSize: '11px',
                      fontFamily: 'var(--mono)',
                      cursor: loadingBattlecard ? 'not-allowed' : 'pointer',
                      opacity: loadingBattlecard ? 0.5 : 1,
                      letterSpacing: '0.03em'
                    }}
                  >
                    {loadingBattlecard ? '...' : '→ Generate Battlecard'}
                  </button>
                </td>
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
              <span className="acc-arr">{formatARR(a.deal_potential_arr)}</span>
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

// Battlecard Modal Component
function BattlecardModal({ battlecardData, onClose, onExport }) {
  if (!battlecardData) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--surface-lowest)',
        maxWidth: '700px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        borderRadius: '0.25rem',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <div style={{
          padding: '28px 32px',
          borderBottom: '2px solid var(--outline-faint)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start'
        }}>
          <div>
            <div className="label" style={{ marginBottom: '8px' }}>COMPETITIVE BATTLECARD</div>
            <h2 style={{ fontSize: '22px', fontWeight: '600', margin: 0, letterSpacing: '-0.02em' }}>
              {battlecardData.competitor_name}
            </h2>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '28px',
              cursor: 'pointer',
              color: 'var(--on-surface-muted)',
              lineHeight: 1,
              padding: 0
            }}
          >×</button>
        </div>
        
        <div style={{ padding: '32px' }}>
          {/* Weaknesses */}
          <div style={{ marginBottom: '28px' }}>
            <div className="label" style={{ marginBottom: '14px', color: 'var(--error)' }}>
              THEIR WEAKNESSES VS US
            </div>
            <ol style={{ paddingLeft: '24px', margin: 0 }}>
              {battlecardData.weaknesses?.map((w, i) => (
                <li key={i} style={{ fontSize: '14px', marginBottom: '10px', color: 'var(--on-surface)', lineHeight: '1.6' }}>
                  {w}
                </li>
              ))}
            </ol>
          </div>

          {/* Objections */}
          <div style={{ marginBottom: '28px' }}>
            <div className="label" style={{ marginBottom: '14px' }}>COMMON OBJECTIONS & COUNTERS</div>
            {battlecardData.objections?.map((obj, i) => (
              <div key={i} style={{
                background: 'var(--surface-container)',
                padding: '18px',
                marginBottom: '14px',
                borderRadius: '0.25rem',
                borderLeft: '3px solid var(--error)'
              }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: 'var(--error)',
                  marginBottom: '10px',
                  fontStyle: 'italic'
                }}>
                  "{obj.objection}"
                </div>
                <div style={{
                  fontSize: '13px',
                  color: 'var(--on-surface-variant)',
                  lineHeight: '1.7'
                }}>
                  <strong style={{ color: 'var(--secondary)' }}>→</strong> {obj.counter}
                </div>
              </div>
            ))}
          </div>

          {/* Trap Question */}
          <div style={{ marginBottom: '28px' }}>
            <div className="label" style={{ marginBottom: '14px', color: 'var(--primary)' }}>
              TRAP-SETTING QUESTION
            </div>
            <div style={{
              background: 'var(--primary-container)',
              padding: '20px',
              borderRadius: '0.25rem',
              fontSize: '14px',
              fontStyle: 'italic',
              color: 'var(--on-surface)',
              lineHeight: '1.6',
              borderLeft: '3px solid var(--primary)'
            }}>
              {battlecardData.trap_question}
            </div>
          </div>

          {/* Winning Message */}
          <div style={{ marginBottom: '32px' }}>
            <div className="label" style={{ marginBottom: '14px', color: 'var(--secondary)' }}>
              OUR WINNING MESSAGE
            </div>
            <div style={{
              background: 'rgba(0,110,32,0.08)',
              padding: '20px',
              borderRadius: '0.25rem',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--on-surface)',
              lineHeight: '1.7',
              borderLeft: '3px solid var(--secondary)'
            }}>
              {battlecardData.winning_message}
            </div>
          </div>

          {/* Footer Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '20px', borderTop: '1px solid var(--outline-faint)' }}>
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn-primary" onClick={onExport}>
              ↓ Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
