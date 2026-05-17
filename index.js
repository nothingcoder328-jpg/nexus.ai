require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LOCUS = 'https://api.paywithlocus.com/api';
const KEY = process.env.LOCUS_API_KEY;
const PORT = process.env.PORT || 3000;

const jobs = [];
const chatSessions = {};
let metrics = { jobsRun: 0, usdcSettled: 0, xpEarned: 0, dayStreak: 1 };

const AGENTS = {
  ceo: { name: 'CEO Agent', system: 'You are the CEO Agent of NexusAI — a strategic, decisive, visionary AI agent on Base L2 blockchain with Locus payments. You think big, move fast, and tie insights to business outcomes. Speak with authority and clarity. Keep responses sharp and actionable.' },
  research: { name: 'Research Agent', system: 'You are the Research Agent of NexusAI — a deep analytical AI agent specializing in market research, data analysis, and intelligence gathering. Provide thorough data-driven insights. Be specific with numbers and facts. Format with clear sections.' },
  writer: { name: 'Writer Agent', system: 'You are the Writer Agent of NexusAI — a creative persuasive AI agent specializing in content creation, copywriting, and communication. Craft compelling narratives and marketing copy that converts. Always deliver ready-to-use content.' },
  audit: { name: 'Audit Agent', system: 'You are the Audit Agent of NexusAI — a meticulous AI agent specializing in quality assurance, fact-checking, risk assessment. Review work, identify errors, suggest improvements. Always provide a quality score out of 10 and specific improvement suggestions.' }
};

const TASK_PROMPTS = {
  'Write a product description for': 'You are an expert copywriter. Write a compelling product description with key benefits, features and a strong call to action.',
  'Write a marketing tagline for': 'You are a world-class branding expert. Write 5 punchy marketing taglines. Bold your top recommendation and explain why.',
  'Write a business plan summary for': 'You are a top startup advisor. Write a concise executive summary with market opportunity, solution, revenue model, traction and funding ask.',
  'Write social media posts for': 'You are a viral social media expert. Write platform-optimized posts for Twitter/X, Instagram, LinkedIn and TikTok with hooks and hashtags.',
  'Analyze the market opportunity for': 'You are a senior market analyst. Write a detailed analysis with TAM/SAM/SOM, key trends, competitive landscape and recommendation.',
  'Write a cold email campaign for': 'You are a sales expert. Write a 3-email cold outreach sequence with subject lines, personalization hooks and clear CTAs.',
  'Write an investor pitch for': 'You are a pitch coach. Write a compelling 60-second elevator pitch and a 5-point investor deck outline.',
  'Write SEO blog post ideas for': 'You are an SEO expert. Generate 10 high-traffic blog post ideas with titles, target keywords and meta descriptions.',
  'Write a press release for': 'You are a PR professional. Write a newsworthy press release with headline, dateline, body and boilerplate.',
  'Write a competitive analysis for': 'You are a strategy consultant. Write a competitive analysis with top 3 competitors, their strengths/weaknesses and how to beat them.',
  'Write a landing page copy for': 'You are a conversion copywriter. Write full landing page copy with headline, subheadline, benefits, social proof and CTA.',
  'Write customer personas for': 'You are a UX researcher. Create 3 detailed customer personas with demographics, goals, pain points and buying behavior.',
  'Write a fundraising strategy for': 'You are a fundraising expert. Write a 90-day fundraising strategy with target investors, outreach plan and pitch tips.',
  'Write interview questions for hiring': 'You are an HR expert. Write 10 role-specific interview questions with what to look for in each answer.',
  'Write a viral tweet thread about': 'You are a Twitter growth expert. Write a 10-tweet viral thread with a hook tweet, value tweets and a strong CTA finale.'
};

async function callGroq(system, message, maxTokens = 800) {
  const c = await groq.chat.completions.create({
    messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
    model: 'llama-3.3-70b-versatile', max_tokens: maxTokens, temperature: 0.8
  });
  return c.choices[0].message.content;
}

async function locusFetch(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(LOCUS + endpoint, opts);
  return r.json();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/status', (req, res) => res.json({ status: 'alive', uptime: Math.floor(process.uptime()), agents: 4, jobsRun: metrics.jobsRun, network: 'Base L2', payment: 'Locus' }));

app.get('/api/balance', async (req, res) => {
  try { res.json(await locusFetch('/pay/balance')); }
  catch(e) { res.json({ error: e.message, balance: 0 }); }
});

app.get('/api/metrics', (req, res) => res.json({
  jobsRun: metrics.jobsRun, usdcSettled: metrics.usdcSettled.toFixed(4),
  xpEarned: metrics.xpEarned, dayStreak: metrics.dayStreak,
  totalJobs: jobs.length,
  successRate: jobs.length > 0 ? Math.round((jobs.filter(j=>j.status==='complete').length/jobs.length)*100) : 100
}));

app.get('/api/jobs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(jobs.slice(-limit).reverse());
});

