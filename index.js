require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const jobHistory   = [];
const chatHistory  = {};
const agentMetrics = {
  ceo:      { jobs: 0, earned: 0 },
  research: { jobs: 0, earned: 0 },
  writer:   { jobs: 0, earned: 0 },
  audit:    { jobs: 0, earned: 0 },
};

const rateLimitMap = new Map();
function rateLimit(maxPerMin) {
  return (req, res, next) => {
    const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60000 };
      rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > maxPerMin) return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
    next();
  };
}

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LOCUS = 'https://beta-api.paywithlocus.com/api';
const KEY   = process.env.LOCUS_API_KEY;

async function locusFetch(path, opts = {}) {
  const r = await fetch(LOCUS + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Locus ' + r.status + ': ' + t); }
  return r.json();
}

const AGENTS = {
  ceo: {
    name: 'CEO Agent',
    model: 'llama-3.3-70b-versatile',
    system: 'You are the CEO of NexusAI, a visionary autonomous agent economy. Speak with authority, strategic clarity, and calm confidence. When asked about jobs, summarize at an executive level. Give concise, high-value answers. Always end with one actionable next step for the user.',
  },
  research: {
    name: 'Research Agent',
    model: 'llama-3.3-70b-versatile',
    system: 'You are an elite research analyst at NexusAI. Find patterns, synthesize data, and deliver rigorous insights. Format responses with clear sections. Always cite assumptions and give confidence levels.',
  },
  writer: {
    name: 'Writer Agent',
    model: 'llama-3.3-70b-versatile',
    system: 'You are a world-class content strategist and copywriter at NexusAI. Craft compelling narratives, punchy copy, and memorable content. Ask yourself: would this stop a scroll? Deliver multiple variations when possible.',
  },
  audit: {
    name: 'Audit Agent',
    model: 'llama-3.3-70b-versatile',
    system: 'You are a meticulous audit and QA agent at NexusAI. Review work critically, spot weaknesses, suggest concrete improvements. Structure audits as: Summary → Issues Found → Recommendations → Score (1-10). Be direct but constructive.',
  },
};

const TASK_PROMPTS = {
  'Write a product description for':    'You are an expert copywriter. Write a compelling product description with key benefits, features and a strong call to action. Format: Hook → Features (3 bullets) → Benefits → CTA.',
  'Write a marketing tagline for':      'You are a world-class branding expert. Write 5 punchy marketing taglines. Bold your top recommendation and explain why it wins.',
  'Write a business plan summary for':  'You are a top startup advisor. Write a concise executive summary: Problem → Solution → Market Size → Revenue Model → Traction → Ask.',
  'Write social media posts for':       'You are a viral social media expert. Write platform-optimized posts for Twitter/X (thread hook), Instagram (caption + hashtags), LinkedIn (professional tone), TikTok (script hook).',
  'Analyze the market opportunity for': 'You are a senior market analyst. Deliver: TAM/SAM/SOM estimates → Top 3 trends → Competitive landscape → Strategic recommendation.',
  'Write a cold email campaign for':    'You are a sales expert. Write a 3-email cold outreach sequence: Email 1 (cold intro), Email 2 (follow-up value), Email 3 (breakup). Include subject lines and CTAs.',
  'Write an investor pitch for':        'You are a pitch coach. Write: 60-second elevator pitch + 5-slide deck outline with talking points for each slide.',
  'Write SEO blog post ideas for':      'You are an SEO expert. Generate 10 high-traffic blog post ideas with: Title | Target keyword | Search intent | Meta description.',
  'Write a press release for':          'You are a PR professional. Write a full press release: Headline → Dateline → Lead → Body (quotes + context) → Boilerplate.',
  'Write a competitive analysis for':   'You are a strategy consultant. Analyze top 3 competitors: Strengths | Weaknesses | Positioning → How to beat each → Overall recommendation.',
  'Write a landing page copy for':      'You are a conversion copywriter. Write full landing page: Hero headline + subhead → 3 key benefits → Social proof section → FAQ (3 Qs) → CTA.',
  'Write customer personas for':        'You are a UX researcher. Create 3 detailed personas: Name + photo description → Demographics → Goals → Pain points → Buying triggers → Objections.',
  'Write a fundraising strategy for':   'You are a fundraising expert. Deliver a 90-day plan: Week 1-2 (prep) → Week 3-6 (outreach) → Week 7-12 (close). Include target investor profiles.',
  'Write interview questions for hiring':'You are an HR expert. Write 10 behavioral interview questions with: What to look for → Red flags → Green flags.',
  'Write a viral tweet thread about':   'You are a Twitter growth expert. Write a 10-tweet thread: Hook tweet → 8 value tweets (numbered) → CTA finale. Each tweet ≤280 chars.',
  'Write a SWOT analysis for':          'You are a business strategist. Deliver a full SWOT: Strengths (4) → Weaknesses (4) → Opportunities (4) → Threats (4). End with top strategic priority.',
  'Write an onboarding email sequence for': 'You are a lifecycle marketer. Write a 5-email welcome sequence: Day 0 (welcome) → Day 2 (first value) → Day 5 (case study) → Day 10 (feature) → Day 14 (check-in).',
  'Roast my business idea:':            'You are a brutally honest venture critic. Roast the business idea with sharp wit but always end with 3 genuine improvements that could save it.',
};

function makeJobId() { return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function costFromTokens(tokens) { return (tokens / 1000 * 0.0008).toFixed(4); }

app.get('/api/status', (req, res) => res.json({
  status: 'alive', agents: Object.keys(AGENTS).length,
  jobsTotal: jobHistory.length, uptime: Math.floor(process.uptime()),
}));

app.get('/api/balance', async (req, res) => {
  try { res.json(await locusFetch('/pay/balance')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/jobs', (req, res) => {
  const page = parseInt(req.query.page || 1);
  const limit = parseInt(req.query.limit || 20);
  res.json({ jobs: jobHistory.slice((page - 1) * limit, page * limit), total: jobHistory.length, page });
});

app.get('/api/metrics', (req, res) => {
  const totalRevenue = jobHistory.reduce((s, j) => s + (parseFloat(j.amount) || 0), 0);
  const byType = jobHistory.reduce((acc, j) => { acc[j.taskType] = (acc[j.taskType] || 0) + 1; return acc; }, {});
  res.json({ totalJobs: jobHistory.length, totalRevenue: totalRevenue.toFixed(2), byType, agentMetrics });
});

app.get('/api/tasks', (req, res) => res.json({ tasks: Object.keys(TASK_PROMPTS) }));

app.post('/api/ai', rateLimit(15), async (req, res) => {
  try {
    const { task, type } = req.body;
    if (!task || !type) return res.status(400).json({ error: 'task and type are required' });
    const system = TASK_PROMPTS[type] || 'You are a helpful AI assistant. Be thorough and structured.';
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: task }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 800,
    });
    const result = completion.choices[0].message.content;
    const tokens = completion.usage?.total_tokens || 0;
    const job = { id: makeJobId(), task, taskType: type, result, tokens, cost: costFromTokens(tokens), status: 'completed', ts: Date.now() };
    jobHistory.unshift(job);
    if (jobHistory.length > 500) jobHistory.pop();
    res.json({ success: true, result, jobId: job.id, tokens, cost: job.cost });
  } catch (e) {
    console.error('[/api/ai]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', rateLimit(20), async (req, res) => {
  try {
    const { message, agentId = 'ceo', sessionId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const agent = AGENTS[agentId] || AGENTS.ceo;
    const key = agentId + '_' + sessionId;
    if (!chatHistory[key]) chatHistory[key] = [];
    chatHistory[key].push({ role: 'user', content: message });
    const messages = chatHistory[key].slice(-20);
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: agent.system }, ...messages],
      model: agent.model,
      max_tokens: 400,
    });
    const reply = completion.choices[0].message.content;
    chatHistory[key].push({ role: 'assistant', content: reply });
    if (agentMetrics[agentId]) agentMetrics[agentId].jobs++;
    res.json({ success: true, reply, agentId, agentName: agent.name });
  } catch (e) {
    console.error('[/api/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/chat/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { sessionId = 'default' } = req.query;
  delete chatHistory[agentId + '_' + sessionId];
  res.json({ success: true });
});

app.post('/api/checkout/create', async (req, res) => {
  try {
    const { task, taskType, amount } = req.body;
    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'valid amount required' });
    const data = await locusFetch('/checkout/sessions', {
      method: 'POST',
      body: JSON.stringify({
        amount: parseFloat(amount),
        memo: 'NexusAI Job: ' + (task || 'AI Task'),
        receiptConfig: {
          enabled: true,
          fields: { creditorName: 'NexusAI', supportEmail: 'nexusai@agent.com', lineItems: [{ description: task || taskType || 'AI Job', amount }] },
        },
      }),
    });
    const job = { id: makeJobId(), task, taskType, amount, status: 'pending_payment', ts: Date.now() };
    jobHistory.unshift(job);
    res.json({ ...data, internalJobId: job.id });
  } catch (e) {
    console.error('[/api/checkout/create]', e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/checkout/preflight/:sessionId', async (req, res) => {
  try { res.json(await locusFetch('/checkout/agent/preflight/' + req.params.sessionId)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/checkout/pay/:sessionId', async (req, res) => {
  try {
    const data = await locusFetch('/checkout/agent/pay/' + req.params.sessionId, {
      method: 'POST',
      body: JSON.stringify({ payerEmail: req.body.email || 'user@nexusai.com' }),
    });
    const pending = jobHistory.find(j => j.status === 'pending_payment');
    if (pending) { pending.status = 'paid'; pending.txId = data.txId || data.id; agentMetrics.ceo.earned += parseFloat(pending.amount || 0); }
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/checkout/status/:txId', async (req, res) => {
  try { res.json(await locusFetch('/checkout/agent/payments/' + req.params.txId)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => process.stdout.write('NexusAI running on :' + PORT + '\n'));
