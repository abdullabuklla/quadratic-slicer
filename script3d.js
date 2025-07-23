/* Quadric level-set slicer — p5.js 1.9.0  (transparent plane + gradient dots) */

const SCALE       = 40;     // 1 scene unit → 40 px
const GRID_SPAN   = 10;     // half-width of ground & plane
const EPS         = 0.02;   // slice thickness
const PLANE_ALPHA = 8;      // plane opacity (%)

let ui = {}, z = 0, zFunc, traces = [], glide = 0, anim = { go:false, t:0 };

let uiFont, mathFont;

let orbitEnabled = true;        // 3‑D camera active by default

let pg2,  // off-screen graphics for drawing the curve
    zoom = 1, panX = 0, panY = 0,
    traces2d = [];       // frozen 2-D curves

// preview p5 instance
let zoom2D  = 0.4;
let pan2DX  = 0;
let pan2DY  = 0;

function preload() {
    uiFont = loadFont('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf');

    /* full math glyph set, Times‑like design */
    mathFont = loadFont(
        'https://cdn.jsdelivr.net/gh/stipub/stixfonts@v2.13/fonts/static_otf/STIXTwoMath-Regular.otf'
    );}

/* Storing user's device details in a variable*/
let details = navigator.userAgent;

/* Creating a regular expression
containing some mobile devices keywords
to search it in details string*/
let regexp = /android|iphone|kindle|ipad/i;

/* Using test() method to search regexp in details
it returns boolean value*/
let isMobile = regexp.test(details);



/* ───── INIT ───── */
function setup(){
    createCanvas(windowWidth, windowHeight, WEBGL);

    textFont(uiFont);      // ← avoids “load and set a font” warning
    colorMode(HSL,360,100,100,100);

    for(const id of [
        'minZ','maxZ','spd','grid','eq',
        'preset','animate','pause','reset','zSlide','surfTxt',  'show2d'
    ]) ui[id] = select('#'+id);

    ui.preset.changed(()=>{ ui.eq.value(ui.preset.value()); rebuild(); });
    ui.eq.changed(rebuild);
    ui.minZ.changed(()=>{ syncSlider(); updateLegendLabels(); });
    ui.maxZ.changed(()=>{ syncSlider(); updateLegendLabels(); });

    ui.animate.mousePressed(() => {
        /* start at min-z and move toward max-z (or vice-versa)               */
        const min = +ui.minZ.value();
        const max = +ui.maxZ.value();

        anim.dir = Math.sign(max - min) || 1;   // +1 upward, –1 downward
        anim.go  = true;
        setZ(min);
    });
    ui.pause.mousePressed(()=>{ anim.go=false; glide=0; });
    ui.reset.mousePressed(()=>{ anim.go=false; glide=0; traces.length=0; setZ(+ui.minZ.value());

        traces2d.length = 0;     // ⬅ NEW
        zoom2D  = 0.4;             // recenter & reset zoom
        pan2DX  = 0;
        pan2DY  = 0;

    });
    ui.zSlide.input(()=> setZ(+ui.zSlide.value()));
    {
        const slider = ui.zSlide.elt;             // the <input type="range">

        /* pointer goes down on the slider → disable orbitControl */
        slider.addEventListener('pointerdown', e => {
            orbitEnabled = false;
            e.stopPropagation();                    // keep event off the canvas
        }, {passive:true});

        /* pointer released anywhere → enable orbitControl again */
        window.addEventListener('pointerup', () => { orbitEnabled = true; },
            {passive:true});
    }


    rebuild(); syncSlider(); updateLegendLabels();

    /* ───────────── 2‑D preview panel (independent zoom & pan) ───────────── */
    new p5(p => {
        /* create the square canvas once */
        p.setup = () => {
            const side = select('#preview2d').width;           // 350 px by CSS
            p.createCanvas(side, side).parent('preview2d');
            p.colorMode(p.HSL, 360, 100, 100, 100);
            p.cursor('grab');
            pg2 = p;                                           // expose instance

            /* ── DOM listeners attached AFTER canvas exists ─────────────────── */
            const c = p.canvas;
            /* ---- wheel → zoom preview only ---- */
            c.addEventListener('wheel', e => {
                zoom2D = constrain(zoom2D * (e.deltaY > 0 ? 1 / 1.25 : 1.25), 0.3, 30);
                e.preventDefault();                // no page scroll
                e.stopPropagation();               // keep from orbitControl
            }, {passive: false});

            /* ---- pointer drag → pan preview only ---- */
            let lastX = 0, lastY = 0, dragging = false;

            c.addEventListener('pointerdown', e => {
                orbitEnabled = false;              // ⬅ disable 3‑D camera
                dragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                p.cursor('grabbing');
                c.setPointerCapture(e.pointerId);
            });

            c.addEventListener('pointermove', e => {
                if (!dragging) return;
                pan2DX += (e.clientX - lastX) / zoom2D;
                pan2DY += (e.clientY - lastY) / zoom2D;  // Y flipped later

                lastX = e.clientX;
                lastY = e.clientY;
            });

            function stopDrag(e) {
                dragging = false;
                orbitEnabled = true;               // ⬅ re‑enable 3‑D camera
                p.cursor('grab');
                c.releasePointerCapture(e.pointerId);
            }

            c.addEventListener('pointerup', stopDrag);
            c.addEventListener('pointercancel', stopDrag);
        }
    });




    /* show / hide the panel via checkbox */
    ui.show2d.changed(() => {
        select('#preview2d').style('display',
            ui.show2d.checked() ? 'block' : 'none');
    });

    if (isMobile) {
        select('#mobileControls').style('display', 'flex');
    }

    select('#btnUp').mousePressed(() => {
        glide=+1
    });

    select('#btnDown').mousePressed(() => {
        glide=-1
    });

    select('#btnSpace').mousePressed(() => {
        const t3d = captureSlice();
        traces.push(t3d);
        const col2d = pg2.color(t3d.col.toString());
        traces2d.push(sliceDots2d(z, col2d));
    });



}

