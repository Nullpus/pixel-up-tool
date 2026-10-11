const $ = id => document.getElementById(id);
const drop = $('drop'), fileIn = $('file'), modeEl = $('mode'), scaleEl = $('scale'), scaleNum = $('scaleNum');
const sizeBy = $('sizeBy'), sizeW = $('sizeW'), sizeH = $('sizeH'), fitMode = $('fitMode'), lockAspect = $('lockAspect');
const MAX_PIXELS = 16384 * 16384 / 4; // 安全上限
let src = null;       // 現在の元画像 ImageData
let srcName = 'image';
let outCanvas = null;

// 倍率チップ
const chips = $('chips');
[2,3,4,6,8,10,16,32].forEach(n=>{
  const b=document.createElement('button');
  b.className='chip'; b.textContent=n+'x';
  b.onclick=()=>{scaleEl.value=scaleNum.value=n;render()};
  chips.appendChild(b);
});

drop.onclick=()=>fileIn.click();
fileIn.onchange=()=>fileIn.files[0]&&load(fileIn.files[0]);
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',ev=>{const f=ev.dataTransfer.files[0];f&&load(f)});
addEventListener('paste',ev=>{const f=[...ev.clipboardData.files].find(f=>f.type.startsWith('image/'));f&&load(f)});

function load(file){
  srcName=file.name.replace(/\.[^.]+$/,'')||'image';
  const img=new Image();
  img.onload=()=>{
    const c=document.createElement('canvas');
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    const x=c.getContext('2d',{willReadFrequently:true});
    x.imageSmoothingEnabled=false;
    x.drawImage(img,0,0);
    src=x.getImageData(0,0,c.width,c.height);
    URL.revokeObjectURL(img.src);
    $('detect').disabled=false;
    syncSizeFromScale();
    $('detectInfo').textContent='';
    render();
  };
  img.onerror=()=>{$('info').textContent='画像を読み込めませんでした。'};
  img.src=URL.createObjectURL(file);
}

// ニアレストで整数倍
function nearest(im,f){
  const w=im.width,h=im.height,W=w*f,H=h*f;
  const out=new ImageData(W,H);
  const s=new Uint32Array(im.data.buffer),d=new Uint32Array(out.data.buffer);
  for(let y=0;y<h;y++){
    const row=y*f*W;
    for(let x=0;x<w;x++){
      const v=s[y*w+x],o=row+x*f;
      for(let i=0;i<f;i++)d[o+i]=v;
    }
    for(let j=1;j<f;j++)d.copyWithin(row+j*W,row,row+W);
  }
  return out;
}

// Scale2x(AdvMAME2x): 補間せず既存色だけを使う
function scale2x(im){
  const w=im.width,h=im.height,W=w*2;
  const out=new ImageData(W,h*2);
  const s=new Uint32Array(im.data.buffer),d=new Uint32Array(out.data.buffer);
  const P=(x,y)=>s[Math.min(h-1,Math.max(0,y))*w+Math.min(w-1,Math.max(0,x))];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=P(x,y),a=P(x,y-1),b=P(x+1,y),c=P(x-1,y),dd=P(x,y+1);
    let e0=p,e1=p,e2=p,e3=p;
    if(c!==b&&a!==dd){
      if(a===c)e0=a;
      if(a===b)e1=b;
      if(dd===c)e2=c;
      if(dd===b)e3=b;
    }
    const o=y*2*W+x*2;
    d[o]=e0;d[o+1]=e1;d[o+W]=e2;d[o+W+1]=e3;
  }
  return out;
}

const pow2Floor = n => 1 << Math.floor(Math.log2(Math.max(1, n)));

// 指定サイズへニアレストでサンプリング(補間なし)
function resizeNearest(im,W,H){
  const w=im.width,h=im.height,out=new ImageData(W,H);
  const s=new Uint32Array(im.data.buffer),d=new Uint32Array(out.data.buffer);
  const xs=new Int32Array(W);
  for(let x=0;x<W;x++)xs[x]=Math.min(w-1,Math.floor((x+.5)*w/W));
  for(let y=0;y<H;y++){
    const sy=Math.min(h-1,Math.floor((y+.5)*h/H))*w;
    for(let x=0;x<W;x++)d[y*W+x]=s[sy+xs[x]];
  }
  return out;
}

// 透明な W×H の中央に im を置く
function padCenter(im,W,H){
  const out=new ImageData(W,H);
  const s=new Uint32Array(im.data.buffer),d=new Uint32Array(out.data.buffer);
  const ox=(W-im.width)>>1,oy=(H-im.height)>>1;
  for(let y=0;y<im.height;y++)d.set(s.subarray(y*im.width,(y+1)*im.width),(y+oy)*W+ox);
  return out;
}

// 整数倍 f で拡大(方式に応じて)
function upscale(im,f,mode){
  if(mode==='scale2x'){for(let k=f;k>1;k>>=1)im=scale2x(im)}
  else if(f>1)im=nearest(im,f);
  return im;
}

function setInfo(t){$('info').textContent=t}

