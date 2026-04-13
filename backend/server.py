from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import asyncio
from emergentintegrations.llm.chat import LlmChat, UserMessage
from playwright.async_api import async_playwright
import json
import traceback


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Emergent LLM key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════

class AnalyseRequest(BaseModel):
    url: str

class AnalyseResponse(BaseModel):
    job_id: str
    status: str
    created_at: str

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    current_step: Optional[int] = None
    total_steps: Optional[int] = 6
    step_label: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    failed_at_step: Optional[int] = None
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# AI PROMPTS
# ═══════════════════════════════════════════════════════════════

PROMPT_1_COMPANY_ANALYSIS = """You are a B2B SaaS analyst. You will be given raw text scraped from a company's website.

Your task is to extract a structured business profile.

Rules:
- Be precise. Do not infer what isn't stated.
- If a field cannot be determined, write "unclear" — do not guess.
- Pricing model options: freemium, per-seat, flat-rate, usage-based, enterprise, unclear.
- Keep all values under 10 words each.

Return ONLY this JSON, no preamble, no explanation:

{
  "company_name": "",
  "product": "",
  "industry": "",
  "target_customer": "",
  "pricing_model": "",
  "positioning": ""
}"""

PROMPT_2_COMPETITOR_ID = """You are a competitive intelligence analyst specializing in B2B SaaS.

Given this company profile, identify exactly 5 to 7 real, named competitors.

Rules:
- Only include companies that actually exist and are currently active.
- Include direct competitors (same product category) AND indirect competitors (alternative solutions to the same problem).
- Do not include companies that are 10x larger or in a completely different category.
- Strengths must be specific — not generic phrases like "good product."
- Keep all string values under 15 words.

Return ONLY this JSON array, no preamble:

[
  {
    "name": "",
    "positioning": "",
    "target_segment": "",
    "strengths": "",
    "price_range": ""
  }
]"""

PROMPT_3_POSITIONING = """You are a GTM strategist. Compare the following company against its competitors across four dimensions.

Dimensions to evaluate for each company:
1. ICP (who they actually sell to)
2. Price positioning (budget / mid-market / premium)
3. Core messaging (the one thing they lead with)
4. Market focus (geographic or vertical concentration)

Rules:
- Be specific. "SMB teams under 50 people" is better than "small businesses."
- For price positioning use only: budget / mid-market / premium.
- Highlight where the subject company overlaps with competitors (danger zones) and where it differs (safe zones).

Return ONLY this JSON, no preamble:

{
  "subject": {
    "icp": "",
    "price_positioning": "",
    "core_message": "",
    "market_focus": ""
  },
  "competitors": [
    {
      "name": "",
      "icp": "",
      "price_positioning": "",
      "core_message": "",
      "market_focus": ""
    }
  ],
  "danger_zones": [],
  "safe_zones": []
}"""

PROMPT_4_GAP_ID = """You are a competitive strategy consultant. Your job is to find the gaps in a market.

Given the company profile, its competitors, and the positioning comparison, identify:

1. WEAKNESSES — 3 specific areas where this company is currently losing to competitors. Be specific about which competitor is winning and why.

2. OVERCROWDED AREAS — 3 market areas where competition is so dense that winning would require disproportionate resources. Name the competitors fighting there.

3. UNDERSERVED OPPORTUNITIES — 3 specific gaps where: competition is weak OR absent, willingness to pay is high, and the subject company could realistically win within 90 days.

Rules:
- Every item must be 1–2 sentences. No bullet fragments.
- Opportunities must be actionable within 90 days — no "build AI" or "enter enterprise."
- Prioritize the opportunities by potential impact (index 0 = highest).

Return ONLY this JSON, no preamble:

{
  "weaknesses": [
    { "area": "", "detail": "", "competitor_winning": "" }
  ],
  "overcrowded_areas": [
    { "area": "", "competitors_present": [] }
  ],
  "underserved_opportunities": [
    { "opportunity": "", "why_now": "", "winning_condition": "" }
  ]
}"""