function syncSlider(){ ui.zSlide.attribute('min',ui.minZ.value()); ui.zSlide.attribute('max',ui.maxZ.value()); }

function rebuild(){
    try{ zFunc = new Function('x','y',`return ${ui.eq.value()};`); }
    catch{ zFunc = ()=>0; alert('Bad f(x,y) expression'); }
    ui.surfTxt.html('f(x,y) = ' + pretty(ui.eq.value()));
    traces.length = 0;
    updateLegendLabels();
    traces2d.length= 0;       // ⬅ NEW: clear preview traces
    zoom2D = 0.4; pan2DX = pan2DY = 0;   // ⬅ NEW: recenter preview
}

/* ───── DRAW LOOP ───── */
function draw () {
    const dt = deltaTime / 1000;

    /* ─── scene setup ─── */
    background('#120016');
    if (orbitEnabled) orbitControl();  // disabled while dragging preview

    scale(1, 1, -1);
    scale(0.8);

    rotateX( PI / 1.5);                  // +90° : +Z becomes “up”
    rotateZ(-PI / 1.5);                  // –45° yaw for depth
    // rotateY(PI / 6);                  // –30° pitch (like before)



    /* ─── continuous key-glide ─── */
    if (glide) setZ(z + glide * +ui.spd.value() * dt);

    /* ─── auto-sweep animation ─── */
    if (anim.go) {
        const dz = anim.dir * +ui.spd.value() * dt;   // dt = deltaTime/1000
        setZ(z + dz);

        /* stop when the plane reaches the target end-z                       */
        if ((anim.dir > 0 && z >= +ui.maxZ.value()) ||
            (anim.dir < 0 && z <= +ui.minZ.value())) {
            anim.go = false;
        }
    }



    /* ─── draw scene ─── */
    drawGrid();
    drawAxes();

    traces.forEach(drawDots);          // draw frozen slices **before** plane

    drawLiveSlice();                   // mint→aqua current slice

    drawSlicePlane();                  // semi-transparent slice

    drawHUD();                         // top-left text


    /* -------- 2-D preview ---------- */
    /* ---------- 2‑D preview panel ---------- */
    if (pg2) {
        pg2.push();
        pg2.background('#111');

        pg2.translate(pg2.width/2 + pan2DX * zoom2D,
            pg2.height/2 + pan2DY * zoom2D);
        pg2.scale(zoom2D, -zoom2D);


        /* ───── grid ───── */
        /* ─── subtle grey grid ─── */
        const span  = GRID_SPAN * SCALE;
        const gStep = SCALE;

        pg2.stroke( 200, 0, 70, 35 );          // light‑grey, 35 % opacity
        pg2.strokeWeight( 0.4 / zoom2D );
        for (let i = -span; i <= span; i += gStep) {
            pg2.line(i, -span, i, span);         // verticals
            pg2.line(-span, i, span, i);         // horizontals
        }

        /* ─── axes ─── */
        pg2.strokeWeight( 1.5 / zoom2D );
        pg2.stroke(0,100,50);   pg2.line(-span, 0, span, 0);     // X (orange‑red)
        pg2.stroke(120,100,50); pg2.line(0, -span, 0, span);     // Y (green)

        /* ---- ticks & faint integer labels (screen‑space text) ---- */
        const tick = 3 / zoom2D;                // tick length in world units
        const half = span / SCALE;              // GRID_SPAN

        pg2.strokeWeight(0.8 / zoom2D);
        pg2.stroke(180, 0, 80, 60);             // faint grey
        pg2.fill  (180, 0, 90, 60);
        pg2.textSize(7);                        // 7‑px regardless of zoom
        pg2.textAlign(pg2.CENTER, pg2.TOP);

        /* helper: world → screen */
        const toScreen = (wx, wy) => [
            pg2.width  / 2 + (wx + pan2DX) * zoom2D,
            pg2.height / 2 + (wy + pan2DY) * zoom2D   // minus because Y up in world
        ];

        /* X ticks + labels */
        for (let u = -half; u <= half; u++) {
            const wx = u * SCALE;
            pg2.line(wx, -tick, wx, tick);        // tick in world coords

            if (u !== 0 && Number.isInteger(u)) {
                const [sx, sy] = toScreen(wx, 0);
                pg2.resetMatrix();                  // switch to screen‑space
                pg2.text(u, sx, sy + 4);            // 4 px gap below the axis
                pg2.applyMatrix(zoom2D,0,0,-zoom2D,      // restore world transform
                    pg2.width/2 + pan2DX*zoom2D,
                    pg2.height/2 + pan2DY*zoom2D);
            }
        }

        /* Y ticks + labels */
        pg2.textAlign(pg2.LEFT, pg2.CENTER);
        for (let v = -half; v <= half; v++) {
            const wy = v * SCALE;
            pg2.line(-tick, wy, tick, wy);        // tick

            if (v !== 0 && Number.isInteger(v)) {
                const [sx, sy] = toScreen(0, wy);
                pg2.resetMatrix();
                pg2.text(v, sx + 4, sy);            // 4 px right of the axis
                pg2.applyMatrix(zoom2D,0,0,-zoom2D,
                    pg2.width/2 + pan2DX*zoom2D,
                    pg2.height/2 + pan2DY*zoom2D);
            }
        }




        /* ───── live curve ───── */
        drawDots2d(sliceDots2d(z));

        /* ───── frozen curves ───── */
        traces2d.forEach(drawDots2d);

        /* ───── equation & z‑value ───── */
        pg2.resetMatrix();
        pg2.noStroke();
        pg2.fill(220);  pg2.textAlign(pg2.CENTER, pg2.TOP);
        pg2.textSize(14);
        pg2.text(`${pretty(ui.eq.value())}  =  ${z.toFixed(2)}`,
            pg2.width/2, 6);

        pg2.pop();
    }

}


