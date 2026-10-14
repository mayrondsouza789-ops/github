import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

const MAX_PHOTO = 12 * 1024 * 1024;
const PHOTO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const BUCKET = 'progresscheck-photos';
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin || ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site') || ''))
    throw new ApiError(403, 'Submit this action from ProgressCheck.');
}
async function readJson(request: Request, limit = 2 * 1024 * 1024) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'Send JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Missing request.');
  let text = '', size = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
  try { for (;;) { const {done,value} = await reader.read(); if(done) break;
    size += value.length; if(size > limit) { await reader.cancel(); throw new ApiError(413,'Request is too large.'); }
    text += decoder.decode(value, {stream:true}); } text += decoder.decode();
  } finally { reader.releaseLock(); }
  let data; try { data = JSON.parse(text); } catch { throw new ApiError(400,'Invalid JSON.'); }
  let nodes = 0;
  function visit(v: unknown, depth: number) { if (++nodes > 100000 || depth > 40) throw new ApiError(400,'Record is too complex.');
    if(v && typeof v === 'object') for(const key of Object.keys(v)) { if(['__proto__','prototype','constructor'].includes(key)) throw new ApiError(400,'Invalid property.'); visit((v as Record<string,unknown>)[key],depth+1); } }
  visit(data,0);
  if(!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400,'Send an object.');
  return data;
}
function check(result: {error: {code?: string; message: string} | null}) { if(result.error) throw new ApiError(result.error.code === '23505' ? 409 : 503, result.error.code === '23505' ? 'This record already exists.' : 'Storage could not complete the request. Please retry.'); }
function validState(s: any) { return s && typeof s === 'object' && !Array.isArray(s) && typeof s.profile?.name === 'string' &&
  s.consents && ['storage','analysis','sharing','reminders','research'].every(k=>typeof s.consents[k] === 'boolean') &&
  Array.isArray(s.sessions) && s.sessions.every((v:any)=>typeof v?.id === 'string' && typeof v.status === 'string' && Array.isArray(v.photos)) &&
  Array.isArray(s.audit) && Array.isArray(s.notifications) && (s.draft === null || (typeof s.draft?.id === 'string' && Array.isArray(s.draft.photos))); }
