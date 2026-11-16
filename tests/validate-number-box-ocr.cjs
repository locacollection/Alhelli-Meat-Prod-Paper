const assert=require("node:assert/strict");
const photo=require("../barcode-learning-scan.js");
const labels=require("../barcode-learning-labels.js");
let crops=0,recognitions=0,updates=0;
global.document={
  createElement(tag){
    if(tag!=="canvas")throw new Error("Unexpected element "+tag);
    const canvas={width:0,height:0};
    const context={
      imageSmoothingEnabled:false,
      drawImage(){crops++},
      getImageData(x,y,width,height){
        const data=new Uint8ClampedArray(width*height*4);
        for(let i=0;i<data.length;i+=4){
          data[i]=data[i+1]=data[i+2]=210;data[i+3]=255;
        }
        return {data,width,height};
      },
      putImageData(image){assert.ok(image.data.length>0)}
    };
    canvas.getContext=()=>context;
    return canvas;
  }
};
(async()=>{
  const readings=["0.460","2.100","0.965"];
  const worker={
    async setParameters(opts){
      updates++;
      assert.ok(opts.tessedit_pageseg_mode==="7"||opts.tessedit_pageseg_mode==="3");
    },
    async recognize(){
      const text=readings[recognitions++]||"";
      return {data:{text}};
    }
  };
  const canvas={width:630,height:390};
  const anchor={x:80,y:210,w:170,h:18};
  const got=await photo.readNumberBoxes(worker,canvas,anchor,labels,()=>{},{});
  assert.deepEqual(got.values,{weight:460,unit:2100,total:965});
  assert.equal(recognitions,3);
  assert.equal(updates,6);
  assert.ok(crops>=6);
  const filled=labels.supplementPrinted({
    weight_grams:null,unit_price_fils:null,total_price_fils:null,
    read_from_photo:{weight:false,unit:false,total:false}
  },got.values);
  assert.equal(filled.weight_grams,460);
  assert.equal(filled.unit_price_fils,2100);
  assert.equal(filled.total_price_fils,965);
  console.log("Numeric cell OCR passed: isolated sticker fields, high-contrast upscaling, and missing-field recovery.");
})().catch(err=>{console.error(err);process.exitCode=1});