/* ---- helper that returns 2-D dot list ---- */
function sliceDots2d(level){
    const G    = +ui.grid.value();
    const span = GRID_SPAN;
    const st   = span / G;
    const arr  = [];

    for (let x = -span; x <= span; x += st)
        for (let y = -span; y <= span; y += st)
            if (Math.abs(zFunc(x, y) - level) < EPS)
                arr.push({x: x * SCALE, y: y * SCALE});

    // identical hue mapping as the 3‑D trace
    const hue = map(level, +ui.minZ.value(), +ui.maxZ.value(), 220, 0, true);
    const col = pg2.color(hue, 70, 70);        // make the colour *inside* pg2

    return {dots: arr, col, w: 2 / zoom};
}





function drawDots2d(o){
    pg2.stroke(o.col); pg2.strokeWeight(o.w);
    o.dots.forEach(p=> pg2.point(p.x, p.y));
}

/* ───── GEOMETRY ───── */
function drawGrid(){
    stroke(0,0,40,40); strokeWeight(1);
    const h=GRID_SPAN*SCALE, st=SCALE;
    for(let x=-h;x<=h;x+=st) line(x,-h,0, x,h,0);
    for(let y=-h;y<=h;y+=st) line(-h,y,0, h,y,0);
}

function drawAxes () {
    const L = GRID_SPAN * SCALE * 1.2;   // arrow length
    strokeWeight(2);

    /* +X  ──────→ */
    stroke(  0,100,50);                  // red-orange
    line(0,0,0,  L,0,0);                 // shaft
    push();
    translate(L,0,0);                    // arrow tip
    rotateZ(-HALF_PI);                   // cone’s +Y → +X
    cone(6,12);
    billboard('X', 12, 0, '#ffb700', 17, 'normal');
    pop();

    /* +Y  (down-screen in p5 WEBGL) */
    stroke(120,100,50);                  // green
    line(0,0,0,  0,L,0);
    push();
    translate(0,L,0);                    // cone already aims +Y, no rotation
    cone(6,12);
    billboard('Y', 0, 12, '#ffb700', 17, 'normal');
    pop();

    /* +Z  (out of screen — cone needs a quarter-turn) */
    stroke(220,100,50);                  // blue
    line(0,0,0,  0,0,L);
    push();
    translate(0,0,L);
    rotateX(HALF_PI);                    // cone’s +Y → +Z
    cone(6,12);
    rotateX(-HALF_PI);
    billboard('Z', 0, 12, '#ffb700', 17, 'normal');
    pop();
}