PROMPT_5_STRATEGY = """You are a senior GTM strategist. A founder is paying you $500/hour for one clear answer.

Based on the company profile, competitive landscape, and gap analysis provided, produce a single, decisive GTM strategy recommendation.

This is NOT a summary of the data. This is a DECISION.

Rules:
- "Where to play" must name a specific segment, geography, and persona — not categories.
- "Why" must reference the gap analysis directly — cite specific opportunities by name.
- "How to win" must be a differentiation strategy executable in under 90 days.
- "Positioning statement" must be one sentence, under 20 words, usable in a cold email subject line.
- "Confidence" is your honest assessment from 0–100 based on how clear the data is.
- Do not hedge. Do not say "it depends." Make the call.

Return ONLY this JSON, no preamble:

{
  "where_to_play": {
    "segment": "",
    "geography": "",
    "persona": "",
    "why": ""
  },
  "how_to_win": {
    "differentiation": "",
    "positioning_statement": "",
    "core_tactic": ""
  },
  "pricing_recommendation": {
    "model": "",
    "price_point": "",
    "rationale": ""
  },
  "ninety_day_actions": [
    { "priority": 1, "action": "", "expected_outcome": "" },
    { "priority": 2, "action": "", "expected_outcome": "" },
    { "priority": 3, "action": "", "expected_outcome": "" },
    { "priority": 4, "action": "", "expected_outcome": "" },
    { "priority": 5, "action": "", "expected_outcome": "" }
  ],
  "confidence": 0
}"""

PROMPT_6_TARGET_ACCOUNTS = """You are a B2B sales strategist. Based on the GTM strategy provided, identify exactly 5 real, named target companies to pursue this week.

Rules:
- All 5 companies must actually exist.
- Each company must fit the target segment, geography, and persona from the strategy.
- "Why relevant" must connect directly to the strategy's differentiation angle — not generic fit.
- "Deal potential" must be a realistic ARR estimate based on company size × price point from the strategy.
- "Timing signal" must be a specific observable signal (hiring, funding, expansion, public complaint) — not "they might need this."
- "Approach" must be a one-sentence cold outreach angle specific to this company — something a sales rep can use today.
- Rank by deal potential, highest first.

Return ONLY this JSON array, no preamble:

[
  {
    "company": "",
    "country": "",
    "why_relevant": "",
    "deal_potential_arr": "",
    "risk": "",
    "timing_signal": "",
    "approach": ""
  }
]"""


# ═══════════════════════════════════════════════════════════════
# SCRAPING LOGIC
# ═══════════════════════════════════════════════════════════════

