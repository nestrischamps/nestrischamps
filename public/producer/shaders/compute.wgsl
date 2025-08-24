// ============================================
// WebGPU OCR Compute Shaders
// ============================================

///////////////////////////////////////////////
// Shared helpers
///////////////////////////////////////////////

fn luma(rgb: vec3<f32>) -> f32 {
  // Rec.601 weights
  return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

///////////////////////////////////////////////
// Pipeline 1: Digit matching
// 
// This assumes the digits were processed to greyscale (i.e. lumas)
// during the render pass. That means we can OCR ALL digits in one go 
// for ALL digit fields (i.e. score / lines / level / das / piece stats)
// Take a look at wwgpuTetrisOCR for details.
//
///////////////////////////////////////////////

@group(0) @binding(0) var inputTex_match: texture_2d<f32>;

struct MatchGlobals {
  texWidth:  u32,   // input texture width
  texHeight: u32,   // input texture height
  digitSize: u32,   // 14
  refStride: u32,   // 14*14 = 196
  numJobs:   u32,   // number of match jobs
  numRefs:   u32,   // total reference digits available
  _pad0:     u32,
  _pad1:     u32,
};
@group(0) @binding(1) var<uniform> M: MatchGlobals;

struct MatchJob { // one job = compare one patch vs one reference index
  x: u32, // top-left of 14×14 patch in the input texture
  y: u32,
  refIndex: u32, // which template to compare against
  _pad: u32,
};
@group(0) @binding(2) var<storage, read> matchJobs: array<MatchJob>;

// Flattened reference digits, each is 14×14 luma, stored row-major
// Length = M.numRefs * M.refStride
@group(0) @binding(3) var<storage, read> refDigits: array<f32>;

struct MatchOut {
  sse: f32, // sum of squared luma diffs
};
@group(0) @binding(4) var<storage, read_write> matchOut: array<MatchOut>;

fn loadTexelClamped(x: i32, y: i32) -> vec4<f32> {
  let cx = clamp(x, 0, i32(M.texWidth) - 1);
  let cy = clamp(y, 0, i32(M.texHeight) - 1);
  return textureLoad(inputTex_match, vec2<i32>(cx, cy), 0);
}

@compute @workgroup_size(64)
fn match_digits(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= M.numJobs) { return; }

  let job = matchJobs[idx];
  let base = job.refIndex * M.refStride;

  var sumSq: f32 = 0.0;
  let ds = i32(M.digitSize);
  for (var dy: i32 = 0; dy < ds; dy = dy + 1) {
    let ty = i32(job.y) + dy;
    let rowOff = u32(dy) * M.digitSize;
    for (var dx: i32 = 0; dx < ds; dx = dx + 1) {
      let tx = i32(job.x) + dx;
      let pix = loadTexelClamped(tx, ty);
      let L = luma(pix.rgb);
      let refL = refDigits[base + rowOff + u32(dx)];
      let d = L - refL;
      sumSq = sumSq + d * d;
    }
  }

  matchOut[idx].sse = sumSq;
}

///////////////////////////////////////////////
// Pipeline 2: Board analysis, all-in-one
//
// Specifically:
// - inspect 200 board blocks for colors and shines
// - inspect 3 reference colors
// - inspect a set of posiible block locations for shines 
//     - that's for preview (all roms) and cur_piece (das_trainer)
// 
// Note: ref color tasks are always done even when we
// they are not needed, but it's fine, it's more trouble
// to optimize them away than to run them in parallel with
// everything else on the gpu
//
///////////////////////////////////////////////

@group(0) @binding(0) var inputTex_board: texture_2d<f32>;

struct BoardGlobals {
  texWidth:      u32,
  texHeight:     u32,
  threshold255:  u32, // shine threshold in 0..255, avoids f32 in uniforms
  numBlocks:     u32, // 200
  numRefBlocks:  u32, // 3
  numShineSpots: u32, // 28
  _pad0:         u32,
};
@group(0) @binding(1) var<uniform> B: BoardGlobals;

struct IVec2 { x: i32, y: i32, };

// Top-left positions for the 200 board blocks
@group(0) @binding(2) var<storage, read> boardPos: array<IVec2>;

