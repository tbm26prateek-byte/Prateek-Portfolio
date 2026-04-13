import { useState, useEffect, useRef } from "react";
import "./App.css";
import axios from "axios";
import html2pdf from "html2pdf.js";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STEP_LABELS = [
  { name: "Company Analysis", desc: "Reading your site & extracting profile" },
  { name: "Competitor Identification", desc: "Finding 5–7 real competitors" },
  { name: "Positioning Comparison", desc: "Mapping you vs them" },
  { name: "Gap Identification", desc: "Finding strategic opportunities" },
  { name: "Strategy Engine", desc: "Producing the decision" },
  { name: "Target Accounts", desc: "Generating 5 target companies" },
  { name: "Generating battlecards", desc: "Creating battlecards for each competitor" }
];

const STATUS_MSGS = [
  'Reading website content…',
  'Finding your real competitors…',
  'Mapping positioning matrices…',
  'Hunting for strategic gaps…',
  'Running the strategy engine…',
  'Generating target accounts…',
  'Creating battlecards…'
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
  const [loadElapsed, setLoadElapsed] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Warming up…");
  const [showBattlecard, setShowBattlecard] = useState(false);
  const [battlecardData, setBattlecardData] = useState(null);
  
  const pollingRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  const goHome = () => {
    stopPolling();
    setScreen("home");
    setUrl("");
    setJobId(null);
    setCurrentStep(0);
    setResult(null);
    setError(null);
    setActiveTab("overview");
    setIsSubmitting(false);
    setLoadElapsed(0);
  };

  const startAnalysis = async () => {
    if (!url.trim()) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      const response = await axios.post(`${API}/analyse`, { url: url.trim() });
      const { job_id } = response.data;
      
      setJobId(job_id);
      setScreen("loading");
      setCurrentStep(0);
      setLoadElapsed(0);
      setStatusMsg(STATUS_MSGS[0]);
      
      // Start elapsed timer
      const startTime = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setLoadElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 250);
      
      // Start polling
      startPolling(job_id);
      
    } catch (err) {
      const errorDetail = err.response?.data?.detail || "";
      let userMessage = "Failed to start analysis";
      
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

  const startPolling = (jobId) => {
    pollingRef.current = setInterval(async () => {
      try {
        const response = await axios.get(`${API}/analyse/${jobId}`);
        const data = response.data;
        
        if (data.status === "running") {
          const step = data.current_step || 0;
          setCurrentStep(step);
          if (step > 0 && step <= 7) {
            setStatusMsg(STATUS_MSGS[step - 1]);
          }
        } else if (data.status === "complete") {
          stopPolling();
          clearInterval(elapsedTimerRef.current);
          setStatusMsg("Analysis complete.");
          setTimeout(() => {
            setResult(data.result);
            setScreen("results");
          }, 600);
        } else if (data.status === "failed") {
          stopPolling();
          clearInterval(elapsedTimerRef.current);
          const errorDetail = data.error || "Analysis failed";
          let userMessage = errorDetail;
          
          if (errorDetail.includes("scrape_failed") || errorDetail.includes("Could not reach")) {
            userMessage = "We couldn't read this URL — it may require a login or block automated access. Try your main public-facing homepage (e.g. yourcompany.com, not app.yourcompany.com).";
          } else if (errorDetail.includes("openai")) {
            userMessage = "AI processing failed. Please try again.";
          }
          
          setError(userMessage);
          setScreen("home");
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const switchTab = (name) => {
    setActiveTab(name);
  };

  const openBattlecard = (competitorIndex) => {
    const competitor = result?.competitors?.[competitorIndex];
    if (!competitor) return;

    // Check if battlecards data exists
    if (result?.battlecards && result.battlecards[competitorIndex]) {
      setBattlecardData({
        competitor: competitor,
        battlecard: result.battlecards[competitorIndex]
      });
    } else {
      // Show placeholder
      setBattlecardData({
        competitor: competitor,
        battlecard: null
      });
    }
    setShowBattlecard(true);
  };

  const closeBattlecard = () => {
    setShowBattlecard(false);
    setBattlecardData(null);
  };

  // Export PDF function - builds print-safe DOM
  const exportPDF = () => {
    if (!result) return;

    const p = result.company_profile;
    const s = result.strategy;

    // Build offscreen print container
    const printEl = document.createElement('div');
    printEl.id = 'pdf-export-root';
    printEl.style.cssText = 'position:fixed;top:0;left:-9999px;width:780px;background:#fbf9fa;padding:40px;font-family:Geist,sans-serif;color:#1b1c1d';

    const accountCards = result.target_accounts?.map(a => `
      <div style="background:#fff;border:1px solid rgba(200,196,212,0.35);border-radius:12px;padding:18px 22px;margin-bottom:10px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px">
          <div>
            <div style="font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-0.02em;line-height:1.1;margin-bottom:2px">${a.company}</div>
            <div style="font-family:'Geist Mono',monospace;font-size:10px;color:#7c7b83;letter-spacing:0.08em;text-transform:uppercase">${a.country}</div>
          </div>
          <div style="background:#E1F5EE;color:#006e20;padding:5px 10px;border-radius:6px;font-family:'Geist Mono',monospace;font-size:11px;font-weight:500;white-space:nowrap">${a.deal_potential_arr}</div>
        </div>
        <div style="font-size:13px;color:#47464f;line-height:1.55;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(200,196,212,0.35)">${a.why_relevant}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div style="background:#fbf9fa;padding:9px 11px;border-radius:6px">
            <div style="font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;margin-bottom:4px">Risk</div>
            <div style="color:#47464f;line-height:1.45">${a.risk}</div>
          </div>
          <div style="background:rgba(87,78,177,0.06);border-left:3px solid #574eb1;padding:9px 11px;border-radius:6px">
            <div style="font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#574eb1;text-transform:uppercase;margin-bottom:4px">◆ Signal</div>
            <div style="color:#1b1c1d;font-weight:500;line-height:1.45">${a.timing_signal}</div>
          </div>
          <div style="grid-column:1/-1;background:#fbf9fa;padding:9px 11px;border-radius:6px">
            <div style="font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;margin-bottom:4px">Approach</div>
            <div style="color:#47464f;line-height:1.45">${a.approach}</div>
          </div>
        </div>
      </div>`).join('') || '';

    const compRows = result.competitors?.map(c => `
      <tr>
        <td style="padding:10px 12px;font-family:'Geist Mono',monospace;font-size:11px;border-bottom:1px solid rgba(200,196,212,0.35)">${c.name}</td>
        <td style="padding:10px 12px;font-size:12px;color:#47464f;border-bottom:1px solid rgba(200,196,212,0.35)">${c.target_segment}</td>
        <td style="padding:10px 12px;font-size:12px;color:#47464f;border-bottom:1px solid rgba(200,196,212,0.35)">${c.price_range}</td>
        <td style="padding:10px 12px;font-size:12px;color:#47464f;border-bottom:1px solid rgba(200,196,212,0.35)">${c.positioning}</td>
      </tr>`).join('') || '';

    const actions = s.ninety_day_actions?.map(a => `
      <div style="display:flex;gap:12px;align-items:baseline;padding:6px 0">
        <span style="font-family:'Geist Mono',monospace;font-size:10px;color:#AFA9EC;min-width:20px">0${a.priority}</span>
        <span style="font-size:13px;color:#D3D1C7">${a.action}</span>
      </div>`).join('') || '';

    printEl.innerHTML = `
      <!-- Header -->
      <div style="border-bottom:2px solid #1b1c1d;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end">
        <div>
          <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#574eb1;margin-bottom:6px">RIVALIQ · GTM STRATEGY REPORT</div>
          <div style="font-family:'Instrument Serif',serif;font-size:38px;letter-spacing:-0.02em;line-height:1">${p.company_name}</div>
          <div style="font-family:'Geist Mono',monospace;font-size:10px;color:#7c7b83;letter-spacing:0.1em;margin-top:4px;text-transform:uppercase">${result.url.replace(/https?:\/\//,'')} · ${p.industry}</div>
        </div>
        <div style="text-align:right;font-family:'Geist Mono',monospace;font-size:10px;color:#7c7b83;letter-spacing:0.05em">Generated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div>
      </div>

      <!-- Company Snapshot -->
      <div style="margin-bottom:28px">
        <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#7c7b83;text-transform:uppercase;margin-bottom:12px">Company Snapshot</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:10px 14px;background:#fff;border:1px solid rgba(200,196,212,0.35);width:33%;vertical-align:top"><div style="font-family:'Geist Mono',monospace;font-size:9px;color:#7c7b83;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px">Product</div><div style="font-size:13px;font-weight:500">${p.product}</div></td>
            <td style="padding:10px 14px;background:#fff;border:1px solid rgba(200,196,212,0.35);width:33%;vertical-align:top"><div style="font-family:'Geist Mono',monospace;font-size:9px;color:#7c7b83;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px">Target</div><div style="font-size:13px;font-weight:500">${p.target_customer}</div></td>
            <td style="padding:10px 14px;background:#fff;border:1px solid rgba(200,196,212,0.35);width:33%;vertical-align:top"><div style="font-family:'Geist Mono',monospace;font-size:9px;color:#7c7b83;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px">Pricing</div><div style="font-size:13px;font-weight:500">${p.pricing_model}</div></td>
          </tr>
        </table>
      </div>

      <!-- THE DECISION (dark card) -->
      <div style="background:#0f0f10;color:#fff;border-radius:14px;padding:28px 32px;margin-bottom:28px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:20px">
          <div>
            <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#AFA9EC;margin-bottom:4px">THE DECISION · STRATEGY ENGINE V1</div>
            <div style="font-family:'Instrument Serif',serif;font-size:26px;letter-spacing:-0.02em">Your GTM call.</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.12em;color:#888780;margin-bottom:2px">CONFIDENCE</div>
            <div style="font-family:'Geist Mono',monospace;font-size:22px;color:#5DCAA5;font-weight:500">${s.confidence}%</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:20px 24px;margin-bottom:20px">
          <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#888780;padding-top:6px">WHERE TO PLAY</div>
          <div>
            <div style="font-family:'Instrument Serif',serif;font-size:24px;letter-spacing:-0.02em;line-height:1.15;margin-bottom:6px">${s.where_to_play.segment}, <em style="color:#AFA9EC;font-style:italic">${s.where_to_play.geography}</em></div>
            <div style="font-size:12.5px;color:#B4B2A9;line-height:1.55">${s.where_to_play.why}</div>
          </div>
          <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#888780;padding-top:6px">HOW TO WIN</div>
          <div>
            <div style="font-family:'Instrument Serif',serif;font-size:22px;letter-spacing:-0.02em;line-height:1.15;margin-bottom:6px">${s.how_to_win.differentiation}</div>
            <div style="font-size:12.5px;color:#B4B2A9;line-height:1.55">"${s.how_to_win.positioning_statement}"</div>
          </div>
        </div>
        <div style="background:rgba(127,119,221,0.12);padding:16px 20px;border-radius:10px">
          <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#AFA9EC;margin-bottom:10px">◆ 90-DAY ACTION PLAN</div>
          ${actions}
        </div>
      </div>

      <!-- Strategic Gaps -->
      <div style="margin-bottom:28px;page-break-inside:avoid">
        <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#7c7b83;text-transform:uppercase;margin-bottom:12px">Strategic Gaps</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="width:33.33%;vertical-align:top;padding-right:6px">
              <div style="background:#fff;border:1px solid rgba(200,196,212,0.35);border-radius:10px;padding:16px">
                <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#A32D2D;margin-bottom:10px;text-transform:uppercase">⚠ Weaknesses</div>
                ${result.gaps.weaknesses?.map(w=>`<div style="font-size:12px;color:#47464f;padding:5px 0;line-height:1.5">• ${w.area}</div>`).join('') || ''}
              </div>
            </td>
            <td style="width:33.33%;vertical-align:top;padding:0 3px">
              <div style="background:#fff;border:1px solid rgba(200,196,212,0.35);border-radius:10px;padding:16px">
                <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#574eb1;margin-bottom:10px;text-transform:uppercase">⚡ Overcrowded</div>
                ${result.gaps.overcrowded_areas?.map(c=>`<div style="font-size:12px;color:#47464f;padding:5px 0;line-height:1.5">• ${c.area}</div>`).join('') || ''}
              </div>
            </td>
            <td style="width:33.33%;vertical-align:top;padding-left:6px">
              <div style="background:#fff;border:1px solid rgba(200,196,212,0.35);border-radius:10px;padding:16px">
                <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#006e20;margin-bottom:10px;text-transform:uppercase">✦ Opportunity</div>
                ${result.gaps.underserved_opportunities?.map(o=>`<div style="font-size:12px;color:#47464f;padding:5px 0;line-height:1.5">• ${o.opportunity}</div>`).join('') || ''}
              </div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Competitor Comparison -->
      <div style="margin-bottom:28px;page-break-before:always">
        <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#7c7b83;text-transform:uppercase;margin-bottom:12px">Competitor Landscape</div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid rgba(200,196,212,0.35);border-radius:10px;overflow:hidden">
          <thead>
            <tr style="background:#fbf9fa">
              <th style="padding:10px 12px;text-align:left;font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;border-bottom:1px solid rgba(200,196,212,0.35)">Company</th>
              <th style="padding:10px 12px;text-align:left;font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;border-bottom:1px solid rgba(200,196,212,0.35)">ICP</th>
              <th style="padding:10px 12px;text-align:left;font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;border-bottom:1px solid rgba(200,196,212,0.35)">Price</th>
              <th style="padding:10px 12px;text-align:left;font-family:'Geist Mono',monospace;font-size:9px;letter-spacing:0.1em;color:#7c7b83;text-transform:uppercase;border-bottom:1px solid rgba(200,196,212,0.35)">Core message</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:#eeedfe">
              <td style="padding:10px 12px;font-family:'Geist Mono',monospace;font-size:11px;color:#574eb1;font-weight:500;border-bottom:1px solid rgba(200,196,212,0.35)">${p.company_name.toUpperCase()} ★</td>
              <td style="padding:10px 12px;font-size:12px;color:#1b1c1d;font-weight:500;border-bottom:1px solid rgba(200,196,212,0.35)">${result.comparison.subject?.icp || ''}</td>
              <td style="padding:10px 12px;font-size:12px;color:#1b1c1d;font-weight:500;border-bottom:1px solid rgba(200,196,212,0.35)">${result.comparison.subject?.price_positioning || ''}</td>
              <td style="padding:10px 12px;font-size:12px;color:#1b1c1d;font-weight:500;border-bottom:1px solid rgba(200,196,212,0.35)">${result.comparison.subject?.core_message || ''}</td>
            </tr>
            ${compRows}
          </tbody>
        </table>
      </div>

      <!-- Target Accounts -->
      <div style="margin-bottom:20px">
        <div style="font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#7c7b83;text-transform:uppercase;margin-bottom:12px">Target Accounts · ${result.target_accounts?.length || 0} Identified</div>
        ${accountCards}
      </div>

      <!-- Footer -->
      <div style="margin-top:30px;padding-top:16px;border-top:1px solid rgba(200,196,212,0.35);display:flex;justify-content:space-between;font-family:'Geist Mono',monospace;font-size:9px;color:#7c7b83;letter-spacing:0.08em;text-transform:uppercase">
        <span>RivalIQ · GTM Strategy Report</span>
        <span>${new Date().toLocaleDateString('en-GB')}</span>
      </div>
    `;

    document.body.appendChild(printEl);

    const opt = {
      margin: [10, 10, 10, 10],
      filename: `RivalIQ_${p.company_name.replace(/\s+/g, '_')}_Strategy.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fbf9fa', logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const cleanup = () => {
      if (printEl.parentNode) printEl.parentNode.removeChild(printEl);
    };

    html2pdf().set(opt).from(printEl).save()
      .then(cleanup)
      .catch(err => {
        console.error('PDF export failed:', err);
        cleanup();
        alert('PDF export failed. Check console for details.');
      });

    setTimeout(() => { cleanup(); }, 15000);
  };

  return (
    <div>
      {/* NAV */}
      <div className="nav">
        <div className="logo" onClick={goHome}>
          <div className="logo-mark"></div>
          <span className="logo-text">RivalIQ</span>
          <span className="logo-badge">GTM ENGINE</span>
        </div>
        <div className="nav-links">
          <a>How it works</a>
          <a>Pricing</a>
          <a>Sign in</a>
          <button className="btn-primary">Start free →</button>
        </div>
      </div>

      {/* ═══════════════ HOMEPAGE ═══════════════ */}
      {screen === "home" && (
        <div className="screen active">
          <div className="hero">
            <div className="eyebrow">
              <div className="eyebrow-dot"></div>
              <span className="eyebrow-text">AI-POWERED · 6-STEP PIPELINE</span>
            </div>
            <h1 className="serif">Stop guessing<br />where to <em>compete</em>.</h1>
            <p className="hero-sub">Paste your URL. Get a decisive GTM strategy, competitor battlecards, and 5 target accounts — in under 2 minutes.</p>
            <div className="url-box">
              <input 
                type="text" 
                placeholder="https://yourcompany.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && startAnalysis()}
                disabled={isSubmitting}
              />
              <button 
                className="btn-hero" 
                onClick={startAnalysis}
                disabled={isSubmitting || !url.trim()}
              >
                {isSubmitting ? "Starting..." : "Analyse →"}
              </button>
            </div>
            {error && (
              <div className="error-message">{error}</div>
            )}
            <div className="hero-meta">
              <span><span className="check">✓</span> No credit card</span>
              <span><span className="check">✓</span> First analysis free</span>
              <span><span className="check">✓</span> Under 2 minutes</span>
            </div>
          </div>

          <div className="logo-strip">
            <div className="logo-strip-label">BUILT FOR SERIES A–B SAAS · TRUSTED BY GTM TEAMS AT</div>
            <div className="logos">
              <span>Chargebee</span>
              <span>Razorpay</span>
              <span>Freshworks</span>
              <span>Zeta</span>
              <span>LeadSquared</span>
              <span>Rocketlane</span>
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <div className="label">What you get</div>
              <h2 className="serif">A strategist's deliverable, <em>in minutes.</em></h2>
            </div>
            <div className="get-grid">
              <div className="get-card c1">
                <div className="get-num">01 / DECISION</div>
                <h3 className="serif">The strategy call.</h3>
                <p>Not a dashboard. A decision. Where to play, how to win, and what to charge — with 90-day actions to execute on.</p>
                <div className="get-tags"><span>Segment</span><span>Persona</span><span>Pricing</span></div>
              </div>
              <div className="get-card c2">
                <div className="get-num">02 / INTEL</div>
                <h3 className="serif">Competitor X-ray.</h3>
                <p>5–7 real competitors mapped across ICP, price, and messaging. Plus a battlecard for each — ready for your next sales call.</p>
                <div className="get-tags"><span>Positioning</span><span>Battlecards</span></div>
              </div>
              <div className="get-card c3">
                <div className="get-num">03 / ACTION</div>
                <h3 className="serif">5 accounts to chase.</h3>
                <p>Named companies with deal size, timing signal, risk assessment, and the exact outreach angle to use this week.</p>
                <div className="get-tags"><span>ARR est.</span><span>Timing signals</span></div>
              </div>
            </div>
          </div>

          <div className="pricing" id="pricing">
            <div className="section-head">
              <div className="label">Pricing</div>
              <h2 className="serif">Less than <em>one strategist hour.</em></h2>
            </div>
            <div className="price-grid">
              <div className="price-card">
                <div className="price-tier">STARTER</div>
                <div className="price-amount serif">₹0<em> /mo</em></div>
                <div className="price-desc">Try it on your own company. No credit card.</div>
                <button className="price-cta ghost">Start free</button>
                <ul className="price-features">
                  <li>1 analysis / month</li>
                  <li>Full strategy output</li>
                  <li>5 target accounts</li>
                  <li>Export to PDF</li>
                </ul>
              </div>
              <div className="price-card featured">
                <div className="price-badge">MOST POPULAR</div>
                <div className="price-tier">OPERATOR</div>
                <div className="price-amount serif">₹4,999<em> /mo</em></div>
                <div className="price-desc">For founders & GTM leads running live strategy.</div>
                <button className="price-cta light">Start 14-day trial →</button>
                <ul className="price-features">
                  <li>20 analyses / month</li>
                  <li>Auto-generated battlecards</li>
                  <li>ICP validator</li>
                  <li>Saved strategy history</li>
                  <li>Priority support</li>
                </ul>
              </div>
              <div className="price-card">
                <div className="price-tier">AGENCY</div>
                <div className="price-amount serif">₹14,999<em> /mo</em></div>
                <div className="price-desc">For consultants running multiple accounts.</div>
                <button className="price-cta solid">Contact sales</button>
                <ul className="price-features">
                  <li>Unlimited analyses</li>
                  <li>White-label reports</li>
                  <li>Multi-workspace</li>
                  <li>API access</li>
                  <li>Dedicated success manager</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="footer">
            <div>© 2026 RivalIQ · Built for sharp GTM teams</div>
            <div className="footer-links">
              <a>Privacy</a><a>Terms</a><a>Contact</a>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ LOADING ═══════════════ */}
      {screen === "loading" && (
        <div className="screen active">
          <div className="loading-screen">
            <div className="loading-head">
              <div className="label">Analysing</div>
              <h1 className="serif">Running your GTM pipeline.</h1>
              <div className="loading-url">{url}</div>
            </div>
            <div className="pipe">
              {STEP_LABELS.map((step, idx) => {
                const stepNum = idx + 1;
                const isActive = currentStep === stepNum;
                const isDone = currentStep > stepNum;
                
                return (
                  <div key={idx} className={`pipe-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                    <div className="pipe-idx">
                      {isDone ? '✓' : `0${stepNum}`}
                    </div>
                    <div>
                      <div className="pipe-name">{step.name}</div>
                      <div className="pipe-desc">{step.desc}</div>
                    </div>
                    <div className="pipe-status">
                      {isActive ? <span className="spinner"></span> : isDone ? 'done' : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="loading-footer">
              <span>{statusMsg}</span>
              <span className="mono">{loadElapsed}s</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ RESULTS ═══════════════ */}
      {screen === "results" && result && (
        <div className="screen active">
          <div className="results">
            <ResultsScreen 
              result={result} 
              activeTab={activeTab}
              switchTab={switchTab}
              goHome={goHome}
              exportPDF={exportPDF}
              openBattlecard={openBattlecard}
            />
          </div>
        </div>
      )}

      {/* BATTLECARD MODAL */}
      {showBattlecard && battlecardData && (
        <BattlecardModal 
          data={battlecardData}
          onClose={closeBattlecard}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// RESULTS SCREEN COMPONENT
// ═══════════════════════════════════════════════════
function ResultsScreen({ result, activeTab, switchTab, goHome, exportPDF, openBattlecard }) {
  const p = result.company_profile || {};
  
  return (
    <>
      <div className="results-head">
        <div className="results-title">
          <div className="results-favicon">{p.company_name?.[0] || 'C'}</div>
          <div>
            <div className="results-name serif">{p.company_name || 'Company'}</div>
            <div className="results-meta">
              {result.url?.replace(/https?:\/\//,'')} · {p.industry} · {p.target_customer}
            </div>
          </div>
        </div>
        <div className="results-actions">
          <button className="btn-outline" onClick={exportPDF}>↓ Export PDF</button>
          <button className="btn-outline" onClick={goHome}>↩ New analysis</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => switchTab('overview')}>Overview</button>
        <button className={`tab ${activeTab === 'competitors' ? 'active' : ''}`} onClick={() => switchTab('competitors')}>Competitors</button>
        <button className={`tab ${activeTab === 'strategy' ? 'active' : ''}`} onClick={() => switchTab('strategy')}>Strategy</button>
        <button className={`tab ${activeTab === 'accounts' ? 'active' : ''}`} onClick={() => switchTab('accounts')}>Accounts</button>
      </div>

      {activeTab === 'overview' && <OverviewTab result={result} />}
      {activeTab === 'competitors' && <CompetitorsTab result={result} openBattlecard={openBattlecard} />}
      {activeTab === 'strategy' && <StrategyTab result={result} />}
      {activeTab === 'accounts' && <AccountsTab result={result} />}
    </>
  );
}

// ═══════════════════════════════════════════════════
// TAB COMPONENTS
// ═══════════════════════════════════════════════════
function OverviewTab({ result }) {
  const p = result.company_profile || {};
  const gaps = result.gaps || {};
  const s = result.strategy || {};
  
  const snapItems = [
    ['Product', p.product],
    ['Target customer', p.target_customer],
    ['Pricing model', p.pricing_model],
    ['Positioning', p.positioning],
    ['Industry', p.industry],
    ['Geography', p.market_focus || 'Global']
  ];

  return (
    <>
      <div className="block">
        <div className="block-head"><div className="label">Company snapshot</div></div>
        <div className="snap">
          {snapItems.map(([k, v], i) => (
            <div key={i} className="snap-cell">
              <div className="snap-lbl">{k}</div>
              <div className="snap-val">{v || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="block">
        <div className="block-head"><div className="label">Strategic gaps</div></div>
        <div className="gaps">
          <div className="gap gap-weak">
            <div className="gap-icon">⚠</div>
            <div className="gap-head">Weaknesses</div>
            <ul className="gap-list">
              {gaps.weaknesses?.map((w, i) => (
                <li key={i}>{w.area}</li>
              ))}
            </ul>
          </div>
          <div className="gap gap-crowd">
            <div className="gap-icon">⚡</div>
            <div className="gap-head">Overcrowded</div>
            <ul className="gap-list">
              {gaps.overcrowded_areas?.map((c, i) => (
                <li key={i}>{c.area}</li>
              ))}
            </ul>
          </div>
          <div className="gap gap-opp">
            <div className="gap-icon">✦</div>
            <div className="gap-head">Opportunity</div>
            <ul className="gap-list">
              {gaps.underserved_opportunities?.map((o, i) => (
                <li key={i}>{o.opportunity}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="block">
        <div className="block-head"><div className="label">Recommended strategy</div></div>
        <StrategyCard strategy={s} compact={true} />
      </div>
    </>
  );
}

function CompetitorsTab({ result, openBattlecard }) {
  const p = result.company_profile || {};
  const competitors = result.competitors || [];
  const comparison = result.comparison || {};
  
  const statusMap = [['danger', 'DANGER'], ['overlap', 'OVERLAP'], ['safe', 'SAFE'], ['overlap', 'OVERLAP'], ['danger', 'DANGER'], ['safe', 'SAFE'], ['overlap', 'OVERLAP']];

  return (
    <>
      <div className="block">
        <div className="block-head"><div className="label">Positioning comparison</div></div>
        <table className="comp-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>ICP</th>
              <th>Price</th>
              <th>Core message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="you">
              <td className="comp-cname">{(p.company_name || 'YOU').toUpperCase()} ↗</td>
              <td>{comparison.subject?.icp || '—'}</td>
              <td>{comparison.subject?.price_positioning || '—'}</td>
              <td>{comparison.subject?.core_message || '—'}</td>
              <td><span className="badge-you">YOU</span></td>
            </tr>
            {competitors.map((c, i) => (
              <tr key={i}>
                <td className="comp-cname">{c.name}</td>
                <td>{c.target_segment}</td>
                <td>{c.price_range}</td>
                <td>{c.positioning}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="block">
        <div className="block-head">
          <div className="label">Competitor profiles</div>
          <div className="mono" style={{fontSize:'10px',color:'var(--ink-3)',letterSpacing:'0.05em'}}>⚡ BATTLECARDS READY</div>
        </div>
        <div className="comp-grid">
          {competitors.map((c, i) => {
            const [cls, label] = statusMap[i % statusMap.length];
            return (
              <div key={i} className={`comp-card ${cls}`}>
                <div className="comp-head">
                  <div className="comp-fav">{c.name[0]}</div>
                  <div className="comp-info">
                    <div className="comp-name">{c.name}</div>
                    <div className="comp-tag">{c.target_segment} · {c.price_range}</div>
                  </div>
                  <span className={`comp-status status-${cls}`}>{label}</span>
                </div>
                <div className="comp-body">{c.strengths}</div>
                <div className="comp-cta">
                  <button className="btn-battle" onClick={() => openBattlecard(i)}>
                    ⚡ View battlecard
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function StrategyTab({ result }) {
  const s = result.strategy || {};
  
  return (
    <div className="block">
      <div className="block-head"><div className="label">Full GTM strategy</div></div>
      <StrategyCard strategy={s} compact={false} />
    </div>
  );
}

function AccountsTab({ result }) {
  const accounts = result.target_accounts || [];
  
  return (
    <div className="block">
      <div className="block-head">
        <div className="label">Target accounts · {accounts.length} identified</div>
        <div className="mono" style={{fontSize:'10px',color:'var(--ink-3)',letterSpacing:'0.05em'}}>RANKED BY DEAL POTENTIAL</div>
      </div>
      <div className="accounts">
        {accounts.map((a, i) => (
          <div key={i} className="account">
            <div className="account-top">
              <div>
                <div className="account-name serif">{a.company}</div>
                <div className="account-geo">{a.country}</div>
              </div>
              <div className="account-arr">{a.deal_potential_arr}</div>
            </div>
            <div className="account-why">{a.why_relevant}</div>
            <div className="account-grid">
              <div className="account-meta">
                <div className="account-meta-key">Risk</div>
                <div className="account-meta-val">{a.risk}</div>
              </div>
              <div className="account-meta">
                <div className="account-meta-key">Approach</div>
                <div className="account-meta-val">{a.approach}</div>
              </div>
              <div className="account-meta signal">
                <div className="account-meta-key">◆ Timing signal</div>
                <div className="account-meta-val">{a.timing_signal}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// STRATEGY CARD COMPONENT
// ═══════════════════════════════════════════════════
function StrategyCard({ strategy, compact }) {
  const s = strategy || {};
  const wherePlay = `${s.where_to_play?.segment || ''}, ${s.where_to_play?.geography || ''}`;
  
  if (compact) {
    return (
      <div className="strat-card">
        <div className="strat-top">
          <div>
            <div className="strat-stamp">THE DECISION · STRATEGY ENGINE V1</div>
            <div className="strat-heading serif">Your GTM call.</div>
          </div>
          <div className="strat-conf">
            <div className="strat-conf-lbl">CONFIDENCE</div>
            <div className="strat-conf-val">{s.confidence || 0}%</div>
          </div>
        </div>
        <div className="strat-row">
          <div className="strat-key">WHERE TO PLAY</div>
          <div>
            <div className="strat-val serif">{wherePlay}</div>
            <div className="strat-why">{s.where_to_play?.why || '—'}</div>
          </div>
        </div>
        <div className="strat-row">
          <div className="strat-key">HOW TO WIN</div>
          <div>
            <div className="strat-val serif">{s.how_to_win?.differentiation || '—'}</div>
            <div className="strat-why">"{s.how_to_win?.positioning_statement || '—'}"</div>
          </div>
        </div>
        <div className="strat-actions">
          <div className="strat-actions-head">◆ 90-DAY ACTION PLAN</div>
          <div className="strat-actions-grid">
            {s.ninety_day_actions?.map((a, i) => (
              <div key={i} className="strat-action">
                <span className="strat-action-num">0{a.priority}</span>
                <span className="strat-action-text">{a.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="strat-card">
      <div className="strat-top">
        <div>
          <div className="strat-stamp">THE DECISION · FULL STRATEGY</div>
          <div className="strat-heading serif">Your complete GTM playbook.</div>
        </div>
        <div className="strat-conf">
          <div className="strat-conf-lbl">CONFIDENCE</div>
          <div className="strat-conf-val">{s.confidence || 0}%</div>
        </div>
      </div>
      <div className="strat-row">
        <div className="strat-key">SEGMENT</div>
        <div>
          <div className="strat-val serif">{wherePlay}</div>
          <div className="strat-why">{s.where_to_play?.why || '—'}</div>
        </div>
      </div>
      <div className="strat-row">
        <div className="strat-key">PERSONA</div>
        <div>
          <div className="strat-val serif">{s.where_to_play?.persona || '—'}</div>
          <div className="strat-why">{s.how_to_win?.core_tactic || '—'}</div>
        </div>
      </div>
      <div className="strat-row">
        <div className="strat-key">HOW TO WIN</div>
        <div>
          <div className="strat-val serif">{s.how_to_win?.differentiation || '—'}</div>
          <div className="strat-why">"{s.how_to_win?.positioning_statement || '—'}"</div>
        </div>
      </div>
      <div className="strat-row">
        <div className="strat-key">PRICING</div>
        <div>
          <div className="strat-val serif">{s.pricing_recommendation?.price_point || '—'} · {s.pricing_recommendation?.model || '—'}</div>
          <div className="strat-why">{s.pricing_recommendation?.rationale || '—'}</div>
        </div>
      </div>
      <div className="strat-actions">
        <div className="strat-actions-head">◆ 90-DAY ACTION PLAN</div>
        <div className="strat-actions-grid">
          {s.ninety_day_actions?.map((a, i) => (
            <div key={i} className="strat-action">
              <span className="strat-action-num">0{a.priority}</span>
              <span className="strat-action-text">{a.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// BATTLECARD MODAL COMPONENT
// ═══════════════════════════════════════════════════
function BattlecardModal({ data, onClose }) {
  const competitor = data.competitor;
  const battlecard = data.battlecard;

  return (
    <div className="modal-overlay active" onClick={(e) => e.target.className.includes('modal-overlay') && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">
            <div className="comp-fav">{competitor.name[0]}</div>
            <div>
              <h2 className="serif">Beat {competitor.name}</h2>
              <span>BATTLECARD · {competitor.target_segment.toUpperCase()}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!battlecard ? (
            <div className="battle-placeholder">
              Battlecards generating… This feature is being processed. Please check back soon.
            </div>
          ) : (
            <>
              <div className="battle-section">
                <h3>Their weaknesses vs you</h3>
                {battlecard.weaknesses?.map((w, i) => (
                  <div key={i} className="battle-weakness">
                    <strong>{w.area}</strong> — {w.detail}
                  </div>
                ))}
              </div>
              <div className="battle-section">
                <h3>Objections you'll hear & how to counter</h3>
                {battlecard.objections?.map((o, i) => (
                  <div key={i} className="battle-objection">
                    <div className="battle-obj-q">"{o.objection}"</div>
                    <div className="battle-obj-a">→ {o.counter}</div>
                  </div>
                ))}
              </div>
              <div className="battle-section">
                <h3>Trap-setting question</h3>
                <div className="battle-trap serif">"{battlecard.trap_question}"</div>
              </div>
              <div className="battle-section">
                <h3>Your winning message</h3>
                <div className="battle-msg serif" dangerouslySetInnerHTML={{__html: battlecard.winning_message}}></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
