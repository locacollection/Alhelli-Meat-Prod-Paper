(()=>{
"use strict";
const $=id=>document.getElementById(id);
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
let client=null,user=null,loading=false,previewData=null,previewFromSaved=false;
const numeric=x=>Number.isFinite(Number(x))?Number(x):0;
const kg=g=>(numeric(g)/1000).toFixed(3);
const bd=f=>(numeric(f)/1000).toFixed(3);
const formatDate=value=>{
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||"");
  return m?m[3]+"/"+m[2]+"/"+m[1]:(value||"");
};
function say(id,message,wrong=false){
  const el=$(id);if(!el)return;
  el.textContent=message;el.className=wrong?"message warn":"muted";
}
function openDialog(dialog){if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","")}
function closeDialog(dialog){if(dialog.close)dialog.close();else dialog.removeAttribute("open")}
function snapshot(){
  if(!window.MeatProductionApp?.paperSnapshot)throw new Error("The production scanner is not ready.");
  return window.MeatProductionApp.paperSnapshot();
}
function assertValid(s){
  if(!s||!/^\d{4}-\d{2}-\d{2}$/.test(s.production_date))throw new Error("A valid production date is required.");
  if(!Number.isInteger(s.issue_weight_grams)||s.issue_weight_grams<=0)throw new Error("No usable Recipe Issue weight.");
  const components=["minced_weight_grams","boneless_weight_grams","wastage_weight_grams"];
  if(components.some(k=>!Number.isInteger(s[k])||s[k]<0||s[k]%5!==0))
    throw new Error("The Recipe GRN weights are invalid.");
  if(s.issue_weight_grams!==s.minced_weight_grams+s.boneless_weight_grams+s.wastage_weight_grams)
    throw new Error("Recipe Issue does not match finished products and wastage.");
  if(!Array.isArray(s.label_details)||s.label_details.length!==s.label_count||!s.label_count)
    throw new Error("The scanned label count is incomplete.");
  if(s.label_details.some(x=>!/^\d{13}$/.test(x.barcode)||!Number.isInteger(x.weight_grams)||x.weight_grams%5))
    throw new Error("One or more barcodes are invalid.");
  return s;
}
function create(tag,cls,content){
  const el=document.createElement(tag);if(cls)el.className=cls;
  if(content!==undefined)el.textContent=String(content);
  return el;
}
function cellText(tr,text){
  const td=create("td","",text);tr.append(td);
}
function tableRows(table,items,numberOfRows){
  const body=create("tbody");
  for(let i=0;i<numberOfRows;i++){
    const row=create("tr");const cells=items[i]||["","","",""];
    for(const c of cells)cellText(row,c);
    body.append(row);
  }
  table.append(body);
}
function makePaperTable(title,rows,emptyRows){
  const wrap=create("section","preview-paper-section");
  wrap.append(create("h3","",title));
  const table=create("table","preview-table");
  const header=create("thead"),r=create("tr");
  ["Barcode","Item Name","UOM","QTY"].forEach(v=>{const th=create("th","",v);r.append(th)});
  header.append(r);table.append(header);tableRows(table,rows,emptyRows);
  wrap.append(table);return wrap;
}
function renderPaper(s,fromSaved=false){
  assertValid(s);
  previewData=s;previewFromSaved=fromSaved;
  const content=$("paperPreviewContent");content.replaceChildren();
  const page=create("div","paper-preview-sheet");
  const brand=create("div","preview-letterhead");
  const left=create("div");left.append(create("strong","preview-brand","AlHelli"));
  left.append(create("small","","Mirza AlHelli and Sons B.S.C. (C)"));
  const right=create("strong","preview-arabic","الحلي");
  brand.append(left,right);page.append(brand);
  page.append(create("h2","preview-main-title","Production in store form"));
  const meta=create("table","preview-meta");
  for(const row of [
    ["Plant",s.plant||"SEEF ARAD","Staff Name",s.staff_name||"","Date",formatDate(s.production_date)],
    ["Section","MEAT","Sig","","",""]]){
    const tr=create("tr");
    for(let i=0;i<row.length;i++){
      const cell=create(i%2===0?"th":"td","",row[i]);tr.append(cell);
    }
    meta.append(tr);
  }
  page.append(meta);
  page.append(makePaperTable("Recipe Issue (Sub Contract PO)",[
    ["6777","Pakistani Beef With Bone","kg",kg(s.issue_weight_grams)]
  ],10));
  const grn=[];
  if(s.minced_weight_grams)grn.push(["6780","Pakistani Beef Minced","kg",kg(s.minced_weight_grams)]);
  if(s.boneless_weight_grams)grn.push(["6781","Pakistani Beef Without Bone","kg",kg(s.boneless_weight_grams)]);
  if(s.wastage_weight_grams)grn.push(["","Wastage for Meat","kg",kg(s.wastage_weight_grams)]);
  page.append(makePaperTable("Recipe GRN (Bundling)",grn,9));
  const signatures=create("table","preview-meta preview-signatures");
  for(const row of [["Sup. Name","","Sig","","Doc Reference"],["Pur. Employee","","Sig","",s.paper_reference||""]]){
    const tr=create("tr");for(const v of row)cellText(tr,v);signatures.append(tr);
  }
  page.append(signatures);
  content.append(page);
  $("paperPreviewTitle").textContent=fromSaved?"Saved production paper · "+formatDate(s.production_date):"Production paper preview";
  $("previewSave").hidden=fromSaved;
  openDialog($("paperPreviewDialog"));
}
function openCurrentPreview(){
  try{renderPaper(snapshot());say("savePaperStatus","")}
  catch(err){say("paperWarning",err.message,true)}
}
function openSave(){
  let s=null;
  try{s=snapshot()}catch(_){}
  $("savePaperSummary").textContent=s?
    formatDate(s.production_date)+" · 6777 "+kg(s.issue_weight_grams)+" kg · Finished "+kg(s.minced_weight_grams+s.boneless_weight_grams)+" kg · "+bd(s.finished_value_fils)+" BD":
    "Sign in to browse your saved papers. Scan and verify labels to save a new paper.";
  $("saveToDatabase").disabled=!s||!user||loading;
  say("savePaperStatus",client?"":"Database connection unavailable. Check your internet connection.",!client);
  closeDialog($("paperPreviewDialog"));
  openDialog($("savePaperDialog"));
}
function setUser(next){
  user=next||null;
  $("paperLoginForm").hidden=!!user;
  $("paperLoggedIn").hidden=!user;
  $("paperSignedInAs").textContent=user?.email||"";
  $("saveToDatabase").disabled=!user||loading||$("saveBtn").disabled;
  if(user)void loadHistory();
  else{$("savedPaperList").replaceChildren();say("savedPaperStatus","Sign in from Save Paper to view your private history.")}
}
async function signIn(event){
  event.preventDefault();
  if(!client){say("savePaperStatus","Supabase connection is unavailable.",true);return}
  const email=$("paperEmail").value.trim(),password=$("paperPassword").value;
  $("paperSignIn").disabled=true;
  say("savePaperStatus","Signing in…");
  try{
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error)throw error;
    $("paperPassword").value="";
    setUser(data.user);
    say("savePaperStatus","Signed in. You can now save the production paper.");
  }catch(err){say("savePaperStatus",err.message,true)}
  finally{$("paperSignIn").disabled=false}
}
async function savePaper(){
  if(loading)return;
  if(!client||!user){say("savePaperStatus","Sign in first to save this paper to the database.",true);return}
  let s;
  try{s=assertValid(snapshot())}catch(err){say("savePaperStatus",err.message,true);return}
  loading=true;$("saveToDatabase").disabled=true;
  say("savePaperStatus","Saving production paper to your account…");
  try{
    // Store only product, barcode, weight and price data. Do not upload sticker photos.
    const payload={...s,owner_id:user.id};
    const {data,error}=await client.from("meat_production_papers")
      .insert(payload).select("id,production_date,created_at").single();
    if(error)throw error;
    say("savePaperStatus","Saved successfully for "+formatDate(s.production_date)+".");
    await loadHistory();
    if($("alsoPdf").checked){
      try{await downloadPdf(s)}catch(err){
        say("savePaperStatus","Saved in the database, but PDF download failed: "+err.message,true);
      }
    }
  }catch(err){
    say("savePaperStatus","Could not save: "+err.message,true);
  }finally{loading=false;$("saveToDatabase").disabled=!user||$("saveBtn").disabled}
}
function paperFilename(s){return "Meat-Production-"+s.production_date+".pdf"}
let pdfLibrary=null;
async function getPdfLibrary(){
  if(window.jspdf?.jsPDF)return window.jspdf.jsPDF;
  if(!pdfLibrary){
    pdfLibrary=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      script.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error("PDF library unavailable"));
      script.onerror=()=>reject(new Error("Cannot load PDF library. Check internet access."));
      document.head.append(script);
    });
  }
  return pdfLibrary;
}
function pdfRows(doc,top,rows,minRows=9){
  const left=13,width=184,rowH=8.1,ys=top,columns=[42,96,19,27];
  doc.setFont("helvetica","bold");doc.setFontSize(10);
  ["Barcode","Item Name","UOM","QTY"].forEach((v,i)=>doc.text(v,left+columns.slice(0,i).reduce((a,b)=>a+b,0)+3,top+5.4));
  for(let i=0;i<=minRows+1;i++)doc.line(left,top+i*rowH,left+width,top+i*rowH);
  let x=left;for(let i=0;i<=columns.length;i++){doc.line(x,top,x,top+(minRows+1)*rowH);x+=columns[i]||0}
  doc.setFont("helvetica","normal");doc.setFontSize(10);
  for(let k=0;k<Math.min(rows.length,minRows);k++){
    const row=rows[k];let x=left;for(let i=0;i<4;i++){
      const text=String(row[i]||"").slice(0,i===1?38:26);
      doc.text(text,x+3,top+(k+1)*rowH+5.4);
      x+=columns[i];
    }
  }
  return top+(minRows+1)*rowH;
}
async function downloadPdf(s){
  assertValid(s);
  const JsPdf=await getPdfLibrary();
  const doc=new JsPdf({unit:"mm",format:"a4",orientation:"portrait"});
  doc.setTextColor(42,42,42);doc.setFont("helvetica","bold");doc.setFontSize(22);
  doc.text("AlHelli",13,22);doc.setFontSize(11);doc.setFont("helvetica","normal");
  doc.text("Mirza AlHelli and Sons B.S.C. (C)",13,29);
  doc.setFont("helvetica","bold");doc.setFontSize(15);
  doc.text("Production in store form",105,39,{align:"center"});
  doc.setFontSize(10);doc.setFont("helvetica","normal");
  doc.text("Plant: "+String(s.plant||"").slice(0,42),13,49);
  doc.text("Date: "+formatDate(s.production_date),155,49);
  doc.text("Section: MEAT",13,56);
  doc.text("Staff: "+String(s.staff_name||"").slice(0,48),72,56);
  doc.line(13,59,197,59);
  doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Recipe Issue (Sub Contract PO)",105,66,{align:"center"});
  pdfRows(doc,70,[["6777","Pakistani Beef With Bone","kg",kg(s.issue_weight_grams)]],10);
  doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Recipe GRN (Bundling)",105,170,{align:"center"});
  const rows=[];
  if(s.minced_weight_grams)rows.push(["6780","Pakistani Beef Minced","kg",kg(s.minced_weight_grams)]);
  if(s.boneless_weight_grams)rows.push(["6781","Pakistani Beef Without Bone","kg",kg(s.boneless_weight_grams)]);
  if(s.wastage_weight_grams)rows.push(["","Wastage for Meat","kg",kg(s.wastage_weight_grams)]);
  pdfRows(doc,175,rows,9);
  doc.setFontSize(10);doc.setFont("helvetica","normal");
  doc.text("Sup. Name: _________________________   Sig: ______________",13,266);
  doc.text("Pur. Employee: ______________________   Sig: ______________",13,273);
  doc.text("Doc Reference: "+String(s.paper_reference||"").slice(0,40),13,281);
  doc.save(paperFilename(s));
}
function showHistoryRow(row){
  const card=create("div","saved-paper-item");
  const date=create("strong","",formatDate(row.production_date));
  const total=create("small","",kg(row.issue_weight_grams)+" kg issue · "+
    kg(row.minced_weight_grams+row.boneless_weight_grams)+" kg finished · "+bd(row.finished_value_fils)+" BD");
  const time=create("small","",new Date(row.created_at).toLocaleString());
  card.append(date,total,time);
  const buttons=create("div","saved-paper-buttons");
  const view=create("button","mini","Preview");
  view.type="button";view.addEventListener("click",()=>renderPaper(row,true));
  const pdf=create("button","mini","PDF");
  pdf.type="button";pdf.addEventListener("click",async()=>{
    try{await downloadPdf(row)}catch(err){say("savedPaperStatus","PDF download failed: "+err.message,true)}
  });
  buttons.append(view,pdf);card.append(buttons);
  return card;
}
async function loadHistory(){
  if(!client||!user)return;
  const list=$("savedPaperList");list.replaceChildren();
  say("savedPaperStatus","Loading saved papers…");
  try{
    let query=client.from("meat_production_papers")
      .select("id,production_date,created_at,plant,staff_name,paper_reference,issue_weight_grams,minced_weight_grams,boneless_weight_grams,wastage_weight_grams,finished_value_fils,label_count,label_details")
      .eq("owner_id",user.id).order("production_date",{ascending:false})
      .order("created_at",{ascending:false}).limit(50);
    const date=$("savedDateFilter").value;
    if(date)query=query.eq("production_date",date);
    const {data,error}=await query;
    if(error)throw error;
    if(!data?.length){say("savedPaperStatus","No saved papers"+(date?" for this date":" yet")+".");return}
    say("savedPaperStatus",data.length+" saved paper"+(data.length===1?"":"s")+
      (date?" for "+formatDate(date):" (latest 50)")+".");
    let previous="";
    for(const row of data){
      if(row.production_date!==previous){list.append(create("h3","saved-date-heading",formatDate(row.production_date)));previous=row.production_date}
      list.append(showHistoryRow(row));
    }
  }catch(err){say("savedPaperStatus","Unable to load saved papers: "+err.message,true)}
}
async function initializeAuth(){
  if(!window.supabase?.createClient){
    say("savedPaperStatus","Database connection unavailable. Check your internet connection.",true);return;
  }
  client=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY);
  const {data,error}=await client.auth.getSession();
  if(error)say("savedPaperStatus",error.message,true);
  setUser(data?.session?.user||null);
  client.auth.onAuthStateChange((_event,session)=>{
    const next=session?.user||null;
    if(next?.id!==user?.id)setUser(next);
  });
}
$("printBtn").addEventListener("click",openCurrentPreview);
$("saveBtn").addEventListener("click",openSave);
$("openSaveMenu").addEventListener("click",openSave);
$("closeSaveMenu").addEventListener("click",()=>closeDialog($("savePaperDialog")));
$("closePaperPreview").addEventListener("click",()=>closeDialog($("paperPreviewDialog")));
$("previewSave").addEventListener("click",openSave);
$("paperLoginForm").addEventListener("submit",signIn);
$("paperCreateAccount").addEventListener("click",async()=>{
  if(!client){say("savePaperStatus","Supabase connection is unavailable.",true);return}
  const email=$("paperEmail").value.trim(),password=$("paperPassword").value;
  if(!email||password.length<6){say("savePaperStatus","Enter a valid email and password of at least 6 characters.",true);return}
  $("paperCreateAccount").disabled=true;
  say("savePaperStatus","Creating a staff account…");
  try{
    const {data,error}=await client.auth.signUp({
      email,password,
      options:{emailRedirectTo:"https://locacollection.github.io/Alhelli-Meat-Prod-Paper/"}
    });
    if(error)throw error;
    $("paperPassword").value="";
    if(data.session?.user){
      setUser(data.session.user);
      say("savePaperStatus","Account created and signed in. You can save this production paper.");
    }else{
      say("savePaperStatus","Account requested. Check your email and confirm it before signing in. The confirmation link must be allowed in your Supabase Auth URL settings.");
    }
  }catch(err){say("savePaperStatus","Could not create account: "+err.message,true)}
  finally{$("paperCreateAccount").disabled=false}
});
$("paperSignOut").addEventListener("click",async()=>{
  if(client)await client.auth.signOut();
  setUser(null);
});
$("saveToDatabase").addEventListener("click",savePaper);
$("savePdfOnly").addEventListener("click",async()=>{
  try{await downloadPdf(snapshot())}catch(err){say("savePaperStatus",err.message,true)}
});
$("previewPdf").addEventListener("click",async()=>{
  try{if(previewData)await downloadPdf(previewData)}catch(err){say("paperWarning",err.message,true)}
});
$("refreshSaved").addEventListener("click",loadHistory);
$("savedDateFilter").addEventListener("change",loadHistory);
window.MeatPaperStoreChecks={assertValid,kg,bd,formatDate,paperFilename};
void initializeAuth();
})();
