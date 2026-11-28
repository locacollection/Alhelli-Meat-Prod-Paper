(()=>{
"use strict";
const $=id=>document.getElementById(id);
const URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_";
let db=null,user=null,profiles=[],recipes=[],active=null,busy=false;
const status=(s,bad=false)=>{const el=$("recipeStatus");el.textContent=s;el.className="message"+(bad?" warn":"")};
const sayName=p=>p.product_name+" ("+p.item_code+")";
function grouped(rows){
 const map=new Map();
 for(const p of rows){const k=p.item_code;if(!map.has(k)||(!p.archived_at&&map.get(k).archived_at))map.set(k,p)}
 return [...map.values()].sort((a,b)=>a.product_name.localeCompare(b.product_name));
}
function renderProfiles(){
 const products=grouped(profiles);
 const issue=$("recipeIssue");issue.replaceChildren(new Option("Choose input product",""));
 for(const p of products)issue.add(new Option(sayName(p),p.id));
 const out=$("recipeOutputs");out.replaceChildren();
 for(const p of products){const label=document.createElement("label");label.className="recipe-output-option";
 const cb=document.createElement("input");cb.type="checkbox";cb.value=p.id;cb.name="recipeOutput";
 const span=document.createElement("span");const strong=document.createElement("strong");strong.textContent=sayName(p);
 const small=document.createElement("small");small.textContent=p.review_status+" · "+p.sample_count+" samples"+(p.archived_at?" · historical version":"");
 span.append(strong,small);label.append(cb,span);out.append(label)}
 if(!products.length)out.textContent="No trained barcode profiles found.";
}
function renderRecipes(){
 const select=$("recipeSaved");select.replaceChildren(new Option("New recipe",""));
 for(const r of recipes)select.add(new Option(r.name,r.id));
}
function selectRecipe(r){
 active=r||null;$("recipeName").value=r?.name||"";$("recipeIssue").value=r?.issue_profile_id||"";
 const ids=new Set(r?.output_profile_ids||[]);
 document.querySelectorAll('input[name="recipeOutput"]').forEach(x=>x.checked=ids.has(x.value));
 $("recipeSaved").value=r?.id||"";$("recipeDelete").hidden=!r;
 $("recipeSave").textContent=r?"Update recipe":"Save recipe";
}
async function loadProfiles(){
 const {data,error}=await db.from("barcode_learning_profiles").select("id,item_code,product_name,review_status,sample_count,archived_at,price_series_id,price_version,unit_price_fils").order("product_name");
 if(error)throw error;profiles=data||[];renderProfiles();
}
async function loadRecipes(){
 const {data,error}=await db.from("meat_production_recipes").select("id,name,issue_profile_id,output_profile_ids,notes,updated_at").order("updated_at",{ascending:false});
 if(error)throw error;recipes=data||[];renderRecipes();selectRecipe(null);
}
function selectedOutputs(){return [...document.querySelectorAll('input[name="recipeOutput"]:checked')].map(x=>x.value)}
function validate(){
 const name=$("recipeName").value.trim(),issue=$("recipeIssue").value,outputs=selectedOutputs();
 if(!name)throw Error("Enter a recipe name.");
 if(!issue)throw Error("Choose the Recipe Issue product.");
 if(!outputs.length)throw Error("Select at least one Recipe GRN output product.");
 if(outputs.includes(issue))throw Error("The issue product cannot also be an output.");
 return {name,issue_profile_id:issue,output_profile_ids:outputs,owner_id:user.id,updated_at:new Date().toISOString()};
}
async function save(){
 if(busy)return;busy=true;$("recipeSave").disabled=true;
 try{if(!user)throw Error("Sign in through Save Paper first.");
 const payload=validate();let result;
 if(active){result=await db.from("meat_production_recipes").update(payload).eq("id",active.id).select().single()}
 else{result=await db.from("meat_production_recipes").insert(payload).select().single()}
 if(result.error)throw result.error;
 await loadRecipes();selectRecipe(recipes.find(x=>x.id===result.data.id)||result.data);status("Recipe saved.");
 }catch(e){status(e.message||"Could not save recipe.",true)}
 finally{busy=false;$("recipeSave").disabled=!user}
}
async function remove(){
 if(!active||busy)return;if(!confirm("Delete recipe '"+active.name+"'?"))return;busy=true;
 try{const {error}=await db.from("meat_production_recipes").delete().eq("id",active.id);if(error)throw error;
 await loadRecipes();status("Recipe deleted.");
 }catch(e){status(e.message||"Could not delete recipe.",true)}finally{busy=false}
}
async function init(){
 if(!window.supabase?.createClient){status("Database connection unavailable.",true);return}
 db=window.supabase.createClient(URL,KEY);
 const {data,error}=await db.auth.getSession();if(error)throw error;user=data.session?.user||null;
 db.auth.onAuthStateChange(async(_event,session)=>{user=session?.user||null;await refresh()});
 await refresh();
}
async function refresh(){
 if(!db)return;
 if(!user){$("recipeSave").disabled=true;status("Sign in through Save Paper to manage your private recipes.");return}
 try{await Promise.all([loadProfiles(),loadRecipes()]);$("recipeSave").disabled=false;status("Loaded "+profiles.length+" trained profile versions.");}
 catch(e){status(e.message||"Could not load recipes or trained profiles.",true)}
}
$("recipeSaved").addEventListener("change",()=>selectRecipe(recipes.find(r=>r.id===$("recipeSaved").value)||null));
$("recipeSave").addEventListener("click",save);$("recipeDelete").addEventListener("click",remove);
$("recipeName").addEventListener("input",()=>{if(active)$("recipeSave").textContent="Update recipe"});
init().catch(e=>status(e.message||"Recipe setup failed.",true));
})();