function axis(x,y,z,lab,h,s,l,rx=0){
    stroke(h,s,l); line(0,0,0, x,y,z);
    push(); translate(x,y,z); if(rx) rotateX(rx); rotateZ(-HALF_PI); cone(6,12);
    billboard(lab,12,0,'#ffb700',15,'bold'); pop();
}
function updateLegendLabels(){
    select('#zMax').html(+ui.maxZ.value());
    select('#zMin').html(+ui.minZ.value());
}

function drawSlicePlane () {

    /* 1 ── translucent plane ─────────────────────────── */
    push();
    translate(0, 0, z * SCALE);

    const gl = drawingContext;
    gl.disable(gl.DEPTH_TEST);          // plane & labels won't be depth-clipped
    noStroke();
    fill(0, 0, 100, PLANE_ALPHA);
    plane(GRID_SPAN * SCALE * 2);

    /* 2 ── bring labels in front of plane ────────────── */
    translate(0, 0, 20);               // 20 px toward camera guarantees visibility

    /* pretty equation */
    const lvl = z.toFixed(2);          // e.g.  4.50
    const eq  = pretty(ui.eq.value()); // e.g.  x² + y²

    /* 1st line -------------------------------------------------- */
    textFont(mathFont);
    textStyle(ITALIC);
    fill(30,100,60);
    billboard(`${'z ='} ${pretty2(lvl)}`, 0, -18);

    /* 2nd line -------------------------------------------------- */
    textFont(mathFont);       // or any default font you prefer
    textStyle(ITALIC);      // give the whole string an italic slant
    textSize(18);
    billboard(`${pretty2(ui.eq.value())} = ${pretty2(lvl)}`, 0, 4);



    gl.enable(gl.DEPTH_TEST);          // restore for rest of scene
    pop();
}













function drawLiveSlice(){
    const G=+ui.grid.value(), span=GRID_SPAN, step=span/G;
    strokeWeight(4);
    for(let x=-span;x<=span;x+=step) for(let y=-span;y<=span;y+=step){
        const v=zFunc(x,y); if(isFinite(v)&&abs(v-z)<EPS){
            const hue=map(Math.hypot(x,y),0,span,140,190);   // ← Math.hypot fixes error
            stroke(hue,60,70); point(x*SCALE,y*SCALE,z*SCALE);
        }
    }
}
function drawDots (o) {
    const gl = drawingContext;
    // gl.disable(gl.DEPTH_TEST);          // ⬅️ let points show through plane

    stroke(o.col);
    strokeWeight(o.w);
    beginShape(POINTS);
    o.dots.forEach(p => vertex(...p));
    endShape();

    // gl.enable(gl.DEPTH_TEST);           // ⬅️ restore for the rest of the frame
}







/* ───── LABELS & HUD ───── */
function billboard(
    txt,                     // text to draw
    offX = 0, offY = 0,      // pixel offsets on the plane
    col  = '#ffb700',        // fill colour
    sz   = 14,               // font size
    weight = 'normal'
){
    push();
    rotateZ(PI / 1.5);       // undo scene yaw
    rotateX(-PI / 2);        // face camera
    translate(offX, offY, 4);
    textSize(sz);
    textStyle(weight);
    textAlign(CENTER, CENTER);

    /* --- white “outline” made of 8 neighbours --- */
    fill('#570075');
    const o = 1;             // outline thickness in pixels
    for (let dx = -o; dx <= o; dx++) {
        for (let dy = -o; dy <= o; dy++) {
            if (dx === 0 && dy === 0) continue;   // skip centre
            text(txt, dx, dy);
        }
    }

    /* --- coloured text on top --- */
    fill(col);
    text(txt, 0, 0);

    pop();
}