async def scrape_website(url: str) -> str:
    """Scrape website using Playwright for JavaScript-rendered sites"""
    try:
        logger.info(f"Scraping URL with Playwright: {url}")
        
        async with async_playwright() as p:
            # Launch browser in headless mode
            browser = await p.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox']
            )
            
            # Create new page
            page = await browser.new_page()
            
            try:
                # Navigate to URL with timeout
                await page.goto(url, wait_until='domcontentloaded', timeout=30000)
                
                # Wait for page to render (increased to 6s for JS execution)
                await page.wait_for_timeout(6000)
                
                # Scroll to bottom to trigger lazy-loaded content
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await page.wait_for_timeout(2000)
                
                # Remove unnecessary elements
                await page.evaluate("""
                    () => {
                        const selectorsToRemove = ['script', 'style', 'iframe', 'noscript'];
                        selectorsToRemove.forEach(selector => {
                            document.querySelectorAll(selector).forEach(el => el.remove());
                        });
                    }
                """)
                
                # Try to get text content from main content area first
                text = await page.evaluate("""
                    () => {
                        const main = document.querySelector('main') || 
                                    document.querySelector('article') || 
                                    document.querySelector('[role="main"]') ||
                                    document.querySelector('.main-content') ||
                                    document.querySelector('#main');
                        
                        if (main) {
                            const text = main.innerText || main.textContent;
                            return text.replace(/\\s+/g, ' ').trim();
                        }
                        return '';
                    }
                """)
                
                # If main content is too short, fall back to entire body
                if len(text) < 1000:
                    logger.info("Main content too short, falling back to document.body")
                    text = await page.evaluate("""
                        () => {
                            const text = document.body.innerText || document.body.textContent;
                            return text.replace(/\\s+/g, ' ').trim();
                        }
                    """)
                
                main_content = text[:8000]
                logger.info(f"Scraped {len(text)} chars from main page")
                
                # Try to scrape the /pricing page as well
                pricing_content = ""
                try:
                    from urllib.parse import urljoin
                    pricing_url = urljoin(url, '/pricing')
                    logger.info(f"Attempting to scrape pricing page: {pricing_url}")
                    
                    await page.goto(pricing_url, wait_until='domcontentloaded', timeout=15000)
                    await page.wait_for_timeout(4000)
                    
                    # Scroll pricing page
                    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                    await page.wait_for_timeout(2000)
                    
                    pricing_text = await page.evaluate("""
                        () => {
                            const text = document.body.innerText || document.body.textContent;
                            return text.replace(/\\s+/g, ' ').trim();
                        }
                    """)
                    
                    pricing_content = pricing_text[:2000]  # Cap pricing at 2000 chars
                    logger.info(f"Scraped {len(pricing_text)} chars from pricing page")
                    
                except Exception as e:
                    logger.warning(f"Could not scrape pricing page: {str(e)}")
                
                await browser.close()
                
                # Combine main content and pricing content
                combined_text = main_content
                if pricing_content and len(pricing_content) > 100:
                    combined_text += " PRICING INFORMATION: " + pricing_content
                
                # Cap final output at 8000 characters
                scraped_text = combined_text[:8000]
                
                if len(scraped_text) < 100:
                    raise Exception("Not enough content scraped (less than 100 characters)")
                
                logger.info(f"Total scraped content: {len(scraped_text)} characters")
                logger.info(f"First 500 chars: {scraped_text[:500]}")
                
                return scraped_text
                
            except Exception as e:
                await browser.close()
                raise e
                
    except Exception as e:
        logger.error(f"Playwright scraping failed for {url}: {str(e)}")
        raise HTTPException(
            status_code=400, 
            detail="scrape_failed"
        )


# ═══════════════════════════════════════════════════════════════
# OPENAI CALL WRAPPER
# ═══════════════════════════════════════════════════════════════

async def call_openai(prompt: str, context: str, max_tokens: int = 1500, retry_count: int = 0) -> dict:
    """Call OpenAI via emergentintegrations with retry logic and JSON parsing"""
    try:
        logger.info(f"Calling OpenAI via emergentintegrations with max_tokens={max_tokens}")
        
        # Create a unique session ID for this call
        session_id = f"rivaliq_{uuid.uuid4().hex[:8]}"
        
        # Initialize LlmChat
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id,
            system_message=prompt + "\n\nIMPORTANT: You must respond with valid JSON only, no markdown formatting, no code blocks, just raw JSON."
        ).with_model("openai", "gpt-4o")
        
        # Create user message
        user_message = UserMessage(text=context)
        
        # Send message and get response
        response_text = await chat.send_message(user_message)
        
        # Clean response - remove markdown code blocks if present
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        # Parse JSON response
        result_json = json.loads(response_text)
        
        # Estimate tokens (rough approximation: ~4 chars per token)
        tokens_used = (len(prompt) + len(context) + len(response_text)) // 4
        logger.info(f"OpenAI call successful. Estimated tokens used: {tokens_used}")
        
        return {
            "data": result_json,
            "tokens_used": tokens_used
        }
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {str(e)}")
        logger.error(f"Response text was: {response_text[:500]}")
        if retry_count < 1:
            logger.info("Retrying OpenAI call due to invalid JSON...")
            await asyncio.sleep(2)
            return await call_openai(prompt, context, max_tokens, retry_count + 1)
        raise HTTPException(status_code=500, detail="openai_invalid_json")
        
    except Exception as e:
        logger.error(f"OpenAI call failed: {str(e)}")
        if retry_count < 1:
            logger.info("Retrying OpenAI call...")
            await asyncio.sleep(2)
            return await call_openai(prompt, context, max_tokens, retry_count + 1)
        raise HTTPException(status_code=500, detail="openai_timeout")


