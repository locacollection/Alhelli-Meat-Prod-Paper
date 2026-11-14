const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("scanner.js","utf8");

class FakeElement {
  constructor(){this.value="";this.className="";this.textContent="";this.disabled=false;this.children=[];this.dataset={};this.classList={toggle(){},add(){},remove(){}}}
  replaceChildren(...v){this.children=v}
  append(...v){this.children.push(...v)}
  addEventListener(){}
  querySelector(){return new FakeElement()}
  setAttribute(){}
}
const elements = new Map();
const getId=id=>{if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id)};
const doc = {
  getElementById:getId,
  createElement:()=>new FakeElement(),
  querySelector:(q)=>q.includes("materialMode")?{value:"no-bones",checked:true}:new FakeElement(),
  querySelectorAll:()=>[]
};
const store = new Map();
const sandbox = {
  document:doc,window:{},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  console,Date,confirm:()=>true
};
vm.runInNewContext(source,sandbox,{filename:"scanner.js",timeout:2000});
const {decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,shouldAutoConfirm}=sandbox.window.MeatProductionChecks;
assert.equal(readUniqueDecimal("WEIGHT 1.000"),"1.000");
assert.equal(readUniqueDecimal("UNIT PRICE 4.500"),"4.500");
assert.equal(readUniqueDecimal("1.000 4.500"),"");
const mincedOCR=ocrFields("PAKISTANI BEEF MIN KG\nWEIGHT 1.000 UNIT PRICE 4.500\nTOTAL PRICE 4.500",decode("9667802045007"));
assert.equal(mincedOCR.weight,"1.000");
assert.equal(mincedOCR.unit,"4.500");
assert.equal(mincedOCR.printed,"4.500");
const bonelessOCR=ocrFields("PAK BEEF W/OUT BONE\nWEIGHT 1.000 UNIT PRICE 4.500\nTOTAL PRICE 4.500",decode("9667812045004"));
assert.equal(bonelessOCR.weight,"1.000");
assert.equal(bonelessOCR.printed,"4.500");
assert.equal(fixed3("3.500"),3500);
assert.equal(fixed3("6.500"),6500);
assert.equal(fixed3("bad"),null);
assert.equal(roundedPrice(505,4500),2275);
assert.equal(roundedPrice(100,3190),320);
assert.equal(roundedPrice(3500,4500),15750);
assert.equal(roundedPrice(6500,4500),29250);
const samples=[
 ["9667771003206",null],
 ["9667800022758",2275],
 ["9667802045007",4500],
 ["9667812045004",4500],
 ["9667806157508",15750],
 ["9667818292501",29250]
];
for(const [code,price] of samples){
 if(price===null)continue;const data=decode(code);
 assert.equal(data.error,undefined,code+": "+data.error);
 assert.equal(data.price,price);
 assert.equal(priceVerifier(price),Number(code[6]));
 assert.equal(checkDigit(code.slice(0,12)),Number(code[12]));
}
for(const x of [
 {barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.750"},
 {barcode:"9667818292501",weight:"6.500",unit:"4.500",printed:"29.250"}
])assert.equal(verify(x).ok,true,JSON.stringify(verify(x)));
assert.equal(verify({barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.745"}).ok,false);
const missingWeight=verify({barcode:"9667812045004",weight:"",unit:"4.500",printed:"4.500"});
assert.equal(missingWeight.ok,false);
assert.match(missingWeight.reason,/Printed weight missing/);
assert.match(missingWeight.reason,/approximately 1.000 kg/);
assert.equal(verify({barcode:"9667812045004",weight:"1.000",unit:"4.500",printed:"4.500"}).ok,true);
const automaticMinced={barcode:"9667802045007",weight:"1.000",unit:"4.500",printed:"4.500"};
const automaticBoneless={barcode:"9667812045004",weight:"1.000",unit:"4.500",printed:"4.500"};
assert.equal(shouldAutoConfirm(automaticMinced,true,3),true);
assert.equal(shouldAutoConfirm(automaticBoneless,true,3),true);
assert.equal(shouldAutoConfirm(automaticMinced,false,3),false);
assert.equal(shouldAutoConfirm(automaticMinced,true,2),false);
assert.equal(shouldAutoConfirm({...automaticMinced,weight:"3.500"},true,3),false);
assert.equal(shouldAutoConfirm({...automaticBoneless,printed:"15.750"},true,3),false);
assert.equal(fixed3(automaticMinced.weight)+fixed3(automaticBoneless.weight),2000);

assert.equal(verify({barcode:"9667806157508",weight:"3.400",unit:"4.500",printed:"15.750"}).ok,false);
assert.equal(verify({barcode:"9667806157500",weight:"3.500",unit:"4.500",printed:"15.750"}).ok,false);
assert.equal(verify({barcode:"9667770031903",weight:"1.000",unit:"3.190",printed:"3.190"}).ok,false);
console.log("Scanner validation tests passed: verified EAN, internal price digit, rounding, label consistency, and product constraints.");