// Shared offsets used by tasks
struct Offsets {
  boardColorOffsets:      array<IVec2, 4>,   // relative to a board block top-left
  boardShineOffsets:      array<IVec2, 3>,
  refColorOffsets:        array<IVec2, 3>,   // relative to a ref block top-left
  pieceBlockShineOffsets: array<IVec2, 3>,   // relative to a shine-spot top-left
};
@group(0) @binding(3) var<storage, read> offs: Offsets;

// Output slabs, fixed max sizes
struct BoardOutputs {
  boardColors: array<u32, 200>, // RGBS, S is the shine (hijacking alpha!)
  refColors:   array<u32, 3>,
  shine:       array<u32, 28>,  // 0 or 1
};
@group(0) @binding(4) var<storage, read_write> outBuf: BoardOutputs;

// Positions for 3 reference blocks, top-left
@group(0) @binding(5) var<storage, read> refBlockPos: array<IVec2>;

// Positions for 28 shine-only checks, top-left
@group(0) @binding(6) var<storage, read> shinePos: array<IVec2>;

fn loadTexelClampedB(x: i32, y: i32) -> vec4<f32> {
  let cx = clamp(x, 0, i32(B.texWidth) - 1);
  let cy = clamp(y, 0, i32(B.texHeight) - 1);
  return textureLoad(inputTex_board, vec2<i32>(cx, cy), 0);
}

// 256 implies ALL tasks can run entirely in parallel (200 blocks + 3 ref colors + 28 shine spots)
@compute @workgroup_size(256)
fn analyze_everything(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  let thr = f32(B.threshold255) / 255.0;

  // 1) 200 board blocks: average color of 4 points, plus shine from any of 3 points
  if (id < B.numBlocks) {
    let p = boardPos[id];
    // Average 4 colors
    var sum = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: u32 = 0u; i < 4u; i = i + 1u) {
      let o = offs.boardColorOffsets[i];
      let c = loadTexelClampedB(p.x + o.x, p.y + o.y).rgb;
      sum = sum + c;
    }
    let avg = sum / 4.0;

    // Shine test on 3 points
    var s: f32 = 0.0;
    for (var j: u32 = 0u; j < 3u; j = j + 1u) {
      let o = offs.boardShineOffsets[j];
      let L = luma(loadTexelClampedB(p.x + o.x, p.y + o.y).rgb);
      if (L > thr) {
        s = 1.0;
        break;
      }
    }

    // bundle the rgb colors, and shine as alpha into a single u32
    outBuf.boardColors[id] = pack4x8unorm(vec4<f32>(avg, s));

    return;
  }

  // 2) 3 reference blocks: average 3 colors
  let refIdx = id - B.numBlocks;
  if (refIdx == 0) {
    // find the highest seen R, G, B from each pixels
    let p = refBlockPos[refIdx];
    var white = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: u32 = 0u; i < 3u; i = i + 1u) {
      let o = offs.refColorOffsets[i];
      let c = loadTexelClampedB(p.x + o.x, p.y + o.y).rgb;
      white = max(white, c);
    }
    outBuf.refColors[refIdx] = pack4x8unorm(vec4<f32>(white, 1.0));
    return;    
  }
  else if (refIdx < B.numRefBlocks) {
    // average colors at reference pixels
    let p = refBlockPos[refIdx];
    var sum = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: u32 = 0u; i < 3u; i = i + 1u) {
      let o = offs.refColorOffsets[i];
      let c = loadTexelClampedB(p.x + o.x, p.y + o.y).rgb;
      sum = sum + c;
    }
    let avg = sum / 3.0;
    outBuf.refColors[refIdx] = pack4x8unorm(vec4<f32>(avg, 1.0));
    return;
  }

  // 3) 28 shine-only spots(preview: 14, curPiece: 14): any of 3 points above threshold
  let sIdx = id - B.numBlocks - B.numRefBlocks;
  if (sIdx < B.numShineSpots) {
    let p = shinePos[sIdx];
    var s: u32 = 0u;
    for (var j: u32 = 0u; j < 3u; j = j + 1u) {
      let o = offs.pieceBlockShineOffsets[j];
      let L = luma(loadTexelClampedB(p.x + o.x, p.y + o.y).rgb);
      if (L > thr) { 
        s = 1u;
        break;
      }
    }
    outBuf.shine[sIdx] = s;
  }
}