require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LOCUS = 'https://beta-api.paywithlocus.com/api';
const KEY = process.env.LOCUS_API_KEY;

app.get('/api/status', (req, res) => res.json({ status: 'alive' }));

app.get('/api/balance', async (req, res) => {
  try {
    const r = await fetch(LOCUS + '/pay/balance', { headers: { 'Authorization': 'Bearer ' + KEY } });
    res.json(await r.json());
  } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/ai', async (req, res) => {
  try {
    const { task, type } = req.body;
    const prompts = {
  'Write a product description for': 'You are an expert copywriter. Write a compelling product description with key benefits, features and a strong call to action. Be specific and persuasive.',
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
    const system = prompts[type] || 'You are a helpful AI assistant.';
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: task }],
      model: 'llama3-8b-8192',
      max_tokens: 500
    });
    res.json({ success: true, result: completion.choices[0].message.content });
  } catch(e) { res.json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => process.stdout.write('RUNNING\n'));