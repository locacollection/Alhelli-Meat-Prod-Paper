const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../barcode-learning-core.js");
const tester=require("../barcode-tester-core.js");
const root=path.resolve(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const html=read("barcode-tester.html");
const js=read("barcode-tester.js");
const learning=read("barcode-learning.html");
const learningJS=read("barcode-learning.js");
const deploy=read(".github/workflows/deploy-pages.yml");
const item=(id,code,rate,version=1,archived=false)=>({
  id,item_code:code,product_name:code==="6781"?"Pakistani Beef Without Bone":
    code==="6777"?"Pakistani Beef With Bone":"Carrot China",
  weight_step_grams:5,unit_price_fils:rate,rounding_fils:5,
  barcode_prefix:code==="6793"?"916793":"96"+code,
  pattern_mode:"price5_verified",review_status:"validated",price_version:version,
  archived_at:archived?"2026-11-16T11:00:00Z":null
});
const p6781=item("bf","6781",4500),pOld=item("old","6777",3190,1,true),
  pNew=item("new","6777",3500,2),pCarrot=item("carrot","6793",725);
const all=[p6781,pOld,pNew,pCarrot];
const infer=tester.evaluate("9667812095207",{profiles:all},core);
assert.equal(infer.invalid,false);
assert.equal(infer.results.length,1);
assert.equal(infer.results[0].source,"pattern");
assert.equal(infer.results[0].itemCode,"6781");
assert.equal(infer.results[0].weightGrams,2115);
assert.equal(infer.results[0].totalFils,9520);
assert.equal(infer.results[0].unitRate,4500);
assert.equal(infer.results[0].verified,false,
  "A learned estimate is not a confirmed printed training label");
const saved=tester.evaluate("9667815052900",{
  profiles:all,examples:[{profile_id:"bf",barcode:"9667815052900",
    weight_grams:1175,total_price_fils:5290,verified_from_label:true}]
},core);
assert.equal(saved.results.length,1);
assert.equal(saved.results[0].source,"learning");
assert.equal(saved.results[0].verified,true);
assert.equal(saved.results[0].weightGrams,1175);
assert.equal(saved.results[0].totalFils,5290);
const historic=tester.evaluate("9667770031903",{profiles:all,examples:[
  {profile_id:"old",barcode:"9667770031903",weight_grams:1000,
    total_price_fils:3190,verified_from_label:true}
]},core);
assert.equal(historic.results[0].source,"learning");
assert.equal(historic.results[0].unitRate,3190);
assert.equal(historic.results[0].archived,true);
assert.equal(historic.results[0].priceVersion,1);
const sameBarcode="9667777031500";
const conflicting=tester.evaluate(sameBarcode,{profiles:[
  {...pNew,unit_price_fils:3500},item("another","6777",4500,3,true)],
  examples:[
    {profile_id:"new",barcode:sameBarcode,weight_grams:900,total_price_fils:3150,verified_from_label:true},
    {profile_id:"another",barcode:sameBarcode,weight_grams:700,total_price_fils:3150,verified_from_label:true}
  ]
},core);
assert.equal(conflicting.results.filter(r=>r.source==="learning").length,2);
assert.ok(conflicting.notes.some(t=>/disagree/.test(t)),
  "Conflicting exact saved weight/price records must not be silently resolved");
const ambiguous=tester.evaluate("9167930001109",{profiles:all},core);
assert.ok(ambiguous.results.some(x=>x.ambiguous),JSON.stringify(ambiguous));
assert.equal(ambiguous.results[0].weightGrams,null);
assert.equal(ambiguous.results[0].totalFils,110);
assert.equal(ambiguous.results[0].verified,false);
const custom=tester.evaluate("9667812095207",{
  profiles:all,custom:[{barcode:"9667812095207",item_code:"6781",
    product_name:"Saved item",unit_type:"kg",weight_grams:2115,
    unit_price_fils:4500,total_price_fils:9520}]
},core);
assert.ok(custom.results.some(r=>r.source==="custom"));
assert.ok(custom.results.some(r=>r.source==="pattern"));
const catalog=tester.evaluate("9667800031057",{catalog:[{
  ean13:"9667800031057",item_code:"6780",product_name:"Pakistani Beef Minced",
  weight_grams:690,unit_price_fils_per_kg:4500,total_price_fils:3105,
  label_verified:true
}]},core);
assert.equal(catalog.results[0].source,"catalog");
assert.equal(catalog.results[0].verified,true);
assert.equal(tester.evaluate("9667812095200",{profiles:all},core).invalid,true);
const unknown=tester.evaluate("9123456789013",{},core);
assert.equal(unknown.results.length,0);
assert.ok(unknown.notes.length>0);
assert.ok(html.includes("id=\"testerScan\"")&&html.includes("id=\"testerForm\""));
assert.ok(!html.includes("testerProfileSelect"),
  "Tester must not require picking any profile");
assert.ok(learning.includes('href="./barcode-tester.html"'));
assert.ok(!learning.includes('id="learnTestForm"'));
assert.ok(!learningJS.includes("function testBarcode(e)"));
assert.ok(!learningJS.includes('camMode==="test"'));
assert.ok(js.includes('eq("owner_id",owner)')&&js.includes('eq("barcode",barcode)'));
assert.ok(js.includes(".range(offset,offset+499)"),
  "Old price profiles must be paged rather than limiting to the selected one");
for(const word of [".insert(", ".update(", ".delete(", ".rpc("])
  assert.ok(!js.includes(word),"Tester must be read-only: "+word);
for(const f of ["barcode-tester.html","barcode-tester.js","barcode-tester.css","barcode-tester-core.js"])
  assert.ok(deploy.includes(f),"New tester asset must be deployed: "+f);

class FakeElement{
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();this.value="";this.textContent="";
    this.hidden=false;this.disabled=false;this.open=false;this.readyState=4;
    this.children=[];this.listeners={};this.className="";
    this.classList={toggle(){},add(){},remove(){}};
  }
  addEventListener(name,callback){this.listeners[name]=callback}
  fire(name){assert.ok(this.listeners[name],"Missing listener "+name);this.listeners[name]({preventDefault(){}})}
  replaceChildren(...items){this.children=items}
  append(...items){this.children.push(...items)}
  pause(){}
  showModal(){this.open=true}
  close(){this.open=false}
}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
const nodes=Object.fromEntries(ids.map(id=>[id,new FakeElement()]));
const owner="test-owner",dbCalls=[];
const db={
  auth:{
    getSession:async()=>({data:{session:{user:{id:owner,email:"test@example.com"}}},error:null}),
    onAuthStateChange(){},
    signInWithPassword:async()=>({data:{user:{id:owner,email:"test@example.com"}},error:null}),
    signOut:async()=>({error:null})
  },
  from(table){
    const where={};let range=[0,499];
    const request={
      select(){return this},
      eq(field,val){where[field]=val;return this},
      order(){return this},
      range(a,b){range=[a,b];return Promise.resolve(finish())},
      limit(){return Promise.resolve(finish())}
    };
    function finish(){
      dbCalls.push({table,where:{...where}});
      if(table==="barcode_learning_profiles")return {data:all,error:null};
      if(table==="barcode_learning_examples")
        return {data:where.barcode==="9667815052900"?[
          {profile_id:"bf",barcode:"9667815052900",weight_grams:1175,
          total_price_fils:5290,verified_from_label:true}]:[],error:null};
      if(table==="custom_barcode_items"||table==="meat_barcode_catalog")
        return {data:[],error:null};
      throw Error("Unexpected table "+table);
    }
    return request;
  }
};
const doc={
  getElementById:id=>{assert.ok(nodes[id],"Missing DOM id "+id);return nodes[id]},
  createElement:tag=>new FakeElement(tag),
  addEventListener(){}
};
const win={
  BarcodeLearningCore:core,BarcodeTesterCore:tester,
  supabase:{createClient:()=>db},addEventListener(){},isSecureContext:false
};
vm.runInNewContext(js,{window:win,document:doc,navigator:{}},{filename:"barcode-tester.js"});
async function flush(){for(let i=0;i<90;i++)await Promise.resolve()}
(async()=>{
  await flush();
  assert.equal(nodes.testerWorkspace.hidden,false);
  assert.match(nodes.testerProfileCount.textContent,/3 earlier|1 earlier/);
  nodes.testerBarcode.value="9667812095207";
  nodes.testerForm.fire("submit");
  await flush();
  assert.equal(nodes.testerResults.hidden,false);
  assert.match(nodes.testerResultsTitle.textContent,/9667812095207/);
  assert.equal(nodes.testerMatches.children.length,1);
  assert.match(nodes.testerMatches.children[0].children[0].children[0].children[0].textContent,/6781/);
  nodes.testerBarcode.value="9667815052900";
  nodes.testerForm.fire("submit");
  await flush();
  assert.equal(nodes.testerMatches.children.length,1);
  assert.match(nodes.testerMatches.children[0].children[0].children[1].textContent,/Confirmed training label/);
  assert.ok(dbCalls.some(c=>c.table==="barcode_learning_examples"&&
    c.where.barcode==="9667815052900"&&c.where.owner_id===owner));
  assert.ok(dbCalls.some(c=>c.table==="barcode_learning_profiles"&&c.where.owner_id===owner));
  console.log("Universal Barcode Tester passed: no profile selector, learned 6781 example, confirmed label, archived prices, conflict warnings, other saved records, read-only automatic lookup.");
})().catch(err=>{console.error(err);process.exitCode=1});
