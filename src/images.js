// ProductAI image engine, ported into GrowthEngine (no OpenSearch/auth/uploads dependencies).
// Ported from ProductAI/backend/services/replicateService.js: model registry, reference-image routing,
// polling, fallback chain. Added here: code-controlled text overlay (sharp) and Instagram aspect ratios.
import sharp from 'sharp';

const RATIOS = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Same registry as ProductAI. `ref` = the model can take a reference image (the user's product photo).
export const MODELS = {
  'flux-schnell':     { id: 'black-forest-labs/flux-schnell' },
  'flux-dev':         { id: 'black-forest-labs/flux-dev', ref: 'image' },
  'flux-1.1-pro':     { id: 'black-forest-labs/flux-1.1-pro' },
  'recraft-v4':       { id: 'recraft-ai/recraft-v4' },
  'flux-kontext-pro': { id: 'black-forest-labs/flux-kontext-pro', ref: 'input_image' },
  'flux-kontext-max': { id: 'black-forest-labs/flux-kontext-max', ref: 'input_image' },
  'nano-banana':      { id: 'google/nano-banana', ref: 'image_input' }, // Gemini 2.5 Flash Image via Replicate
};
const FALLBACK = ['flux-1.1-pro', 'flux-schnell', 'flux-dev'];
const token = () => process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY; // both names exist in ProductAI
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Optional prompt polish through the same OpenAI-compatible LLM (DeepSeek works). Never blocks generation.
export async function refinePrompt(prompt, hasRef) {
  const key = process.env.LLM_API_KEY; if (!key) return prompt;
  try {
    const r = await fetch((process.env.LLM_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ model: process.env.LLM_MODEL || 'gpt-4o-mini', messages: [
        { role: 'system', content: `Rewrite the request as ONE image-generation prompt for an Instagram post: concrete subject, lighting, composition, style. No text inside the image. ${hasRef ? 'An input photo is provided: describe the EDIT to apply to it and keep the product unchanged.' : ''} Output the prompt only.` },
        { role: 'user', content: prompt }] }) });
    const j = await r.json(); return j.choices?.[0]?.message?.content?.trim() || prompt;
  } catch { return prompt; }
}

async function predict(name, prompt, ratio, ref) {
  const m = MODELS[name], input = { prompt, output_format: 'png' };
  if (ref && m.ref) { input[m.ref] = m.ref === 'image_input' ? [ref] : ref; if (m.ref === 'input_image') input.aspect_ratio = 'match_input_image'; else if (m.ref === 'image') input.prompt_strength = 0.4; }
  else input.aspect_ratio = ratio;
  let p = await (await fetch(`https://api.replicate.com/v1/models/${m.id}/predictions`, { method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', Prefer: 'wait' }, body: JSON.stringify({ input }) })).json();
  for (let i = 0; i < 60 && p.status && !['succeeded', 'failed', 'canceled'].includes(p.status); i++) { // poll like ProductAI
    await sleep(2000); p = await (await fetch(p.urls.get, { headers: { Authorization: `Bearer ${token()}` } })).json();
  }
  if (p.status === 'failed' || p.error || p.detail) throw new Error(p.error || p.detail || 'replicate error');
  const url = Array.isArray(p.output) ? p.output[0] : (typeof p.output === 'string' ? p.output : p.output?.url);
  if (!url) throw new Error('no image returned');
  return url;
}

export async function generateImage({ prompt, ratio = '1:1', model, overlayText, color = '#ffffff', n = 1, referenceImage }) {
  if (!token()) throw Object.assign(new Error('REPLICATE_API_TOKEN not set'), { status: 503 });
  const [W, H] = RATIOS[ratio] || RATIOS['1:1'];
  const hasRef = !!referenceImage && /^(https?:|data:image)/.test(referenceImage);
  const ref = hasRef ? referenceImage : null;
  let want = model || process.env.IMAGE_MODEL || 'flux-1.1-pro';
  if (!MODELS[want]) want = Object.keys(MODELS).find(k => MODELS[k].id === want) || 'flux-1.1-pro';
  if (ref && !MODELS[want].ref) want = 'flux-kontext-pro'; // ProductAI rule: never silently drop a reference image
  const final = await refinePrompt(prompt, !!ref);
  const out = [];
  for (let i = 0; i < Math.min(n, 4); i++) {
    let url, last;
    for (const name of [want, ...FALLBACK.filter(f => f !== want && (!ref || MODELS[f].ref))]) {
      try { url = await predict(name, final, ratio, ref); break; } catch (e) { last = e; }
    }
    if (!url) throw last || new Error('all models failed');
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    let img = sharp(buf).resize(W, H, { fit: 'cover' });
    if (overlayText) {
      const svg = `<svg width="${W}" height="${H}"><rect y="${H * .72}" width="${W}" height="${H * .28}" fill="rgba(0,0,0,.45)"/><text x="${W / 2}" y="${H * .86}" font-size="${W / 12}" font-family="sans-serif" font-weight="700" fill="${esc(color)}" text-anchor="middle">${esc(overlayText)}</text></svg>`;
      img = img.composite([{ input: Buffer.from(svg) }]);
    }
    // Base64 data URI: Render's filesystem is ephemeral (same fix as ProductAI). Swap for S3 in production.
    out.push('data:image/png;base64,' + (await img.png().toBuffer()).toString('base64'));
  }
  return out;
}
