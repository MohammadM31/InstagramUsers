// ProductAI-style image service: Replicate (Flux/Recraft) + code-controlled text overlay via sharp.
import sharp from 'sharp';
const RATIOS={'1:1':[1080,1080],'4:5':[1080,1350],'9:16':[1080,1920]};
const esc=s=>String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
export async function generateImage({prompt,ratio='1:1',model,overlayText,color='#ffffff',n=1}){
 const token=process.env.REPLICATE_API_TOKEN||process.env.REPLICATE_API_KEY; // both names exist in ProductAI
 if(!token)throw Object.assign(new Error('REPLICATE_API_TOKEN not set'),{status:503});
 const m=model||process.env.IMAGE_MODEL||'black-forest-labs/flux-1.1-pro',[W,H]=RATIOS[ratio]||RATIOS['1:1'];
 const out=[];
 for(let i=0;i<Math.min(n,4);i++){
  const r=await fetch(`https://api.replicate.com/v1/models/${m}/predictions`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'wait'},body:JSON.stringify({input:{prompt,aspect_ratio:ratio}})});
  const p=await r.json();if(!r.ok||p.error)throw new Error(p.detail||p.error||'replicate error');
  const url=Array.isArray(p.output)?p.output[0]:p.output;
  const buf=Buffer.from(await(await fetch(url)).arrayBuffer());
  let img=sharp(buf).resize(W,H,{fit:'cover'});
  if(overlayText){const svg=`<svg width="${W}" height="${H}"><rect y="${H*.72}" width="${W}" height="${H*.28}" fill="rgba(0,0,0,.45)"/><text x="${W/2}" y="${H*.86}" font-size="${W/12}" font-family="sans-serif" font-weight="700" fill="${esc(color)}" text-anchor="middle">${esc(overlayText)}</text></svg>`;img=img.composite([{input:Buffer.from(svg)}])}
  // Base64 data URI: Render's filesystem is ephemeral (same fix as ProductAI). Swap for S3 in production.
  out.push('data:image/png;base64,'+(await img.png().toBuffer()).toString('base64'));}
 return out;}
