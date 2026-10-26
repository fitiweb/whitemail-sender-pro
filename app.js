const $ = (id) => document.getElementById(id);
let accessToken = sessionStorage.getItem("whitemail_access_token") || "";
const toast = (message, error=false) => {
  const el=$("toast"); el.textContent=message; el.className="toast show"+(error?" error":"");
  clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>el.className="toast",4800);
};
const parseRecipients = () => [...new Set($("recipients").value.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean))];
const validEmail = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
function updateRecipientCount(){
  const list=parseRecipients(); const invalid=list.filter(x=>!validEmail(x));
  $("recipientCount").textContent=`${list.length} recipient${list.length===1?"":"s"} detected${invalid.length?` · ${invalid.length} invalid`:""}`;
}
$("recipients").addEventListener("input",updateRecipientCount);
$("year").textContent=new Date().getFullYear();

async function api(path, options={}) {
  const res=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(accessToken?{"Authorization":`Bearer ${accessToken}`} : {}),...(options.headers||{})}});
  const data=await res.json().catch(()=>({error:"Unexpected server response"}));
  if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
  return data;
}
function renderActivity(items=[]){
  const tbody=$("activityRows");
  if(!items.length){tbody.innerHTML='<tr><td colspan="4" class="empty">No sending activity yet.</td></tr>';return;}
  tbody.replaceChildren(...items.map(item=>{
    const tr=document.createElement("tr");
    [item.recipient,item.subject].forEach(value=>{const td=document.createElement("td");td.textContent=value||"—";tr.appendChild(td);});
    const status=document.createElement("td"), badge=document.createElement("span");
    badge.className="state "+(item.status==="sent"?"sent":item.status==="failed"?"failed":"queued");badge.textContent=item.status||"unknown";status.appendChild(badge);tr.appendChild(status);
    const time=document.createElement("td");time.textContent=item.created_at?new Date(item.created_at).toLocaleString("en-GB",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})+" UTC":"—";tr.appendChild(time);
    return tr;
  }));
}
$("accessBtn").addEventListener("click",()=>{
  const token=prompt("Enter the WHITEMAIL_ADMIN_TOKEN configured in Vercel. This token is required to send and view activity.");
  if(token===null)return;
  accessToken=token.trim();
  if(accessToken)sessionStorage.setItem("whitemail_access_token",accessToken);else sessionStorage.removeItem("whitemail_access_token");
  toast(accessToken?"Access token saved for this browser tab/session.":"Access token cleared.");
  refresh();
});
$("importBtn").addEventListener("click",async()=>{
  const file=$("csvFile").files[0];
  if(!file){toast("Choose a CSV file first.",true);return;}
  if(file.size>2*1024*1024){toast("CSV must be smaller than 2 MB.",true);return;}
  const raw=await file.text();
  const rows=raw.split(/\\r?\\n/).map(line=>line.split(",").map(x=>x.trim().replace(/^["']|["']$/g,"")));
  if(!rows.length){toast("CSV file is empty.",true);return;}
  let emails=[];
  const header=rows[0].map(x=>x.toLowerCase());
  const col=header.findIndex(x=>["email","e-mail","email address","recipient"].includes(x));
  if(col>=0) emails=rows.slice(1).map(r=>r[col]||"");
  else emails=rows.flat();
  const found=[...new Set(emails.map(x=>x.trim().toLowerCase()).filter(x=>/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(x)))];
  if(!found.length){toast("No valid email addresses found in the CSV.",true);return;}
  $("recipients").value=[...new Set([...parseRecipients(),...found])].join("\\n");
  updateRecipientCount();toast(`Imported ${found.length} valid unique address(es). Review consent before sending.`);
});
async function refresh(){
  try{
    const d=await api("/api/status");
    $("sentCount").textContent=Number(d.sentToday||0).toLocaleString();
    $("dailyLimit").textContent=Number(d.dailyLimit||1000).toLocaleString();
    $("remainingCount").textContent=Number(d.remaining||0).toLocaleString();
    $("quotaSummary").textContent=`${Number(d.remaining||0).toLocaleString()} of ${Number(d.dailyLimit||1000).toLocaleString()} app sends left`;
    $("serviceStatus").textContent=d.configured?"Ready":"Setup needed";
    $("statusHint").textContent=d.configured?"API configuration detected":"Add server environment variables";
    $("activityCount").textContent=`${(d.activity||[]).length} recent`;
    renderActivity(d.activity||[]);
  }catch(e){
    $("serviceStatus").textContent="Offline";$("statusHint").textContent="API unavailable";
    $("activityRows").innerHTML='<tr><td colspan="4" class="empty">Could not load activity. Check deployment configuration.</td></tr>';
  }
}
$("refreshBtn").addEventListener("click",refresh);
$("emailForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const recipients=parseRecipients(), invalid=recipients.filter(x=>!validEmail(x));
  if(!recipients.length){toast("Add at least one recipient.",true);return;}
  if(invalid.length){toast(`Fix invalid email address(es): ${invalid.slice(0,3).join(", ")}`,true);return;}
  if(recipients.length>50){toast("Send up to 50 recipients per request. Split larger lists into smaller batches.",true);return;}
  if(!confirm(`Send this email to ${recipients.length} unique recipient(s)? Only send to people who opted in.`))return;
  const btn=$("sendBtn");btn.disabled=true;btn.textContent="Sending…";
  try{
    const payload={
      fromName:$("fromName").value.trim(),fromEmail:$("fromEmail").value.trim(),
      replyTo:$("replyTo").value.trim()||undefined,recipients,subject:$("subject").value.trim(),
      message:$("message").value.trim(),permissionConfirmed:$("permission").checked
    };
    const scheduleValue=$("scheduleAt").value;
    const scheduledDate=scheduleValue?new Date(scheduleValue):null;
    if(scheduledDate && (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now()+60000)){
      throw new Error("Choose a schedule time at least one minute in the future.");
    }
    if(scheduledDate) payload.scheduledAt=scheduledDate.toISOString();
    const result=await api(scheduledDate?"/api/campaign":"/api/send",{method:"POST",body:JSON.stringify(payload)});
    toast(result.message||"Request completed.");
    $("recipients").value="";$("scheduleAt").value="";updateRecipientCount();await refresh();
  }catch(err){toast(err.message||"Send failed.",true);await refresh();}
  finally{btn.disabled=false;btn.innerHTML='Send email <span>→</span>';}
});
refresh();