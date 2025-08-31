#version 300 es
precision highp float;
precision highp usampler2D;

// constants
const int   DIGIT_SIZE = 14;
const int   DIGIT_STRIDE = 16;
const int   NUM_BOARD_BLOCKS = 200;
const int   NUM_REF_COLORS   = 3;
const int   MAX_SHINE_POSITIONS  = 14 + 20;
const ivec2 GYM_PAUSE_CROP_RELATIVE_TO_FIELD = ivec2(37, 47);


// inbound uniforms
uniform sampler2D uAtlasTex; // tex0 
uniform ivec2 uAtlasSize;

// do we need to know the total jobs? digit-ref pairs, blocks, colors, shines, gym pause?

// static accross runs

uniform int uNumReferenceDigits;
uniform sampler2D uReferenceDigitsTex; // tex1
uniform int uNumDigitJobs; 
uniform highp usampler2D uDigitJobsTex; // tex2 - definition of the jobs as data in texture


uniform ivec2 uBoardTLPosition; // from top-left position, we can derive the position of any block given its index
uniform ivec2 uRefColorPositions[NUM_REF_COLORS];
uniform int uShineThreshold;
uniform int uNumShinePositions;
uniform ivec2 uShinePositions[MAX_SHINE_POSITIONS];


// in-out 
flat in int vIndex;
out vec4 fragColor;


// pixel offsets constants
const ivec2 boardColorOffsets[4] = ivec2[4](
  ivec2(2,4),
  ivec2(3,3),
  ivec2(4,4),
  ivec2(4,2)
);
const ivec2 boardShineOffsets[3] = ivec2[3](
  ivec2(1,1),
  ivec2(1,2),
  ivec2(2,1)
);
const ivec2 refColorOffsets[3] = ivec2[3](
  ivec2(3,2),
  ivec2(3,3),
  ivec2(2,3)
);
const ivec2 pieceBlockShineOffsets[3] = ivec2[3](
  ivec2(0,0),
  ivec2(1,1),
  ivec2(1,2)
);
const ivec2 gymPauseOffsets[4] = ivec2[4](
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x +  2, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 10, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 17, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y),
  ivec2(GYM_PAUSE_CROP_RELATIVE_TO_FIELD.x + 18, GYM_PAUSE_CROP_RELATIVE_TO_FIELD.y)
);


// ---- helpers ----