# ═══════════════════════════════════════════════════════════════
# PIPELINE EXECUTION
# ═══════════════════════════════════════════════════════════════

async def update_job_status(job_id: str, status: str, current_step: int = None, result: dict = None, error: str = None, failed_at_step: int = None):
    """Update job status in MongoDB"""
    update_data = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    if current_step is not None:
        update_data["current_step"] = current_step
    
    if result is not None:
        update_data["result"] = result
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
    
    if error is not None:
        update_data["error"] = error
        
    if failed_at_step is not None:
        update_data["failed_at_step"] = failed_at_step
    
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": update_data}
    )
    logger.info(f"Job {job_id} updated: status={status}, step={current_step}")


async def log_usage(job_id: str, step: int, tokens_used: int):
    """Log token usage for cost tracking"""
    # Rough cost calculation: GPT-4o pricing (example rates)
    # Input: $5/1M tokens, Output: $15/1M tokens (averaged to ~$0.01/1K tokens)
    cost_usd = (tokens_used / 1000) * 0.01
    
    await db.usage_log.insert_one({
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "step": step,
        "tokens_used": tokens_used,
        "cost_usd": cost_usd,
        "created_at": datetime.now(timezone.utc).isoformat()
    })


STEP_LABELS = [
    "Company analysis",
    "Competitor identification",
    "Positioning comparison",
    "Gap identification",
    "Strategy engine",
    "Target account generation"
]