function render(){
  if(!src)return;
  const mode=modeEl.value,by=sizeBy.value;
  let note='',im;
  const tooBig=(W,H)=>W*H>MAX_PIXELS||W>16384||H>16384;

  if(by==='scale'){
    let f=Math.max(1,Math.round(+scaleEl.value)||1);
    if(mode==='scale2x'&&(f&(f-1))!==0){
      f=pow2Floor(f);
      note='Scale2xは2の累乗倍のみのため '+f+'x に調整しました。';
    }
    scaleEl.value=scaleNum.value=f;
    [...chips.children].forEach(c=>c.classList.toggle('on',c.textContent===f+'x'));
    if(tooBig(src.width*f,src.height*f)){
      setInfo('出力が大きすぎます('+src.width*f+'×'+src.height*f+')。倍率を下げてください。');
      $('dl').disabled=true;return;
    }
    im=upscale(src,f,mode);
  }else{
    const W=Math.max(1,Math.round(+sizeW.value)||1),H=Math.max(1,Math.round(+sizeH.value)||1);
    if(tooBig(W,H)){
      setInfo('出力が大きすぎます('+W+'×'+H+')。サイズを小さくしてください。');
      $('dl').disabled=true;return;
    }
    const r=Math.min(W/src.width,H/src.height);
    if(r<1){
      setInfo('元画像('+src.width+'×'+src.height+')より小さいサイズは指定できません(縮小は対象外)。');
      $('dl').disabled=true;return;
    }
    if(fitMode.value==='stretch'){
      // 整数倍でできるところまで拡大してから、残りをニアレストで指定サイズへ
      let f=Math.floor(Math.max(W/src.width,H/src.height));
      if(mode==='scale2x')f=pow2Floor(f);
      if(f>=2&&W%src.width===0&&H%src.height===0&&W/src.width===f&&H/src.height===f){
        im=upscale(src,f,mode);
      }else{
        const base=upscale(src,mode==='scale2x'?pow2Floor(Math.floor(r)):1,mode);
        im=resizeNearest(base,W,H);
        if(W*src.height!==H*src.width||W%src.width||H%src.height)
          note='整数倍にならないため、ドットの幅が1px単位で不揃いになります。きれいに揃えたい場合は「整数倍+余白」を使ってください。';
      }
    }else{
      let f=Math.floor(r);
      if(mode==='scale2x')f=pow2Floor(f);
      im=padCenter(upscale(src,f,mode),W,H);
      note=f+'x に拡大し、余白(透明)で '+W+'×'+H+' に合わせました。';
    }
  }
  outCanvas=document.createElement('canvas');
  outCanvas.width=im.width;outCanvas.height=im.height;
  outCanvas.getContext('2d').putImageData(im,0,0);
  show();
  $('size').textContent=src.width+'×'+src.height+' → '+im.width+'×'+im.height+' px';
  setInfo(note);
  $('dl').disabled=false;
}

function show(){
  const st=$('stage');
  st.innerHTML='';
  if(!outCanvas)return;
  const v=outCanvas;
  if($('fit').checked){
    v.style.maxWidth='100%';v.style.height='auto';
  }else{
    v.style.maxWidth='none';v.style.height='';
  }
  st.appendChild(v);
}

// 既に拡大済みのドット絵の「1ドットの大きさ」を推定(同色連続長の最大公約数)
function detectPixelSize(im){
  const w=im.width,h=im.height,s=new Uint32Array(im.data.buffer);
  const gcd=(a,b)=>{while(b){[a,b]=[b,a%b]}return a};
  let g=0;
  for(let y=0;y<h&&g!==1;y++){
    let run=1;
    for(let x=1;x<=w;x++){
      if(x<w&&s[y*w+x]===s[y*w+x-1])run++;
      else{g=gcd(g,run);run=1;if(g===1)break}
    }
  }
  let g2=0;
  for(let x=0;x<w&&g2!==1;x++){
    let run=1;
    for(let y=1;y<=h;y++){
      if(y<h&&s[y*w+x]===s[(y-1)*w+x])run++;
      else{g2=gcd(g2,run);run=1;if(g2===1)break}
    }
  }
  return gcd(g,g2)||1;
}

$('detect').onclick=()=>{
  const n=detectPixelSize(src);
  const box=$('detectInfo');
  if(n<=1){box.textContent='拡大済みの形跡は見つかりませんでした(等倍のドット絵です)。ジャギーや圧縮ノイズのある画像は検出できません。';return}
  box.innerHTML='1ドット = '+n+'px と検出しました。<br>';
  const b=document.createElement('button');
  b.className='sub';b.textContent='等倍('+(src.width/n)+'×'+(src.height/n)+')に戻して使う';
  b.onclick=()=>{
    const w=src.width/n,h=src.height/n,out=new ImageData(w,h);
    const s=new Uint32Array(src.data.buffer),d=new Uint32Array(out.data.buffer);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)d[y*w+x]=s[y*n*src.width+x*n];
    src=out;syncSizeFromScale();box.textContent='等倍に戻しました。倍率を選んで再拡大できます。';render();
  };
  box.appendChild(b);
};

$('dl').onclick=()=>{
  if(!outCanvas)return;
  outCanvas.toBlob(b=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(b);
    a.download=srcName+'_'+outCanvas.width+'x'+outCanvas.height+'.png';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },'image/png');
};

// 倍率スライダー / 数値入力 / サイズ指定の連動
function syncSizeFromScale(){
  const f=Math.max(1,Math.round(+scaleNum.value)||1);
  sizeW.value=src.width*f;sizeH.value=src.height*f;
}
function updateBy(){
  const sc=sizeBy.value==='scale';
  $('scaleBox').hidden=!sc;$('sizeBox').hidden=sc;
  render();
}
scaleEl.oninput=()=>{scaleNum.value=scaleEl.value;if(src)syncSizeFromScale();render()};
scaleNum.oninput=()=>{scaleEl.value=Math.min(32,+scaleNum.value||1);if(src)syncSizeFromScale();render()};
sizeW.oninput=()=>{if(lockAspect.checked&&src)sizeH.value=Math.round(sizeW.value*src.height/src.width);render()};
sizeH.oninput=()=>{if(lockAspect.checked&&src)sizeW.value=Math.round(sizeH.value*src.width/src.height);render()};
sizeBy.onchange=updateBy;
fitMode.onchange=render;
modeEl.onchange=render;
$('fit').onchange=show;