function drawHUD(){
    push();
    translate(-width/2+12,-height/2+14,0);
    rotateY(-rotationY); rotateX(-rotationX);
    fill('#7cf'); noStroke(); textSize(15); textAlign(LEFT,TOP);
    // text(pretty(ui.eq.value()),0,0); text('= '+z.toFixed(2),0,18); pop();
}

/* ───── INPUT ───── */
function setZ(v){ z=constrain(v,+ui.minZ.value(),+ui.maxZ.value()); ui.zSlide.value(z); }
function keyPressed(){
    if (key===' ' && !typing()) {
        const t3d = captureSlice();                   // 3‑D trace (colour set)
        traces.push(t3d);

        const col2d = pg2.color(t3d.col.toString());  // identical hue
        traces2d.push(sliceDots2d(z, col2d));
    }



    if(keyCode===UP_ARROW)   glide=+1;
    if(keyCode===DOWN_ARROW) glide=-1;


}
function keyReleased(){ if([UP_ARROW,DOWN_ARROW].includes(keyCode)) glide=0; }
const typing=()=>['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName);
function windowResized(){ resizeCanvas(windowWidth,windowHeight); }







/* ───── HELPERS ───── */
function pretty(expr){
    return expr
        .replace(/x\*x/g, 'x²')
        .replace(/y\*y/g, 'y²')
        .replace(/\bsqrt\(/g, '√(')
        .replace(/\*/g, '·')
        .replace(/\b(x|y)\b/g, (m)=>m)    // placeholder – italics come from font
}

// pretty(): JS expression → compact math w/ ASCII only
// function pretty2(expr){
//     return expr
//         /* x*x  →  x^2   and   y*y → y^2 */
//         .replace(/\bx\*x\b/g, 'x^2')
//         .replace(/\by\*y\b/g, 'y^2')
//
//         /* sqrt(  →  √(    (kept; delete this line if your font lacks √) */
//         .replace(/\bsqrt\(/g, '√(')
//
//         /* every other *  →  ×   (ASCII letter “x”; clearer than middle-dot) */
//         .replace(/\*/g, ' × ')
//
//         /* squeeze redundant spaces */
//         .replace(/\s+/g, ' ')
//         .trim();
//
// }


/* ── superscript helper (once) ───────────────────────────── */
const SUP = {0:"⁰",1:"¹",2:"²",3:"³",4:"⁴",5:"⁵",
    6:"⁶",7:"⁷",8:"⁸",9:"⁹","-":"⁻"};
const toSup = n => [...String(n)].map(c => SUP[c] ?? c).join("");

/* ── pretty2: JS expression → readable math  ─────────────── */
function pretty2(expr){
    expr = String(expr).trim();                 // ensure string, trim ends

    return expr
        /* x*x → x² , y*y → y² */
        .replace(/\bx\*x\b/gi, 'x²')
        .replace(/\by\*y\b/gi, 'y²')

        /* plain *  → middle‑dot · */
        .replace(/\*/g, ' · ')

        /* sqrt(  or  Math.sqrt(  →  √(   (any case, spaces allowed) */
        .replace(/\b(?:Math\.)?sqrt\s*\(/gi, '√(')

        /* ^integer  → superscript integer */
        .replace(/\^(-?\d+)/g, (_, n) => toSup(n))

        /* collapse multiple spaces */
        .replace(/\s+/g, ' ')
        .trim();
}





function captureSlice(){
    const G   = +ui.grid.value(),
        span = GRID_SPAN,
        st   = span / G,
        arr  = [];

    for (let x = -span; x <= span; x += st)
        for (let y = -span; y <= span; y += st)
            if (Math.abs(zFunc(x, y) - z) < EPS)      // ← use zFunc here
                arr.push([x * SCALE, y * SCALE, z * SCALE]);

    /* hue: blue (220) at minZ  →  red (0) at maxZ */
    const hue = map(z, +ui.minZ.value(), +ui.maxZ.value(), 220, 0, true);
    return { dots: arr, col: color(hue, 70, 70), w: 5 };
}


