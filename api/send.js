const { createClient } = require("@supabase/supabase-js");
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=(v,max=20000)=>String(v||"").trim().slice(0,max);
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const expected=process.env.WHITEMAIL_ADMIN_TOKEN;
  const supplied=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
  if(!expected||!supplied||supplied!==expected) return res.status(401).json({error:"Unauthorized. Set the admin access token."});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.BREVO_API_KEY)
    return res.status(503).json({error:"Email service is not configured. Add the required Vercel environment variables."});
  const body=req.body||{};
  const fromName=clean(body.fromName,100),fromEmail=clean(body.fromEmail,254).toLowerCase();
  const replyTo=clean(body.replyTo,254).toLowerCase(),subject=clean(body.subject,180),message=clean(body.message,20000);
  const recipients=[...new Set((Array.isArray(body.recipients)?body.recipients:[]).map(x=>clean(x,254).toLowerCase()))];
  if(!body.permissionConfirmed)return res.status(400).json({error:"Confirm recipient consent before sending."});
  if(!fromName||!EMAIL_RE.test(fromEmail)||!subject||!message)return res.status(400).json({error:"Provide a sender name, valid sender email, subject and message."});
  if(replyTo&&!EMAIL_RE.test(replyTo))return res.status(400).json({error:"Reply-to address is invalid."});
  if(!recipients.length||recipients.length>50||recipients.some(x=>!EMAIL_RE.test(x)))return res.status(400).json({error:"Provide 1–50 valid, unique recipient addresses per request."});
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const appLimit=Math.max(1,Number(process.env.APP_DAILY_LIMIT||1000));
  const providerLimit=Math.max(1,Number(process.env.PROVIDER_DAILY_LIMIT||300));
  try{
    // This RPC uses a database lock so concurrent requests cannot race past the app quota.
    const {data:reservation,error:reserveError}=await db.rpc("reserve_email_quota",{requested_count:recipients.length,app_daily_limit:appLimit,provider_daily_limit:providerLimit});
    if(reserveError)throw reserveError;
    if(!reservation||reservation.allowed!==true)return res.status(429).json({error:reservation?.reason||"Daily sending quota reached. Try after the quota resets."});
    const results=[];
    for(const recipient of recipients){
      const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.65;color:#202938"><div style="max-width:640px;margin:auto;padding:24px"><p>${escapeHtml(message).replace(/\n/g,"<br>")}</p><hr style="border:0;border-top:1px solid #eee"><p style="font-size:12px;color:#6b7280">You received this email from ${escapeHtml(fromName)}. If you no longer wish to receive these messages, reply with “unsubscribe” or use the unsubscribe method provided by the sender.</p></div></body></html>`;
      let status="failed",providerId=null,errorMessage=null;
      try{
        const payload={sender:{name:fromName,email:fromEmail},to:[{email:recipient}],subject,htmlContent:html,textContent:message};
        if(replyTo)payload.replyTo={email:replyTo};
        const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"accept":"application/json","api-key":process.env.BREVO_API_KEY,"content-type":"application/json"},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({}));
        if(response.ok){status="sent";providerId=data.messageId||null;}
        else errorMessage=`Provider returned HTTP ${response.status}: ${JSON.stringify(data).slice(0,500)}`;
      }catch(e){errorMessage="Provider request failed. Check provider status and logs.";}
      const {error:logError}=await db.from("email_logs").insert({recipient,subject,status,provider_message_id:providerId,error_message:errorMessage});
      if(logError) console.error("Email log insert failed",logError.message);
      results.push({recipient,status,error:errorMessage});
    }
    const sent=results.filter(x=>x.status==="sent").length,failed=results.length-sent;
    return res.status(200).json({message:`Provider accepted ${sent} email(s); ${failed} failed. Acceptance does not guarantee inbox placement.`,sent,failed,results});
  }catch(e){
    console.error("Send endpoint error",e.message);
    return res.status(500).json({error:"Could not reserve quota or send. Check Supabase setup and function logs."});
  }
};