function imageMime(b: Uint8Array) {
  if(b[0]===255 && b[1]===216 && b[2]===255) return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)) return 'image/png';
  if(new TextDecoder().decode(b.slice(0,4))==='RIFF' && new TextDecoder().decode(b.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}

async function route(request: Request): Promise<Response> {
  const responseHeaders = new Headers({'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'Cookie'});
  const json = (value: unknown, status = 200) => Response.json(value,{status,headers:responseHeaders});
  try {
    if(request.method !== 'GET') sameOrigin(request);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!url || !key) return json({error:'Production storage has not been configured.',code:'storage_unavailable'},503);
    const client = createServerClient(url,key,{
      cookieOptions: { httpOnly:true, secure: new URL(request.url).protocol === 'https:', sameSite:'lax', path:'/' },
      cookies: { getAll:()=>parseCookieHeader(request.headers.get('cookie') || '').map(c=>({name:c.name,value:c.value || ''})),
        setAll: cookies=>cookies.forEach(({name,value,options})=>responseHeaders.append('Set-Cookie',serializeCookieHeader(name,value,options))) },
    });
    const path = new URL(request.url).pathname.replace(/\/+$/,'');
    if(path.startsWith('/api/auth/') && request.method === 'POST') {
      if(path === '/api/auth/signout') { const result = await client.auth.signOut({scope:'local'}); if(result.error) throw new ApiError(503,'Could not sign out. Retry.'); return json({ok:true}); }
      if(!['/api/auth/signin','/api/auth/signup'].includes(path)) throw new ApiError(404,'Not found.');
      const data = await readJson(request,8192);
      if(typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254 ||
        typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) throw new ApiError(400,'Enter a valid email and a password of 8–128 characters.');
      const credentials = {email:data.email.trim(),password:data.password};
      const result = path.endsWith('/signup') ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
      if(result.error) throw new ApiError(result.error.status === 429 ? 429 : 400, result.error.status === 429 ? 'Too many attempts. Try again later.' : 'Unable to sign in or register. Check your details and confirm your email if required.');
      return json({ok:true, confirmationRequired:!result.data.session});
    }
    const {data:auth,error:authError} = await client.auth.getUser();
    if(authError && ![400,401,403].includes(authError.status || 0) && authError.name !== 'AuthSessionMissingError') throw new ApiError(503,'Sign-in service is temporarily unavailable.');
    if(!auth.user) return json({error:'Sign in to save records across devices.',code:'unauthenticated',backend:'supabase',signInUrl:'/account.html'},401);
    const owner = auth.user.id;
    const current = async()=>{ const r = await client.from('pc_workspaces').select('state,revision').eq('owner',owner).maybeSingle(); check(r); return r.data; };
    if(path === '/api/health' && request.method === 'GET') {
      await current(); const r = await client.storage.from(BUCKET).list(owner,{limit:1}); check(r);
      return json({ok:true,backend:'supabase',storage:{records:'PostgreSQL',photos:'Supabase Storage'}});
    }
    if(path === '/api/workspace' && request.method === 'GET') { const row=await current(); return json({state:row?.state ?? null,revision:row?.revision ?? 0,backend:'supabase',uploadMode:'signed',user:{id:owner,name:auth.user.email?.split('@')[0] || 'Your record'}}); }
    if(path === '/api/workspace' && request.method === 'PUT') {
      const {state,revision}=await readJson(request);
      if(!validState(state) || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new ApiError(400,'Invalid workspace or revision.');
      const r=await client.rpc('pc_save_workspace',{new_state:state,expected_revision:revision}); check(r);
      if(!r.data?.length) return json({error:'Your workspace changed in another session. Reload before saving.',code:'revision_conflict'},409);
      return json({revision:r.data[0].revision});
    }
    if(path === '/api/photos/upload-url' && request.method === 'POST') {
      const d=await readJson(request,8192);
      if(typeof d.id !== 'string' || !PHOTO_ID.test(d.id) || !['image/png','image/jpeg','image/webp'].includes(d.mime) || !Number.isSafeInteger(d.size) || d.size <= 0 || d.size > MAX_PHOTO || typeof d.name !== 'string') throw new ApiError(400,'Invalid photo. Use a JPEG, PNG or WebP up to 12 MB.');
      const name=d.name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,180) || 'photo';
      const objectKey=owner+'/'+d.id+'/'+crypto.randomUUID();
      const inserted=await client.from('pc_photo_assets').insert({owner,id:d.id,key:objectKey,name,mime:d.mime,size:d.size}); check(inserted);
      const signed=await client.storage.from(BUCKET).createSignedUploadUrl(objectKey);
      if(signed.error) { await client.from('pc_photo_assets').delete().eq('owner',owner).eq('id',d.id); check(signed); }
      return json({id:d.id,uploadUrl:signed.data!.signedUrl});
    }
    if(path === '/api/photos' && request.method === 'POST') {
      const d=await readJson(request,8192);
      if(typeof d.id !== 'string' || !PHOTO_ID.test(d.id)) throw new ApiError(400,'Invalid photo id.');
      const row=await client.from('pc_photo_assets').select('*').eq('owner',owner).eq('id',d.id).maybeSingle(); check(row);
      if(!row.data) throw new ApiError(404,'Photo not found.');
      const downloaded=await client.storage.from(BUCKET).download(row.data.key); check(downloaded);
      const bytes=new Uint8Array(await downloaded.data!.arrayBuffer());
      if(bytes.length !== row.data.size || bytes.length > MAX_PHOTO || imageMime(bytes) !== row.data.mime) throw new ApiError(415,'The uploaded file does not match the declared photograph.');
      check(await client.from('pc_photo_assets').update({status:'ready'}).eq('owner',owner).eq('id',d.id));
      return json({id:d.id,name:row.data.name,mime:row.data.mime,size:bytes.length},201);
    }
    if(path.startsWith('/api/photos/') && ['GET','DELETE'].includes(request.method)) {
      const id=decodeURIComponent(path.slice('/api/photos/'.length)); if(!PHOTO_ID.test(id)) throw new ApiError(400,'Invalid photo id.');
      const r=await client.from('pc_photo_assets').select('*').eq('owner',owner).eq('id',id).maybeSingle(); check(r);
      if(!r.data) throw new ApiError(404,'Photo not found.');
      if(request.method === 'DELETE') { check(await client.storage.from(BUCKET).remove([r.data.key])); check(await client.from('pc_photo_assets').delete().eq('owner',owner).eq('id',id)); return json({deleted:true,id}); }
      if(r.data.status !== 'ready') throw new ApiError(409,'Photo upload is not complete.');
      const signed=await client.storage.from(BUCKET).createSignedUrl(r.data.key,60); check(signed);
      responseHeaders.set('Location',signed.data!.signedUrl); responseHeaders.set('Referrer-Policy','no-referrer'); return new Response(null,{status:302,headers:responseHeaders});
    }
    if(path === '/api/export' && request.method === 'GET') {
      const row=await current(); const r=await client.from('pc_photo_assets').select('id,mime,name,status').eq('owner',owner).order('id'); check(r);
      responseHeaders.set('Content-Disposition','attachment; filename="progresscheck-workspace.json"');
      return json({format:'progresscheck-workspace-v1',exportedAt:new Date().toISOString(),state:row?.state ?? null,revision:row?.revision ?? 0,photos:r.data});
    }
    if(path === '/api/workspace' && request.method === 'DELETE') {
      const d=await readJson(request,8192); if(d.confirm !== 'DELETE') throw new ApiError(400,'Confirm deletion.');
      // Only this authenticated user's objects; bounded batches include unfinished uploads.
      for(;;) { const r=await client.from('pc_photo_assets').select('id,key').eq('owner',owner).limit(100); check(r); if(!r.data?.length) break;
        check(await client.storage.from(BUCKET).remove(r.data.map(p=>p.key)));
        check(await client.from('pc_photo_assets').delete().eq('owner',owner).in('id',r.data.map(p=>p.id))); }
      check(await client.from('pc_workspaces').delete().eq('owner',owner)); return json({deleted:true,revision:0});
    }
    throw new ApiError(404,'API route not found.');
  } catch(error) { return json({error:error instanceof ApiError ? error.message : 'The workspace service could not complete this request.',code:'request_failed'},error instanceof ApiError ? error.status : 503); }
}
export const GET=route, POST=route, PUT=route, DELETE=route;
