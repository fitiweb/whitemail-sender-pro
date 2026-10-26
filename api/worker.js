const { createClient } = require("@supabase/supabase-js");
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST"&&req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const secret=process.env.WHITEMAIL_CRON_SECRET;
  const bearer=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const cronHeader=req.headers["x-vercel-cron"];
  if(!secret||!(bearer===secret || (cronHeader==="1"&&process.env.VERCEL_ENV==="production")))return res.status(401).json({error:"Unauthorized worker."});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.BREVO_API_KEY)return res.status(503).json({error:"Email service is not configured."});
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  try{
    const now=new Date().toISOString();
    const {data:jobs,error}=await db.from("email_jobs").select("*").eq("status","queued").lte("scheduled_at",now).order("scheduled_at",{ascending:true}).limit(10);
    if(error)throw error;
    const results=[];
    for(const job of jobs||[]){
      // Conditional claim reduces duplicate processing. For multiple parallel workers, use a SQL claim RPC/queue.
      const {data:claimed,error:claimError}=await db.from("email_jobs").update({status:"processing"}).eq("id",job.id).eq("status","queued").select("id").maybeSingle();
      if(claimError||!claimed)continue;
      let status="failed",providerId=null,errMsg=null;
      try{
        const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.65;color:#202938"><div style="max-width:640px;margin:auto;padding:24px"><p>${esc(job.body_text).replace(/\n/g,"<br>")}</p><hr><p style="font-size:12px;color:#6b7280">You received this email from ${esc(job.from_name)}. Reply “unsubscribe” to request no further messages.</p></div></body></html>`;
        const payload={sender:{name:job.from_name,email:job.from_email},to:[{email:job.recipient}],subject:job.subject,htmlContent:html,textContent:job.body_text};
        if(job.reply_to)payload.replyTo={email:job.reply_to};
        const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"accept":"application/json","api-key":process.env.BREVO_API_KEY,"content-type":"application/json"},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({}));
        if(response.ok){status="sent";providerId=data.messageId||null;}
        else {errMsg=`Provider HTTP ${response.status}: ${JSON.stringify(data).slice(0,400)}`;}
      }catch(e){errMsg="Temporary provider/network failure.";}
      const attempts=Number(job.attempts||0)+1;
      if(status==="failed"&&attempts<4){
        // Retry only temporary failures; most 4xx are permanent/configuration errors.
        const permanent=/Provider HTTP 4\d\d/.test(errMsg||"") && !/HTTP 429/.test(errMsg||"");
        if(!permanent){
          const next=new Date(Date.now()+Math.min(3600000,60000*Math.pow(2,attempts))).toISOString();
          await db.from("email_jobs").update({status:"queued",attempts,scheduled_at:next,last_error:errMsg}).eq("id",job.id);
        }else{
          await db.from("email_jobs").update({status:"failed",attempts,last_error:errMsg}).eq("id",job.id);
        }
      }else{
        await db.from("email_jobs").update({status,attempts,provider_message_id:providerId,last_error:errMsg,processed_at:new Date().toISOString()}).eq("id",job.id);
      }
      await db.from("email_logs").insert({recipient:job.recipient,subject:job.subject,status,provider_message_id:providerId,error_message:errMsg});
      results.push({id:job.id,status,attempts});
    }
    return res.status(200).json({processed:results.length,results});
  }catch(e){console.error("Queue worker error",e.message);return res.status(500).json({error:"Queue worker failed. Check logs and schema."});}
};