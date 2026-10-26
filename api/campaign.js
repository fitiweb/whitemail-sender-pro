const { createClient } = require("@supabase/supabase-js");
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=(v,max=20000)=>String(v||"").trim().slice(0,max);
module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const expected=process.env.WHITEMAIL_ADMIN_TOKEN;
  const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!expected||!supplied||supplied!==expected)return res.status(401).json({error:"Unauthorized. Set the admin access token."});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:"Supabase is not configured."});
  const b=req.body||{}, fromName=clean(b.fromName,100),fromEmail=clean(b.fromEmail,254).toLowerCase();
  const replyTo=clean(b.replyTo,254).toLowerCase(),subject=clean(b.subject,180),message=clean(b.message,20000);
  const recipients=[...new Set((Array.isArray(b.recipients)?b.recipients:[]).map(x=>clean(x,254).toLowerCase()))];
  const when=new Date(b.scheduledAt||"");
  if(!b.permissionConfirmed)return res.status(400).json({error:"Confirm recipient consent before scheduling."});
  if(!fromName||!EMAIL_RE.test(fromEmail)||!subject||!message|| (replyTo&&!EMAIL_RE.test(replyTo)))return res.status(400).json({error:"Check sender, reply-to, subject and message fields."});
  if(!recipients.length||recipients.length>50||recipients.some(x=>!EMAIL_RE.test(x)))return res.status(400).json({error:"Provide 1–50 valid unique recipients per request."});
  if(!b.scheduledAt||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+60000)return res.status(400).json({error:"Choose a schedule time at least one minute in the future."});
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  try{
    const {data:reservation,error:re}=await db.rpc("reserve_email_quota",{requested_count:recipients.length,app_daily_limit:Number(process.env.APP_DAILY_LIMIT||1000),provider_daily_limit:Number(process.env.PROVIDER_DAILY_LIMIT||300)});
    if(re)throw re;
    if(!reservation||reservation.allowed!==true)return res.status(429).json({error:reservation?.reason||"Daily sending quota reached."});
    const jobs=recipients.map(recipient=>({recipient,from_name:fromName,from_email:fromEmail,reply_to:replyTo||null,subject,body_text:message,scheduled_at:when.toISOString(),status:"queued",attempts:0}));
    const {error}=await db.from("email_jobs").insert(jobs);
    if(error)throw error;
    return res.status(200).json({message:`Scheduled ${jobs.length} email(s) for ${when.toLocaleString()}. Delivery runs when the queue worker executes.`});
  }catch(e){console.error("Schedule campaign error",e.message);return res.status(500).json({error:"Could not schedule campaign. Confirm the email_jobs table exists."});}
};