async def run_pipeline(job_id: str, url: str):
    """Execute the 6-step AI pipeline sequentially"""
    try:
        logger.info(f"Starting pipeline for job {job_id}")
        
        # STEP 1: Scrape website
        await update_job_status(job_id, "running", current_step=1)
        scraped_text = await scrape_website(url)
        
        # STEP 2: Company Analysis
        await update_job_status(job_id, "running", current_step=1)
        step1_result = await call_openai(
            PROMPT_1_COMPANY_ANALYSIS,
            f"Website content:\n{scraped_text}",
            max_tokens=500
        )
        company_profile = step1_result["data"]
        await log_usage(job_id, 1, step1_result["tokens_used"])
        logger.info(f"Step 1 complete: {company_profile}")
        
        # STEP 3: Competitor Identification
        await update_job_status(job_id, "running", current_step=2)
        step2_result = await call_openai(
            PROMPT_2_COMPETITOR_ID,
            f"Company profile:\n{json.dumps(company_profile, indent=2)}",
            max_tokens=1000
        )
        competitors = step2_result["data"]
        await log_usage(job_id, 2, step2_result["tokens_used"])
        logger.info(f"Step 2 complete: Found {len(competitors)} competitors")
        
        # STEP 4: Positioning Comparison
        await update_job_status(job_id, "running", current_step=3)
        step3_context = f"Company profile: {json.dumps(company_profile, indent=2)}\n\nCompetitors: {json.dumps(competitors, indent=2)}"
        step3_result = await call_openai(
            PROMPT_3_POSITIONING,
            step3_context,
            max_tokens=1200
        )
        comparison = step3_result["data"]
        await log_usage(job_id, 3, step3_result["tokens_used"])
        logger.info(f"Step 3 complete: Positioning comparison done")
        
        # STEP 5: Gap Identification
        await update_job_status(job_id, "running", current_step=4)
        step4_context = f"Company profile: {json.dumps(company_profile, indent=2)}\n\nCompetitors: {json.dumps(competitors, indent=2)}\n\nPositioning comparison: {json.dumps(comparison, indent=2)}"
        step4_result = await call_openai(
            PROMPT_4_GAP_ID,
            step4_context,
            max_tokens=1200
        )
        gaps = step4_result["data"]
        await log_usage(job_id, 4, step4_result["tokens_used"])
        logger.info(f"Step 4 complete: Gap analysis done")
        
        # STEP 6: Strategy Engine
        await update_job_status(job_id, "running", current_step=5)
        step5_context = f"Company profile: {json.dumps(company_profile, indent=2)}\n\nGap analysis: {json.dumps(gaps, indent=2)}\n\nPositioning comparison: {json.dumps(comparison, indent=2)}"
        step5_result = await call_openai(
            PROMPT_5_STRATEGY,
            step5_context,
            max_tokens=1500
        )
        strategy = step5_result["data"]
        await log_usage(job_id, 5, step5_result["tokens_used"])
        logger.info(f"Step 5 complete: Strategy generated")
        
        # STEP 7: Target Account Generation
        await update_job_status(job_id, "running", current_step=6)
        step6_context = f"GTM strategy: {json.dumps(strategy, indent=2)}\n\nCompany profile: {json.dumps(company_profile, indent=2)}"
        step6_result = await call_openai(
            PROMPT_6_TARGET_ACCOUNTS,
            step6_context,
            max_tokens=2000
        )
        target_accounts = step6_result["data"]
        await log_usage(job_id, 6, step6_result["tokens_used"])
        logger.info(f"Step 6 complete: {len(target_accounts)} target accounts generated")
        
        # Compile final result
        final_result = {
            "job_id": job_id,
            "url": url,
            "created_at": (await db.jobs.find_one({"job_id": job_id}))["created_at"],
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "company_profile": company_profile,
            "competitors": competitors,
            "comparison": comparison,
            "gaps": gaps,
            "strategy": strategy,
            "target_accounts": target_accounts
        }
        
        # Mark job as complete
        await update_job_status(job_id, "complete", current_step=6, result=final_result)
        logger.info(f"Pipeline complete for job {job_id}")
        
    except HTTPException as e:
        logger.error(f"Pipeline failed for job {job_id}: {e.detail}")
        await update_job_status(
            job_id, 
            "failed", 
            error=str(e.detail),
            failed_at_step=1  # Since scraping is often the failure point
        )
        
    except Exception as e:
        logger.error(f"Unexpected error in pipeline for job {job_id}: {str(e)}\n{traceback.format_exc()}")
        await update_job_status(
            job_id,
            "failed",
            error="internal_error",
            failed_at_step=0
        )


# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@api_router.post("/analyse", response_model=AnalyseResponse)
async def create_analysis(request: AnalyseRequest, background_tasks: BackgroundTasks):
    """Trigger the 6-step analysis pipeline"""
    
    # Validate URL
    url = request.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="invalid_url: URL must include http:// or https://")
    
    # Create job
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat()
    
    job_doc = {
        "job_id": job_id,
        "url": url,
        "status": "running",
        "current_step": 0,
        "result": None,
        "created_at": created_at,
        "updated_at": created_at
    }
    
    await db.jobs.insert_one(job_doc)
    logger.info(f"Created job {job_id} for URL: {url}")
    
    # Start pipeline in background
    background_tasks.add_task(run_pipeline, job_id, url)
    
    return AnalyseResponse(
        job_id=job_id,
        status="running",
        created_at=created_at
    )


@api_router.get("/analyse/{job_id}", response_model=JobStatusResponse)
async def get_analysis_status(job_id: str):
    """Poll for job status and results"""
    
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Determine step label
    current_step = job.get("current_step", 0)
    step_label = None
    if current_step > 0 and current_step <= 6:
        step_label = STEP_LABELS[current_step - 1]
    
    response = JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        current_step=current_step if job["status"] == "running" else None,
        total_steps=6,
        step_label=step_label,
        result=job.get("result"),
        failed_at_step=job.get("failed_at_step"),
        error=job.get("error")
    )
    
    return response


@api_router.get("/")
async def root():
    return {"message": "RivalIQ API v1.0"}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
