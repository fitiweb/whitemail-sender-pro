const { createClient } = require("@supabase/supabase-js");
module.exports = async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
  const expected=process.env.WHITEMAIL_ADMIN_TOKEN;
  const supplied=(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");
  if(!expected||!supplied||supplied!==expected) return res.status(401).json({error:"Unauthorized. Set the admin access token."});
  const configured=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.BREVO_API_KEY);
  if(!configured) return res.status(200).json({configured:false,sentToday:0,dailyLimit:Number(process.env.APP_DAILY_LIMIT||1000),remaining:0,activity:[]});
  try{
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
    const limit=Math.max(1,Number(process.env.APP_DAILY_LIMIT||1000));
    const since=new Date();since.setUTCHours(0,0,0,0);
    const {count,error:countError}=await db.from("email_logs").select("id",{count:"exact",head:true}).eq("status","sent").gte("created_at",since.toISOString());
    if(countError) throw countError;
    const {data:reservations,error:quotaError}=await db.from("email_quota_reservations").select("reserved_count").eq("day_utc",since.toISOString().slice(0,10));
    if(quotaError) throw quotaError;
    const {data:activity,error}=await db.from("email_logs").select("recipient,subject,status,created_at").order("created_at",{ascending:false}).limit(20);
    if(error) throw error;
    const sentToday=count||0;
    const reservedToday=(reservations||[]).reduce((sum,row)=>sum+Number(row.reserved_count||0),0);
    return res.status(200).json({configured:true,sentToday,dailyLimit:limit,remaining:Math.max(0,Math.min(limit,Number(process.env.PROVIDER_DAILY_LIMIT||300))-reservedToday),activity:activity||[]});
  }catch(e){return res.status(500).json({error:"Could not read status. Check database setup."});}
};