app.post('/api/ai', async (req, res) => {
  try {
    const { task, type } = req.body;
    if (!task) return res.json({ error: 'No task provided' });
    const system = TASK_PROMPTS[type] || 'You are a helpful AI assistant for NexusAI.';
    const result = await callGroq(system, task, 800);
    const job = { id: 'job_'+Date.now(), type: type||'AI Task', task: task.substring(0,100), status: 'complete', result: result.substring(0,200)+'...', amount: 0, timestamp: new Date().toISOString(), xp: 10 };
    jobs.push(job); metrics.jobsRun++; metrics.xpEarned += 10;
    res.json({ success: true, result, jobId: job.id });
  } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, agentId, sessionId } = req.body;
    if (!message) return res.json({ error: 'No message provided' });
    const agent = AGENTS[agentId] || AGENTS.ceo;
    const sessKey = sessionId || 'default';
    if (!chatSessions[sessKey]) chatSessions[sessKey] = [];
    const history = chatSessions[sessKey];
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: agent.system }, ...history.slice(-10), { role: 'user', content: message }],
      model: 'llama-3.3-70b-versatile', max_tokens: 600, temperature: 0.85
    });
    const reply = completion.choices[0].message.content;
    history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
    if (history.length > 40) history.splice(0, 2);
    metrics.xpEarned += 5;
    res.json({ success: true, reply, agent: agent.name, sessionId: sessKey });
  } catch(e) { res.json({ error: e.message }); }
});

app.delete('/api/chat/:agentId', (req, res) => {
  delete chatSessions[req.query.sessionId || 'default'];
  res.json({ success: true });
});

app.post('/api/checkout/create', async (req, res) => {
  try {
    const { task, amount } = req.body;
    const data = await locusFetch('/checkout/sessions', 'POST', {
      amount: parseFloat(amount), memo: 'NexusAI Job: ' + task,
      receiptConfig: { enabled: true, fields: { creditorName: 'NexusAI', supportEmail: 'nexusai@agent.com', lineItems: [{ description: task, amount: parseFloat(amount) }] } }
    });
    res.json(data);
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/checkout/preflight/:sessionId', async (req, res) => {
  try { res.json(await locusFetch('/checkout/agent/preflight/' + req.params.sessionId)); }
  catch(e) { res.json({ error: e.message }); }
});

app.post('/api/checkout/pay/:sessionId', async (req, res) => {
  try {
    const data = await locusFetch('/checkout/agent/pay/' + req.params.sessionId, 'POST', { payerEmail: req.body.email || 'user@nexusai.com' });
    if (data && !data.error) { metrics.usdcSettled += parseFloat(req.body.amount || 0); metrics.xpEarned += 25; }
    res.json(data);
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/checkout/status/:txId', async (req, res) => {
  try { res.json(await locusFetch('/checkout/agent/payments/' + req.params.txId)); }
  catch(e) { res.json({ error: e.message }); }
});

app.post('/api/pipeline', async (req, res) => {
  try {
    const { task, agents: agentList } = req.body;
    if (!task) return res.json({ error: 'No task provided' });
    const pipeline = agentList || ['research', 'writer', 'audit'];
    const results = [];
    for (const agentId of pipeline) {
      const agent = AGENTS[agentId] || AGENTS.ceo;
      const prompt = results.length === 0 ? task : `Original task: ${task}\n\nPrevious output:\n${results[results.length-1].result}\n\nBuild on this with your expertise.`;
      const result = await callGroq(agent.system, prompt, 600);
      results.push({ agent: agent.name, agentId, result });
    }
    metrics.jobsRun++; metrics.xpEarned += 30;
    res.json({ success: true, results, final: results[results.length-1]?.result });
  } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/battle', async (req, res) => {
  try {
    const { prompt, agentA, agentB } = req.body;
    if (!prompt) return res.json({ error: 'No prompt provided' });
    const [resultA, resultB] = await Promise.all([
      callGroq(AGENTS[agentA]?.system || AGENTS.ceo.system, prompt, 500),
      callGroq(AGENTS[agentB]?.system || AGENTS.writer.system, prompt, 500)
    ]);
    const judgment = await callGroq(AGENTS.ceo.system, `Judge this battle:\nPROMPT: ${prompt}\nAGENT A (${agentA}): ${resultA}\nAGENT B (${agentB}): ${resultB}\nFormat: SCORES: A=[/10] B=[/10] | WINNER: [A or B] | REASON: [2 sentences]`, 200);
    metrics.xpEarned += 20;
    res.json({ success: true, resultA, resultB, judgment, agentA: AGENTS[agentA]?.name || agentA, agentB: AGENTS[agentB]?.name || agentB });
  } catch(e) { res.json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => process.stdout.write('RUNNING\n'));