float luma601(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec2 uv_at_pixel(ivec2 px) {
  vec2 sz = vec2(uAtlasSize);
  return vec2((float(px.x)+0.5)/sz.x, 1.0 - (float(px.y)+0.5)/sz.y);
}

vec3 avgAt(ivec2 base, const ivec2 offs[3]) {
  vec3 s = vec3(0.0);
  for(int i=0; i<offs.length(); ++i) {
    s += texture(uAtlasTex, uv_at_pixel(base + offs[i])).rgb;
  }
  return s / float(offs.length());
}

vec3 avgAt(ivec2 base, const ivec2 offs[4]) {
  vec3 s = vec3(0.0);
  for(int i=0; i<offs.length(); ++i) {
    s += texture(uAtlasTex, uv_at_pixel(base + offs[i])).rgb;
  }
  return s / float(offs.length());
}

float shineAt(ivec2 base, const ivec2 offs[3]) {
  float thr = float(uShineThreshold) / 255.0;

  for(int i=0; i<offs.length(); ++i) {
    vec3 c = texture(uAtlasTex, uv_at_pixel(base + offs[i])).rgb;
    float l = luma601(c);
    if (l > thr) return 1.0;
  }

  return 0.0;
}

vec4 packUintToRGBA8(uint x) {
  uvec4 b = uvec4(x & 255u, (x>>8)&255u, (x>>16)&255u, (x>>24)&255u);
  return vec4(b) / 255.0;
}

// ---- job implementations ----

// 1) Digit OCR: sum of squared error between measured series and reference row.
// Reference layout: R32F, width = uDigitRefStride * uNumReferenceDigits, height = 1,
// where row start for refIndex = refIndex * uDigitRefStride.
// Measured series: start at (x,y), step by uDigitScanStep per sample.
vec4 doDigitOCR(int localIdx) {
  // fetch job: t = (x, y, refIndex, _)
  uvec4 t   = texelFetch(uDigitJobsTex, ivec2(localIdx, 0), 0);
  ivec2 tl  = ivec2(t.xy);    // atlas top-left of digit patch
  int refIx = int(t.z);

  // return vec4(float(tl.x) / 255.0, float(tl.y)/255.0, float(refIx) / 255.0, 0.5);

  const int W = DIGIT_SIZE;
  const int H = DIGIT_SIZE;
  const int STRIDE = W * H;   // samples per reference row
  int start = refIx * STRIDE;

  float sse = 0.0;
  // 2D raster: x fastest
  for (int y = 0; y < H; ++y) {
    for (int x = 0; x < W; ++x) {
      // atlas sample at pixel center
      ivec2 p = tl + ivec2(x, y);
      float a = luma601(texture(uAtlasTex, uv_at_pixel(p)).rgb);

      // matching reference sample index
      int k = y * W + x;
      float b = texelFetch(uReferenceDigitsTex, ivec2(start + k, 0), 0).r;

      float d = a - b;
      sse += d * d;
    }
  }

  // pack SSE to u32, or write as float if your target is RGBA32F
  uint enc = uint(clamp(sse * 1000000.0, 0.0, 4294967295.0));
  return packUintToRGBA8(enc);
}

// 2) Board block color + shine in alpha.
// localIdx in [0..NUM_BOARD_BLOCKS-1], col = idx % 10, row = idx / 10.
vec4 doBoardBlock(int localIdx) {
  int  col = localIdx % 10;
  int  row = localIdx / 10;
  ivec2 tl = uBoardTLPosition + ivec2(col * 8, row * 8); // hardcoded block size
  vec3 avg = avgAt(tl, boardColorOffsets);
  float  a = shineAt(tl, boardShineOffsets); // 0 or 1
  return vec4(avg, a);
}

// 3) Ref colors: average colors around three anchor positions.
vec4 doRefColor(int localIdx) {
  ivec2 tl = uRefColorPositions[localIdx];
  vec3 avg = avgAt(tl, refColorOffsets);
  return vec4(avg, 1.0);
}

// 4) Shine spots: each job tests one position; output 1 or 0 as u32.
vec4 doShine(int localIdx) {
  ivec2 tl = uShinePositions[localIdx];
  float f = shineAt(tl, pieceBlockShineOffsets); // 0 or 1
  uint v = f == 1.0 ? 1u : 0u;
  return packUintToRGBA8(v);
}

// 5) Gym pause: average luma across gymPauseOffsets relative to board TL, result 0/1.
vec4 doGymPause() {
  float acc = 0.0;
  for(int i=0; i<gymPauseOffsets.length(); ++i){
    ivec2 p = uBoardTLPosition + gymPauseOffsets[i];
    acc += luma601(texture(uAtlasTex, uv_at_pixel(p)).rgb);
  }
  float y = acc / 4.0;
  float thr= float(uShineThreshold)/255.0;
  uint v = y > thr ? 1u : 0u;
  return packUintToRGBA8(v);
}

void main() {
  int i = vIndex;

  if(i < uNumDigitJobs){
    fragColor = doDigitOCR(i);
    return;
  }
  i -= uNumDigitJobs;

  if(i < NUM_BOARD_BLOCKS){
    fragColor = doBoardBlock(i);
    return;
  }
  i -= NUM_BOARD_BLOCKS;

  if(i < NUM_REF_COLORS){
    fragColor = doRefColor(i);
    return;
  }
  i -= NUM_REF_COLORS;

  if(i < uNumShinePositions){
    fragColor = doShine(i);
    return;
  }
  i -= uNumShinePositions;

  if (i == 0) {
    // last one: gym pause
    fragColor = doGymPause();
    return;
  }
}